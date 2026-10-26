import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { backendConfiguration, requiredConfiguration } from "../_shared/config.ts";
import { dispatchBatch, parseWebhook, selectEmailProvider, safeEqual, verifyBasicAuth, type ClaimedDelivery, type DeliveryPort } from "../_shared/notification/delivery.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const workerSecret = Deno.env.get("EF_NOTIFICATION_WORKER_SECRET") ?? "";
const webhookUser = Deno.env.get("EF_POSTMARK_WEBHOOK_USER") ?? "";
const webhookPassword = Deno.env.get("EF_POSTMARK_WEBHOOK_PASSWORD") ?? "";
const providerConfig: Record<string, string> = {};
for (const name of ["EF_NOTIFICATION_EMAIL_ENABLED", "EF_POSTMARK_SERVER_TOKEN"]) providerConfig[name] = Deno.env.get(name) ?? "";
// Optional platform fallback for institutions that have not configured their own sender.
const fallbackEmail = Deno.env.get("EF_POSTMARK_FROM_EMAIL") ?? "";
const defaultSender = fallbackEmail.trim() ? { name: Deno.env.get("EF_POSTMARK_FROM_NAME") ?? "Skyline", email: fallbackEmail.trim() } : null;

const headers = { "Content-Type": "application/json" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const MAX_BODY = 64 * 1024;
const BATCH = 10;

async function worker() {
  // Nothing is claimed unless sending is enabled and fully configured; values are never echoed.
  const selection = selectEmailProvider(providerConfig);
  if (!selection.provider) return reply({ error: "Edge Function configuration is unavailable.", code: selection.unavailable.code, variables: selection.unavailable.variables }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const port: DeliveryPort = {
    claim: async () => {
      const { data, error } = await admin.rpc("notification_claim_delivery");
      if (error) throw new Error("claim");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      const sender = row.sender && typeof row.sender === "object" && typeof row.sender.email === "string" && typeof row.sender.name === "string" ? { name: String(row.sender.name), email: String(row.sender.email) } : null;
      return { id: row.id, leaseToken: row.lease_token, recipientEmail: row.recipient_email, subject: row.subject, body: row.body, sender, attempt: Number(row.attempt_count ?? 1) } satisfies ClaimedDelivery;
    },
    record: async (d, outcome, messageId, errorCode, retry, delay) => {
      const { data, error } = await admin.rpc("notification_record_attempt", { p_id: d.id, p_lease: d.leaseToken, p_outcome: outcome, p_message_id: messageId, p_error: errorCode, p_retry: retry, p_delay: delay });
      if (error) throw new Error("record");
      return data === true;
    },
  };
  try {
    return reply({ ok: true, ...(await dispatchBatch(port, selection.provider, defaultSender, BATCH)) });
  } catch {
    // A claimed delivery whose outcome could not be stored becomes 'unknown' when its lease expires; it is never resent.
    return reply({ ok: false, error: "Delivery run stopped unexpectedly." }, 500);
  }
}

async function webhook(request: Request) {
  const missing = requiredConfiguration({ EF_POSTMARK_WEBHOOK_USER: webhookUser, EF_POSTMARK_WEBHOOK_PASSWORD: webhookPassword });
  if (missing) return reply({ error: missing.error, code: missing.code, variables: missing.variables }, 503);
  if (!(await verifyBasicAuth(request.headers.get("authorization"), webhookUser, webhookPassword))) return reply({ ok: false, error: "Unauthorized." }, 401, { "WWW-Authenticate": 'Basic realm="notification-webhook"' });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return reply({ ok: false, error: "Payload too large." }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return reply({ ok: false, error: "Payload too large." }, 413);
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return reply({ ok: false, error: "Invalid JSON." }, 400); }
  const event = parseWebhook(payload);
  if (event === null) return reply({ ok: false, error: "Invalid event." }, 400);
  if (event === "ignored") return reply({ ok: true, result: "ignored" });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("notification_apply_provider_event", { p_event_key: event.eventKey, p_record_type: event.recordType, p_message_id: event.messageId, p_detail: event.detail });
  // 5xx makes Postmark retry; every accepted, duplicate or unmatched event is acknowledged so it is not redelivered.
  if (error) return reply({ ok: false, error: "Event could not be stored." }, 503);
  return reply({ ok: true, result: data });
}

Deno.serve(async (request) => {
  const configuration = backendConfiguration(url, serviceKey);
  if (configuration) return reply(configuration, 503);
  if (request.method !== "POST") return reply({ ok: false, error: "Method not allowed." }, 405);
  const path = new URL(request.url).pathname;
  if (path.endsWith("/webhook")) return await webhook(request);
  const supplied = request.headers.get("x-worker-secret") ?? "";
  if (!workerSecret || !(await safeEqual(supplied, workerSecret))) return reply({ ok: false, error: "Unauthorized." }, 401);
  return await worker();
});
