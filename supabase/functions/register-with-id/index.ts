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

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { message: "Enter your account details." });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const firstName = typeof payload.first_name === "string" ? payload.first_name.trim() : "";
  const secondName = typeof payload.second_name === "string" ? payload.second_name.trim() : "";
  const lastName = typeof payload.last_name === "string" ? payload.last_name.trim() : "";
  const phoneNumber = typeof payload.phone_number === "string" ? payload.phone_number.trim() : "";
  const idNumber = typeof payload.id_no === "string" ? payload.id_no.trim() : "";

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    password.length < 8 || password.length > 72 ||
    !firstName || firstName.length > 100 || !secondName || secondName.length > 100 ||
    !lastName || lastName.length > 100 || !phoneNumber || phoneNumber.length > 32 ||
    !/^[0-9]{1,50}$/.test(idNumber)
  ) {
    return jsonResponse(400, { message: "Check your details and try again." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !serviceRoleKey || !publicKey) {
    console.error("Registration function is missing server configuration.");
    return jsonResponse(500, { message: "Registration is temporarily unavailable." });
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: existingProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id_no", idNumber)
      .maybeSingle();

    if (profileError) {
      console.error("ID lookup failed:", profileError.message);
      return jsonResponse(500, { message: "Registration is temporarily unavailable." });
    }
    if (existingProfile) {
      return jsonResponse(409, { message: "That ID number is already registered." });
    }

    const { error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        second_name: secondName,
        last_name: lastName,
        phone_number: phoneNumber,
        id_no: idNumber,
      },
    });
    if (createError) {
      console.error("Account creation failed:", createError.message);
      return jsonResponse(400, { message: "Unable to create the account. Check your details or try again." });
    }

    const authClient = createClient(supabaseUrl, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      console.error("New account sign-in failed:", error?.message ?? "Session missing.");
      return jsonResponse(500, { message: "Your account was created. Sign in using your ID number and password." });
    }

    return jsonResponse(200, data.session);
  } catch (error) {
    console.error("Unexpected registration error:", error);
    return jsonResponse(500, { message: "Registration is temporarily unavailable." });
  }
});
