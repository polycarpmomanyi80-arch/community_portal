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

  let payload: { id_no?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { message: "Enter your ID number and password." });
  }

  const idNo = typeof payload.id_no === "string" ? payload.id_no.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[0-9]+$/.test(idNo) || idNo.length > 50 || !password || password.length > 72) {
    return jsonResponse(400, { message: "Enter your ID number and password." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    console.error("Supabase login function is missing server configuration.");
    return jsonResponse(500, { message: "Sign-in is temporarily unavailable." });
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id_no", idNo)
      .maybeSingle();

    if (profileError) {
      console.error("ID lookup failed:", profileError.message);
      return jsonResponse(500, { message: "Sign-in is temporarily unavailable." });
    }
    if (!profile) {
      return jsonResponse(401, { message: "ID number or password is incorrect." });
    }

    const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(profile.id);
    if (authUserError || !authUser.user?.email) {
      console.error("Could not find the account for the supplied ID number.");
      return jsonResponse(401, { message: "ID number or password is incorrect." });
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: authUser.user.email,
      password,
    });

    if (error || !data.session) {
      return jsonResponse(401, { message: "ID number or password is incorrect." });
    }
    return jsonResponse(200, data.session);
  } catch (error) {
    console.error("Unexpected ID sign-in error:", error);
    return jsonResponse(500, { message: "Sign-in is temporarily unavailable." });
  }
});
