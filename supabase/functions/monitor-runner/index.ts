import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildMonitorTransitionAlertEvent } from "./alert-payload.ts";

const MIN_INTERVAL_SECONDS = 30;
const MAX_BATCH_SIZE = 50;
const MAX_RESPONSE_BYTES = 64 * 1024;

const COMPONENT_STATUSES = new Set(["operational", "degraded", "partial_outage", "major_outage", "maintenance"]);

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
];

const BLOCKED_IPV6_RANGES: Array<[bigint, number]> = [
  [0n, 128],
  [1n, 128],
  [0x0064ff9b000000000000000000000000n, 96],
  [0x01000000000000000000000000000000n, 64],
  [0x20010000000000000000000000000000n, 32],
  [0x20010db8000000000000000000000000n, 32],
  [0x20020000000000000000000000000000n, 16],
  [0xfc000000000000000000000000000000n, 7],
  [0xfe800000000000000000000000000000n, 10],
  [0xff000000000000000000000000000000n, 8],
];

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("MONITOR_RUNNER_SECRET") ?? "";
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expectedSecret || token !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: configs, error } = await supabaseAdmin
    .from("component_monitor_configs")
    .select("*")
    .eq("mode", "automatic")
    .eq("enabled", true)
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true })
    .limit(MAX_BATCH_SIZE);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const outcomes = [];
  for (const config of configs ?? []) {
    outcomes.push(await processConfig(config));
  }

  return Response.json({ processed: outcomes.length, outcomes });
});

async function processConfig(config: Record<string, unknown>) {
  const { data: component } = await supabaseAdmin
    .from("components")
    .select("id, name, status, project_id, projects!inner(user_id, name, slug, profiles(username))")
    .eq("id", config.component_id)
    .single();

  if (!component) return { config_id: config.id, skipped: "component_not_found" };

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan")
    .eq("id", component.projects.user_id)
    .single();

  if (!profile || !["pro", "business"].includes(profile.plan)) {
    await supabaseAdmin.from("component_monitor_configs").update({ enabled: false, mode: "manual" }).eq("id", config.id);
    return { config_id: config.id, skipped: "plan_not_allowed" };
  }

  if (hasInvalidMonitorStatuses(config)) {
    await postponeConfig(config, MIN_INTERVAL_SECONDS);
    return { config_id: config.id, skipped: "invalid_monitor_status" };
  }

  const normalized = normalizeConfig(config);
  const result = await executeCheck(normalized);
  const now = new Date();
  const nextCheckAt = new Date(now.getTime() + normalized.interval_seconds * 1000).toISOString();

  if (!isComponentStatus(result.resultingStatus)) {
    await postponeConfig(config, normalized.interval_seconds);
    return { config_id: config.id, skipped: "invalid_resulting_status" };
  }

  await supabaseAdmin.from("monitor_check_results").insert({
    config_id: config.id,
    project_id: config.project_id,
    component_id: config.component_id,
    status: result.checkStatus,
    resulting_status: result.resultingStatus,
    http_status: result.httpStatus,
    response_time_ms: result.responseTimeMs,
    error_message: result.errorMessage,
    checked_at: now.toISOString(),
  });

  await supabaseAdmin
    .from("component_monitor_configs")
    .update({ last_checked_at: now.toISOString(), next_check_at: nextCheckAt })
    .eq("id", config.id);

  if (component.status !== result.resultingStatus) {
    const previousStatus = component.status;
    const hasActiveIncident = await componentHasActiveIncident(String(config.project_id), String(config.component_id));
    if (!hasActiveIncident || result.resultingStatus !== "operational") {
      await supabaseAdmin.from("components").update({ status: result.resultingStatus }).eq("id", config.component_id);
      await supabaseAdmin.from("component_status_history").insert({
        component_id: config.component_id,
        status: result.resultingStatus,
        reason: result.resultingStatus === "operational" ? "monitor_recovery" : "monitor",
      });
      await enqueueMonitorTransitionAlert({ config, component, previousStatus, result, checkedAt: now.toISOString() });
    }
  }

  return { config_id: config.id, status: result.checkStatus, resulting_status: result.resultingStatus };
}

async function postponeConfig(config: Record<string, unknown>, intervalSeconds: number) {
  const now = new Date();
  await supabaseAdmin
    .from("component_monitor_configs")
    .update({ last_checked_at: now.toISOString(), next_check_at: new Date(now.getTime() + intervalSeconds * 1000).toISOString() })
    .eq("id", config.id);
}

async function componentHasActiveIncident(projectId: string, componentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("incidents")
    .select("id")
    .eq("project_id", projectId)
    .neq("status", "resolved")
    .contains("component_ids", [componentId])
    .limit(1);

  return Boolean(data && data.length > 0);
}

function normalizeConfig(config: Record<string, unknown>) {
  return {
    url: typeof config.url === "string" ? config.url : null,
    method: config.method === "HEAD" ? "HEAD" : "GET",
    interval_seconds: Math.max(MIN_INTERVAL_SECONDS, Number(config.interval_seconds ?? MIN_INTERVAL_SECONDS)),
    timeout_ms: Math.min(10000, Math.max(1000, Number(config.timeout_ms ?? 5000))),
    expected_status_codes: Array.isArray(config.expected_status_codes) ? config.expected_status_codes : [200],
    response_type: config.response_type === "json" ? "json" : "none",
    json_rules: Array.isArray(config.json_rules) ? config.json_rules : [],
    failure_status: typeof config.failure_status === "string" ? config.failure_status : "major_outage",
    no_match_status: typeof config.no_match_status === "string" ? config.no_match_status : "degraded",
  };
}

function hasInvalidMonitorStatuses(config: Record<string, unknown>): boolean {
  if (!isComponentStatus(config.failure_status)) return true;
  if (!isComponentStatus(config.no_match_status)) return true;
  if (!Array.isArray(config.json_rules)) return false;

  return config.json_rules.some((rule) => {
    if (typeof rule !== "object" || rule === null || !("targetStatus" in rule)) return false;
    return !isComponentStatus((rule as Record<string, unknown>).targetStatus);
  });
}

function isComponentStatus(status: unknown): status is string {
  return typeof status === "string" && COMPONENT_STATUSES.has(status);
}

async function executeCheck(config: ReturnType<typeof normalizeConfig>) {
  const startedAt = Date.now();
  const urlCheck = await validateUrl(config.url);
  if (!urlCheck.ok) return failed(config.failure_status, null, 0, urlCheck.reason);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
  try {
    const response = await fetch(urlCheck.url, {
      method: config.method,
      body: null,
      redirect: "error",
      signal: controller.signal,
      headers: { accept: config.response_type === "json" ? "application/json" : "*/*" },
    });
    const responseTimeMs = Date.now() - startedAt;
    if (!config.expected_status_codes.includes(response.status)) {
      return failed(config.failure_status, response.status, responseTimeMs, `Unexpected HTTP status ${response.status}.`);
    }

    if (config.response_type === "json") {
      const payload = await readLimitedJson(response);
      const resultingStatus = evaluateRules(payload, config.json_rules, config.no_match_status);
      return { checkStatus: "success", resultingStatus, httpStatus: response.status, responseTimeMs, errorMessage: null };
    }

    return { checkStatus: "success", resultingStatus: "operational", httpStatus: response.status, responseTimeMs, errorMessage: null };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Request timed out." : error instanceof Error ? error.message : "Request failed.";
    return failed(config.failure_status, null, Date.now() - startedAt, message);
  } finally {
    clearTimeout(timeout);
  }
}

async function validateUrl(rawUrl: string | null): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (!rawUrl) return { ok: false, reason: "Missing monitor URL." };
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false, reason: "Invalid URL." }; }
  if (url.protocol !== "https:") return { ok: false, reason: "Only HTTPS URLs are allowed." };
  if (url.username || url.password) return { ok: false, reason: "Credentials in URLs are not allowed." };
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)]$/, "$1");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return { ok: false, reason: "Localhost targets are not allowed." };
  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) return { ok: false, reason: "Private, local, and reserved IP targets are not allowed." };
  url.hash = "";

  if (!isIpv4Literal(hostname) && !isIpv6Literal(hostname)) {
    let addresses: string[];
    try {
      addresses = await resolveHostname(hostname);
    } catch {
      return { ok: false, reason: "Target hostname could not be resolved safely." };
    }
    if (addresses.length === 0) return { ok: false, reason: "Target hostname did not resolve to any IP address." };
    if (addresses.some((address) => isBlockedIpAddress(address))) {
      return { ok: false, reason: "Target hostname resolves to a private, local, or reserved IP address." };
    }
  }

  return { ok: true, url: url.toString() };
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const denoWithDns = Deno as unknown as { resolveDns?: (name: string, recordType: "A" | "AAAA") => Promise<string[]> };
  if (typeof denoWithDns.resolveDns !== "function") {
    throw new Error("Deno.resolveDns is required for monitor-runner SSRF protection.");
  }

  const [ipv4, ipv6] = await Promise.allSettled([
    denoWithDns.resolveDns(hostname, "A"),
    denoWithDns.resolveDns(hostname, "AAAA"),
  ]);

  return [
    ...(ipv4.status === "fulfilled" ? ipv4.value : []),
    ...(ipv6.status === "fulfilled" ? ipv6.value : []),
  ];
}

function isBlockedIpAddress(address: string): boolean {
  const hostname = address.toLowerCase().replace(/^\[(.*)]$/, "$1");
  return isBlockedIpv4(hostname) || isBlockedIpv6(hostname);
}

function isBlockedIpv4(hostname: string): boolean {
  const value = parseIpv4(hostname);
  if (value === null) return false;
  return BLOCKED_IPV4_RANGES.some(([range, prefix]) => ipv4MatchesCidr(value, range, prefix));
}

function isBlockedIpv6(hostname: string): boolean {
  const mappedIpv4 = parseIpv4MappedIpv6(hostname);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);
  const value = parseIpv6(hostname);
  if (value === null) return false;
  return BLOCKED_IPV6_RANGES.some(([range, prefix]) => ipv6MatchesCidr(value, range, prefix));
}

function isIpv4Literal(hostname: string): boolean {
  return parseIpv4(hostname) !== null;
}

function isIpv6Literal(hostname: string): boolean {
  return parseIpv6(hostname) !== null;
}

function parseIpv4(hostname: string): number | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return ((octets[0] * 256 ** 3) + (octets[1] * 256 ** 2) + (octets[2] * 256) + octets[3]) >>> 0;
}

function ipv4MatchesCidr(value: number, range: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (range & mask);
}

function parseIpv4MappedIpv6(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  if (!normalized.includes(".")) return null;
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon === -1) return null;
  const maybeIpv4 = normalized.slice(lastColon + 1);
  if (parseIpv4(maybeIpv4) === null) return null;
  return maybeIpv4;
}

function parseIpv6(hostname: string): bigint | null {
  if (!hostname.includes(":")) return null;
  const normalized = hostname.toLowerCase();
  if (normalized.includes(".")) return parseIpv6WithEmbeddedIpv4(normalized);
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((accumulator, group) => (accumulator << 16n) + BigInt(Number.parseInt(group, 16)), 0n);
}

function parseIpv6WithEmbeddedIpv4(hostname: string): bigint | null {
  const lastColon = hostname.lastIndexOf(":");
  if (lastColon === -1) return null;
  const ipv4 = parseIpv4(hostname.slice(lastColon + 1));
  if (ipv4 === null) return null;
  const high = Math.floor(ipv4 / 65536).toString(16);
  const low = (ipv4 % 65536).toString(16);
  return parseIpv6(`${hostname.slice(0, lastColon)}:${high}:${low}`);
}

function ipv6MatchesCidr(value: bigint, range: bigint, prefix: number): boolean {
  const mask = ((1n << BigInt(prefix)) - 1n) << (128n - BigInt(prefix));
  return (value & mask) === (range & mask);
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) throw new Error("Response body is too large.");
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(merged));
}

function evaluateRules(payload: unknown, rules: Array<Record<string, unknown>>, noMatchStatus: string): string {
  for (const rule of rules) {
    const actual = getPath(payload, String(rule.path ?? ""));
    if (rule.operator === "exists" && actual !== undefined && actual !== null) return String(rule.targetStatus);
    if (rule.operator === "equals" && valuesAreEqual(actual, rule.value)) return String(rule.targetStatus);
    if (rule.operator === "not_equals" && !valuesAreEqual(actual, rule.value)) return String(rule.targetStatus);
    if (rule.operator === "contains" && stringValue(actual).includes(stringValue(rule.value ?? ""))) return String(rule.targetStatus);
    if (rule.operator === "greater_than" && Number(actual) > Number(rule.value)) return String(rule.targetStatus);
    if (rule.operator === "less_than" && Number(actual) < Number(rule.value)) return String(rule.targetStatus);
  }
  return noMatchStatus;
}

function valuesAreEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return actual === expected;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : String(value);
}

function getPath(payload: unknown, path: string): unknown {
  let current = payload;
  for (const segment of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (["__proto__", "prototype", "constructor"].includes(segment)) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) { current = current[Number(segment)]; continue; }
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function failed(resultingStatus: string, httpStatus: number | null, responseTimeMs: number, errorMessage: string) {
  return { checkStatus: "failure", resultingStatus, httpStatus, responseTimeMs, errorMessage };
}

async function enqueueMonitorTransitionAlert(input: { config: Record<string, unknown>; component: Record<string, unknown>; previousStatus: string; result: ReturnType<typeof failed>; checkedAt: string }) {
  const row = buildMonitorTransitionAlertEvent(input);
  if (!row) return;
  await enqueueAlertEventAndDispatch(row);
}

async function enqueueAlertEventAndDispatch(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.rpc("enqueue_alert_event_and_dispatch", {
    p_project_id: row.project_id,
    p_type: row.type,
    p_source_type: row.source_type,
    p_source_id: row.source_id ?? null,
    p_severity: row.severity ?? null,
    p_dedupe_key: row.dedupe_key,
    p_payload: row.payload,
  });
  if (error) {
    console.warn("[alerts] monitor-runner queue RPC failed", error.message);
    await supabaseAdmin.from("alert_events").insert(row);
    return;
  }
  await invokeAlertWorker();
}

async function invokeAlertWorker(): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("ALERT_WORKER_SECRET") ?? Deno.env.get("ALERTS_DISPATCHER_SECRET");
  if (!url || !secret) return;
  try {
    await fetch(`${url.replace(/\/$/, "")}/functions/v1/alert-worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "monitor-runner" }),
    });
  } catch (error) {
    console.warn("[alerts] monitor-runner worker invoke failed", error);
  }
}
