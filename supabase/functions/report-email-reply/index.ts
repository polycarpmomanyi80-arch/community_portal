import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifyWebhook(
  body: string,
  request: Request,
  secret: string,
): Promise<boolean> {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return false;
  }

  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(encodedSecret), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedPayload));
  return signatures.split(" ").some((entry) => {
    const [version, encodedSignature] = entry.split(",", 2);
    if (version !== "v1" || !encodedSignature) return false;
    try {
      const received = Uint8Array.from(atob(encodedSignature), (character) => character.charCodeAt(0));
      return equalBytes(expected, received);
    } catch {
      return false;
    }
  });
}

function normalizeEmail(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function extractReplyText(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n?/g, "\n").trim();
  const quotedReplyMarkers = [
    /\nOn .{1,300}wrote:\s*[\s\S]*$/i,
    /\n-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
    /\nFrom:\s*.+\nSent:\s*.+[\s\S]*$/i,
  ];
  for (const marker of quotedReplyMarkers) {
    text = text.replace(marker, "").trim();
  }
  return text.slice(0, 5000);
}

function htmlToText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(div|p|br|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .trim();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Method not allowed." });
  }

  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const replyDomain = Deno.env.get("REPORT_REPLY_DOMAIN")?.trim().toLowerCase().replace(/^@/, "");
  const allowedSender = (
    Deno.env.get("REPORT_ADMIN_REPLY_EMAIL") ?? "poycarpmomanyi80@gmail.com"
  ).trim().toLowerCase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !resendApiKey || !replyDomain || !allowedSender || !supabaseUrl || !serviceRoleKey) {
    console.error("Report email reply function is missing server configuration.");
    return jsonResponse(500, { message: "Email replies are not configured." });
  }

  const rawBody = await request.text();
  if (!await verifyWebhook(rawBody, request, webhookSecret)) {
    return jsonResponse(401, { message: "Invalid webhook signature." });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { message: "Invalid webhook payload." });
  }
  if (event.type !== "email.received") {
    return jsonResponse(200, { ignored: true });
  }

  const data = event.data as Record<string, unknown> | undefined;
  const receivedEmailId = typeof data?.email_id === "string" ? data.email_id : "";
  const recipients = Array.isArray(data?.to) ? data.to : [];
  const replyAddress = recipients.find((recipient): recipient is string => typeof recipient === "string");
  const routeMatch = replyAddress?.trim().toLowerCase().match(
    new RegExp(`^report\\+([0-9a-f-]{36})@${replyDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  );
  const reportId = routeMatch?.[1];
  if (!receivedEmailId || !reportId) {
    return jsonResponse(200, { ignored: true });
  }

  try {
    const receivedResponse = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(receivedEmailId)}`,
      { headers: { Authorization: `Bearer ${resendApiKey}` } },
    );
    if (!receivedResponse.ok) {
      const details = await receivedResponse.text();
      console.error("Could not retrieve the received email:", details);
      return jsonResponse(502, { message: "Could not retrieve the email reply." });
    }

    const receivedEmail = await receivedResponse.json();
    if (normalizeEmail(String(receivedEmail.from ?? "")) !== allowedSender) {
      console.warn("Ignoring report email reply from an unauthorized sender.");
      return jsonResponse(200, { ignored: true });
    }

    const authentication = receivedEmail.authentication as Record<string, unknown> | null;
    if (authentication?.spf !== "pass" && authentication?.dkim !== "pass") {
      console.warn("Ignoring report email reply without passing sender authentication.");
      return jsonResponse(200, { ignored: true });
    }

    const reply = extractReplyText(receivedEmail.text || htmlToText(receivedEmail.html));
    if (!reply) {
      return jsonResponse(422, { message: "The received email has no plain-text reply to save." });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabase.rpc("save_email_report_reply", {
      p_report_id: reportId,
      p_email_id: receivedEmailId,
      p_message: reply,
    });
    if (error) {
      throw new Error(`Could not save the report email reply: ${error.message}`);
    }

    return jsonResponse(200, { saved: true });
  } catch (error) {
    console.error("Processing report email reply failed:", error);
    return jsonResponse(500, { message: "The email reply could not be saved." });
  }
});
