import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => Promise<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) {
      throw new Error(error.message);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) {
      return rows;
    }
  }
}

async function deleteReports(adminClient: ReturnType<typeof createClient>, reportIds: string[]) {
  const attachmentPaths: string[] = [];
  for (const reportIdBatch of splitIntoBatches(reportIds, 100)) {
    const attachments = await fetchAllRows<{ storage_path: string }>((from, to) =>
      adminClient
        .from("report_attachments")
        .select("storage_path")
        .in("report_id", reportIdBatch)
        .range(from, to)
    );
    const solutions = await fetchAllRows<{ reference_file_path: string | null }>((from, to) =>
      adminClient
        .from("report_solutions")
        .select("reference_file_path")
        .in("report_id", reportIdBatch)
        .range(from, to)
    );
    attachmentPaths.push(
      ...attachments.map((attachment) => attachment.storage_path),
      ...solutions
        .map((solution) => solution.reference_file_path)
        .filter((path): path is string => Boolean(path)),
    );
  }

  const uniquePaths = [...new Set(attachmentPaths)];
  for (const pathBatch of splitIntoBatches(uniquePaths, 100)) {
    const { error } = await adminClient.storage
      .from("report-attachments")
      .remove(pathBatch);
    if (error) {
      throw new Error(`Could not remove report attachments: ${error.message}`);
    }
  }

  for (const reportIdBatch of splitIntoBatches(reportIds, 100)) {
    const { error } = await adminClient.from("reports").delete().in("id", reportIdBatch);
    if (error) {
      throw new Error(`Could not remove community reports: ${error.message}`);
    }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Method not allowed." });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { message: "A valid deletion request is required." });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse(400, { message: "A valid deletion request is required." });
  }
  const requestPayload = payload as Record<string, unknown>;
  const action = requestPayload.action;
  const requestedReportId = requestPayload.report_id;
  if (action !== "delete_report" && action !== "delete_account") {
    return jsonResponse(400, { message: "Choose a valid deletion action." });
  }
  if (action === "delete_report" && (
    typeof requestedReportId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedReportId)
  )) {
    return jsonResponse(400, { message: "A valid report ID is required." });
  }
  if (action === "delete_account" && requestedReportId !== undefined) {
    return jsonResponse(400, { message: "A report ID cannot be included in an account deletion request." });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonResponse(401, { message: "Sign in to delete your account." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    console.error("Account deletion function is missing server configuration.");
    return jsonResponse(500, { message: "Account deletion is temporarily unavailable." });
  }

  try {
    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return jsonResponse(401, { message: "Sign in again before deleting your account." });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const userId = authData.user.id;

    if (action === "delete_report") {
      const reportId = requestedReportId as string;
      const { data: adminRows, error: adminError } = await adminClient
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1);
      if (adminError) {
        throw new Error(`Could not verify administrator access: ${adminError.message}`);
      }
      if (!adminRows?.length) {
        return jsonResponse(403, { message: "Only administrators can delete reports." });
      }

      const { data: report, error: reportError } = await adminClient
        .from("reports")
        .select("id")
        .eq("id", reportId)
        .maybeSingle();
      if (reportError) {
        throw new Error(`Could not load the report: ${reportError.message}`);
      }
      if (!report) {
        return jsonResponse(404, { message: "The report was not found." });
      }

      await deleteReports(adminClient, [reportId]);
      return jsonResponse(200, { message: "The report and its attachments were deleted." });
    }

    const reports = await fetchAllRows<{ id: string }>((from, to) =>
      adminClient.from("reports").select("id").eq("user_id", userId).range(from, to)
    );
    const reportIds = reports.map((report) => report.id);
    await deleteReports(adminClient, reportIds);

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      throw new Error(`Could not remove the account: ${deleteUserError.message}`);
    }

    return jsonResponse(200, { message: "Account and associated data deleted." });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return jsonResponse(500, { message: "Account deletion did not complete. Please try again or contact support." });
  }
});
