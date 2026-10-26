// Runtime-neutral notification delivery: provider contract, Postmark adapter, webhook verification and the
// dispatch loop. No Deno or Node globals beyond web standards, so the same source runs in Edge, Node tests and
// any future host. Messages and errors are fixed strings: never addresses, bodies, tokens or provider text.

export const POSTMARK_API = "https://api.postmarkapp.com";
export const MAX_DELIVERY_ATTEMPTS = 3;

export interface EmailMessage {
  deliveryId: string;
  from: { name: string; email: string };
  to: string;
  subject: string;
  textBody: string;
}

/** accepted: the provider took the message. retry/failed: definitively NOT accepted. unknown: it may have been accepted. */
export type SendOutcome =
  | { kind: "accepted"; messageId: string }
  | { kind: "retry"; code: string }
  | { kind: "failed"; code: string }
  | { kind: "unknown"; code: string };

export interface EmailProvider { readonly id: string; send(message: EmailMessage): Promise<SendOutcome> }

const MESSAGE_ID = /^[A-Za-z0-9-]{8,64}$/;
// eslint-disable-next-line no-control-regex -- strip control characters from the display name
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/["<>]/g, "").trim().slice(0, 100);

export function createPostmarkProvider(options: { serverToken: string; fetch?: typeof fetch; timeoutMs?: number }): EmailProvider {
  const call = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  return {
    id: "postmark",
    async send(message) {
      let response: Response;
      try {
        response = await call(`${POSTMARK_API}/email`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": options.serverToken },
          body: JSON.stringify({
            From: `"${clean(message.from.name)}" <${message.from.email}>`, To: message.to, Subject: message.subject, TextBody: message.textBody,
            MessageStream: "outbound", Metadata: { deliveryId: message.deliveryId }, TrackOpens: false, TrackLinks: "None",
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // The request may or may not have reached Postmark; it has no idempotency key, so this is never resent automatically.
        return { kind: "unknown", code: (error as Error)?.name === "TimeoutError" ? "timeout" : "network" };
      }
      if (response.status === 429) return { kind: "retry", code: "rate_limit" };
      if (response.status >= 500) return { kind: "retry", code: "provider" };
      if (response.status === 401) return { kind: "failed", code: "unauthorized" };
      let body: Record<string, unknown> | null = null;
      try { const parsed = await response.json(); body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { body = null; }
      if (response.status === 200) {
        if (body && body.ErrorCode === 0 && typeof body.MessageID === "string" && MESSAGE_ID.test(body.MessageID)) return { kind: "accepted", messageId: body.MessageID };
        return { kind: "unknown", code: "schema" };
      }
      const errorCode = typeof body?.ErrorCode === "number" ? body.ErrorCode : 0;
      if (errorCode === 406) return { kind: "failed", code: "inactive_recipient" };
      if (errorCode === 300) return { kind: "failed", code: "invalid_recipient" };
      return { kind: "failed", code: "rejected" };
    },
  };
}

/** Deterministic provider for tests and local development; never reachable from selectEmailProvider. */
export function createMockEmailProvider(script: SendOutcome[] | ((message: EmailMessage, call: number) => SendOutcome)): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  let n = 0;
  return { id: "mock", sent, async send(message) { sent.push(message); n += 1; return typeof script === "function" ? script(message, n) : script[Math.min(n - 1, script.length - 1)]; } };
}

export type EmailProviderSelection = { provider: EmailProvider; unavailable: null } | { provider: null; unavailable: { code: "configuration_unavailable"; variables: string[] } };

/** Sending is on only when EF_NOTIFICATION_EMAIL_ENABLED is exactly "true" and the server token is set. Names only in errors. */
export function selectEmailProvider(config: Record<string, string | undefined>, options: { fetch?: typeof fetch } = {}): EmailProviderSelection {
  const variables: string[] = [];
  if ((config.EF_NOTIFICATION_EMAIL_ENABLED ?? "").trim() !== "true") variables.push("EF_NOTIFICATION_EMAIL_ENABLED");
  if (!(config.EF_POSTMARK_SERVER_TOKEN ?? "").trim()) variables.push("EF_POSTMARK_SERVER_TOKEN");
  if (variables.length) return { provider: null, unavailable: { code: "configuration_unavailable", variables } };
  return { provider: createPostmarkProvider({ serverToken: config.EF_POSTMARK_SERVER_TOKEN!.trim(), fetch: options.fetch }), unavailable: null };
}

// ---- webhook verification --------------------------------------------------------------------
// Postmark documents no HMAC signature for webhooks. Its supported controls are HTTP Basic credentials in the webhook URL
// (and an optional network allow-list), so callbacks are accepted only with the configured Basic credentials.

async function digest(value: string): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }

/** Constant-time equality of two secrets (compares SHA-256 digests). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function verifyBasicAuth(header: string | null, user: string, password: string): Promise<boolean> {
  if (!user || !password) return false;
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec((header ?? "").trim());
  if (!match) return false;
  let supplied: string;
  try { supplied = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))); } catch { return false; }
  return await safeEqual(supplied, `${user}:${password}`);
}

export type WebhookEvent = { recordType: "Delivery" | "Bounce" | "SpamComplaint"; messageId: string; eventKey: string; detail: { type?: string; description?: string } };

/** null = malformed (reject); "ignored" = a valid event type we do not track (acknowledge). */
export function parseWebhook(body: unknown): WebhookEvent | "ignored" | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const type = record.RecordType;
  if (typeof type !== "string") return null;
  if (type !== "Delivery" && type !== "Bounce" && type !== "SpamComplaint") return "ignored";
  if (typeof record.MessageID !== "string" || !MESSAGE_ID.test(record.MessageID)) return null;
  const id = typeof record.ID === "number" || typeof record.ID === "string" ? String(record.ID).replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) : "";
  return {
    recordType: type, messageId: record.MessageID, eventKey: `${type}:${record.MessageID}:${id}`,
    detail: type === "Bounce"
      ? { type: typeof record.Type === "string" ? record.Type.slice(0, 60) : undefined, description: typeof record.Description === "string" ? record.Description.slice(0, 300) : undefined }
      : {},
  };
}

// ---- dispatch loop ------------------------------------------------------------------------------

export interface ClaimedDelivery { id: string; leaseToken: string; recipientEmail: string; subject: string; body: string; sender: { name: string; email: string } | null; attempt: number }
export interface DeliveryPort {
  claim(): Promise<ClaimedDelivery | null>;
  record(delivery: ClaimedDelivery, outcome: "accepted" | "failed" | "unknown", messageId: string | null, errorCode: string | null, retry: boolean, delaySeconds: number): Promise<boolean>;
}
export interface DispatchSummary { accepted: number; retried: number; failed: number; unknown: number; stale: number }

export async function dispatchBatch(port: DeliveryPort, provider: EmailProvider, defaultSender: { name: string; email: string } | null, limit: number): Promise<DispatchSummary> {
  const summary: DispatchSummary = { accepted: 0, retried: 0, failed: 0, unknown: 0, stale: 0 };
  for (let i = 0; i < limit; i++) {
    const delivery = await port.claim();
    if (!delivery) break;
    const sender = delivery.sender ?? defaultSender;
    const delay = Math.min(900, 30 * 2 ** delivery.attempt);
    let stored: boolean;
    if (!sender) {
      stored = await port.record(delivery, "failed", null, "sender_unconfigured", false, 0); if (stored) summary.failed++;
    } else {
      const outcome = await provider.send({ deliveryId: delivery.id, from: sender, to: delivery.recipientEmail, subject: delivery.subject, textBody: delivery.body });
      if (outcome.kind === "accepted") { stored = await port.record(delivery, "accepted", outcome.messageId, null, false, 0); if (stored) summary.accepted++; }
      else if (outcome.kind === "retry") { stored = await port.record(delivery, "failed", null, outcome.code, true, delay); if (stored) { if (delivery.attempt < MAX_DELIVERY_ATTEMPTS) summary.retried++; else summary.failed++; } }
      else if (outcome.kind === "failed") { stored = await port.record(delivery, "failed", null, outcome.code, false, 0); if (stored) summary.failed++; }
      else { stored = await port.record(delivery, "unknown", null, outcome.code, false, 0); if (stored) summary.unknown++; }
    }
    if (!stored) summary.stale++;
  }
  return summary;
}
