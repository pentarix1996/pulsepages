import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nextRetryDate, retryDeferral } from "./backoff.ts";

const MAX_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("ALERT_WORKER_SECRET") ?? Deno.env.get("ALERTS_DISPATCHER_SECRET") ?? "";
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expectedSecret || token !== expectedSecret) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const recovery = await supabaseAdmin.rpc("recover_alert_delivery_queue", { p_limit: MAX_BATCH_SIZE });
  const read = await supabaseAdmin.rpc("alert_worker_read_messages", { p_batch_size: MAX_BATCH_SIZE, p_visibility_timeout: 60 });
  if (read.error) return Response.json({ error: read.error.message }, { status: 500 });

  const outcomes = [];
  for (const row of read.data ?? []) {
    outcomes.push(await processQueueRow(row as Record<string, unknown>));
  }

  return Response.json({ recovered: recovery.data?.length ?? 0, processed: outcomes.length, outcomes });
});

async function processQueueRow(row: Record<string, unknown>) {
  const msgId = typeof row.msg_id === "number" ? row.msg_id : Number(row.msg_id);
  const message = row.message;
  if (!Number.isFinite(msgId) || !isAlertDeliveryQueueMessage(message)) return { msgId, status: "invalid" };

  const loaded = await loadDeliveryContext(message.deliveryId, message.eventId, message.projectId);
  if (!loaded) {
    await deleteMessage(msgId);
    return { msgId, status: "missing" };
  }

  const { delivery, event, channel } = loaded;
  if (delivery.status === "sent" || delivery.status === "failed" || delivery.status === "suppressed") {
    await deleteMessage(msgId);
    return { msgId, deliveryId: delivery.id, status: "already_terminal" };
  }

  const retry = retryDeferral(delivery.next_retry_at);
  if (!retry.due) {
    await deferMessage(msgId, retry.delaySeconds);
    return { msgId, deliveryId: delivery.id, status: "deferred", delaySeconds: retry.delaySeconds };
  }

  if (channel.enabled !== true) {
    await markDelivery(delivery.id, { status: "suppressed", error_code: "channel_disabled", error_message: "Alert channel is disabled." });
    await deleteMessage(msgId);
    return { msgId, deliveryId: delivery.id, status: "suppressed" };
  }

  const claimed = await claimDelivery(delivery);
  if (!claimed) return { msgId, deliveryId: delivery.id, status: "claim_skipped" };

  const result = await deliverEmail({ event, delivery, channel });
  const attempts = Number(delivery.attempts ?? 0) + 1;
  const terminalStatus = result.status === "sent" ? "sent" : result.status === "retryable" && attempts < MAX_ATTEMPTS ? "retryable" : "failed";
  await markDelivery(delivery.id, {
    status: terminalStatus,
    provider: result.provider,
    provider_message_id: result.providerMessageId,
    error_code: result.errorCode,
    error_message: result.errorMessage,
    next_retry_at: terminalStatus === "retryable" ? nextRetryDate(attempts).toISOString() : null,
    sent_at: terminalStatus === "sent" ? new Date().toISOString() : null,
    dispatched_at: new Date().toISOString(),
  });

  if (terminalStatus === "sent" || terminalStatus === "failed") await deleteMessage(msgId);
  await finalizeEvent(event.id);
  return { msgId, deliveryId: delivery.id, status: terminalStatus };
}

async function loadDeliveryContext(deliveryId: string, eventId: string, projectId: string) {
  const { data: delivery } = await supabaseAdmin.from("alert_deliveries").select("*").eq("id", deliveryId).eq("event_id", eventId).maybeSingle();
  const { data: event } = await supabaseAdmin.from("alert_events").select("*").eq("id", eventId).eq("project_id", projectId).maybeSingle();
  if (!delivery || !event) return null;
  const { data: channel } = await supabaseAdmin.from("alert_channel_configs").select("*").eq("id", delivery.channel_config_id).eq("project_id", projectId).maybeSingle();
  if (!channel) return null;
  return { delivery: delivery as Record<string, unknown>, event: event as Record<string, unknown>, channel: channel as Record<string, unknown> };
}

async function claimDelivery(delivery: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("alert_deliveries")
    .update({ status: "processing", attempts: Number(delivery.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", delivery.id)
    .in("status", ["pending", "retryable"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function deliverEmail(input: { event: Record<string, unknown>; delivery: Record<string, unknown>; channel: Record<string, unknown> }) {
  if (input.channel.type !== "email") return { status: "failed", provider: "unknown", providerMessageId: null, errorCode: "unsupported_channel", errorMessage: "Unsupported alert channel." };
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ALERTS_EMAIL_FROM");
  if (!apiKey || !from) return { status: "failed", provider: "resend", providerMessageId: null, errorCode: "missing_config", errorMessage: "Email provider is not configured." };

  const payload = isRecord(input.event.payload) ? input.event.payload : {};
  const subject = `[Upvane] ${String(payload.project_name ?? "Project")} alert: ${String(input.event.type ?? "alert").replace(/_/g, " ")}`;
  const reason = String(payload.reason ?? "An Upvane alert needs attention.");
  const html = `<div><h1>Upvane alert</h1><p>${escapeHtml(reason)}</p><p>Project: ${escapeHtml(String(payload.project_name ?? input.event.project_id ?? "Upvane"))}</p></div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": String(input.delivery.idempotency_key ?? input.delivery.id) },
      body: JSON.stringify({ from, to: [String(input.delivery.target)], subject, html, text: reason }),
    });
    const body = await readJson(response);
    if (response.ok) return { status: "sent", provider: "resend", providerMessageId: isRecord(body) && typeof body.id === "string" ? body.id : null, errorCode: null, errorMessage: null };
    return { status: response.status === 429 || response.status >= 500 ? "retryable" : "failed", provider: "resend", providerMessageId: null, errorCode: isRecord(body) && typeof body.name === "string" ? body.name : `http_${response.status}`, errorMessage: isRecord(body) && typeof body.message === "string" ? body.message : response.statusText };
  } catch (error) {
    return { status: "retryable", provider: "resend", providerMessageId: null, errorCode: "network_error", errorMessage: error instanceof Error ? error.message : "Network error while sending email." };
  }
}

async function markDelivery(id: unknown, values: Record<string, unknown>) {
  await supabaseAdmin.from("alert_deliveries").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
}

async function finalizeEvent(eventId: unknown) {
  const { data } = await supabaseAdmin.from("alert_deliveries").select("status").eq("event_id", eventId);
  const statuses = (data ?? []).map((row: Record<string, unknown>) => row.status);
  if (statuses.length === 0 || statuses.some((status) => ["pending", "retryable", "processing"].includes(String(status)))) return;
  const nextStatus = statuses.every((status) => status === "suppressed") ? "suppressed" : "processed";
  await supabaseAdmin.from("alert_events").update({ status: nextStatus, processed_at: new Date().toISOString() }).eq("id", eventId);
}

async function deleteMessage(msgId: number): Promise<void> {
  await supabaseAdmin.rpc("alert_worker_delete_message", { p_msg_id: msgId });
}

async function deferMessage(msgId: number, delaySeconds: number): Promise<void> {
  await supabaseAdmin.rpc("alert_worker_defer_message", { p_msg_id: msgId, p_delay_seconds: delaySeconds });
}

function isAlertDeliveryQueueMessage(value: unknown): value is { deliveryId: string; eventId: string; projectId: string; channel: "email" } {
  if (!isRecord(value)) return false;
  return typeof value.deliveryId === "string" && typeof value.eventId === "string" && typeof value.projectId === "string" && value.channel === "email";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return {}; }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
