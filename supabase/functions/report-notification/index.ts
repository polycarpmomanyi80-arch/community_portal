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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Method not allowed." });
  }

  const accessToken = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonResponse(401, { message: "Sign in to submit a report." });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { message: "A valid report ID is required." });
  }
  const reportId = typeof payload.report_id === "string" ? payload.report_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) {
    return jsonResponse(400, { message: "A valid report ID is required." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const adminEmail = Deno.env.get("REPORT_ADMIN_EMAIL") ?? "poycarpmomanyi80@gmail.com";
  const fromEmail = Deno.env.get("REPORT_FROM_EMAIL");
  const replyDomain = Deno.env.get("REPORT_REPLY_DOMAIN")?.trim().toLowerCase().replace(/^@/, "");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !publicKey || !adminEmail || !fromEmail || !resendApiKey) {
    console.error("Report notification function is missing server configuration.");
    return jsonResponse(500, { message: "Report email notifications are not configured." });
  }

  try {
    const authClient = createClient(supabaseUrl, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return jsonResponse(401, { message: "Sign in again before submitting a report." });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: report, error: reportError } = await adminClient
      .from("reports")
      .select("id")
      .eq("id", reportId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (reportError) {
      throw new Error(`Could not verify report ownership: ${reportError.message}`);
    }
    if (!report) {
      return jsonResponse(404, { message: "The report was not found for this account." });
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [adminEmail],
        ...(replyDomain ? { reply_to: [`report+${reportId}@${replyDomain}`] } : {}),
        subject: `A new community report needs review [${reportId}]`,
        text: replyDomain
          ? "A new report has been submitted. Reply to this email to post your response on the report wall, or sign in to Smart Community Reporting to reply there."
          : "A new report has been submitted. Sign in to Smart Community Reporting to read it and reply on the community wall.",
      }),
    });
    if (!emailResponse.ok) {
      const responseText = await emailResponse.text();
      console.error("Report notification email failed:", responseText);
      return jsonResponse(502, { message: "The report was saved, but its email notification could not be sent." });
    }

    return jsonResponse(200, { message: "Administrator notified." });
  } catch (error) {
    console.error("Report notification failed:", error);
    return jsonResponse(500, { message: "The report was saved, but its email notification could not be sent." });
  }
});
