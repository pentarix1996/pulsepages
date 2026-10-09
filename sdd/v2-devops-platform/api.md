# Upvane API v1 — contract

Base URL: `https://<app>/api/v1` (also `https://api.<domain>/v1`, rewritten by `proxy.ts`). The OpenAPI document at
`/api/v1/openapi.json` is generated from the zod schemas in `lib/domain/schemas/*` and the operations registered in
`lib/api/spec/*`. This file is the human contract that the Terraform provider, the CLI and the GitHub Action follow.

## Conventions

- Auth: `Authorization: Bearer upv_live_…` (legacy `pp_live_…` accepted). Keys belong to an organization and may be
  limited to one project. Scopes: `read`, `write`. Plan: Pro or Business (`402 plan_required` otherwise).
- Envelope: success `{ "data": … }`; lists `{ "data": [...], "next_cursor": string | null }` with `?limit=1..100&cursor=`.
  Errors `{ "error": "readable message", "code": "machine_code", "details"?: [...], "request_id": "req_…" }`.
  Codes: `unauthorized 401`, `plan_required 402`, `plan_limit 402`, `forbidden 403`, `not_found 404`,
  `conflict 409`, `idempotency_conflict 409`, `invalid_request 422`, `rate_limited 429`, `unavailable 503`, `internal 500`.
- `{project}` accepts the project id or slug; `{component}` accepts the component id or key (slug). Other ids are UUIDs.
- `Idempotency-Key` on POST create/action endpoints replays the first response for 24 h; reusing a key with a
  different body returns `409 idempotency_conflict`.
- Rate limit per key: 600 requests/min (Business 1200). Headers `X-RateLimit-Limit|Remaining|Reset`, `Retry-After` on 429.
- Every response has `X-Request-Id`. Mutations are written to the organization audit log with the key as actor.
- Timestamps are ISO 8601 UTC. Status values: `operational | degraded | partial_outage | major_outage | maintenance`.
- PUT is accepted as an alias of PATCH on components and incidents (v0 compatibility).

## Resources

### Me
- `GET /me` → `{ key: { id, name, prefix, scopes, project_id }, organization: { id, slug, name, plan } }`

### Projects (status pages)
`Project { id, organization_id, name, slug, description, visibility: public|private, status_page_url, custom_domain,
custom_domain_status: none|pending|verified|error|suspended, brand_color, logo_url, theme_default: light|dark|system,
timezone, support_url, hide_powered_by, auto_postmortem, auto_draft_incidents, allowed_ips: string[], created_at, updated_at }`
- `GET /projects` (list) · `POST /projects` `{ name, slug, description?, visibility?, timezone?, … }` (organization-wide keys only)
- `GET|PATCH|DELETE /projects/{project}` (PATCH accepts every settings field above except ids and timestamps)
- `GET /projects/{project}/status` → `{ status, headline, components: [{ id, slug, name, status }], active_incidents: [{ id, title, status, impact, url }], maintenances: [{ id, title, status, scheduled_start, scheduled_end }] }`
- `POST /projects/{project}/custom-domain/verify` → Project (re-checks DNS/Vercel and updates `custom_domain_status`)

### Components and groups
`Component { id, slug, name, description, status, status_source, manual_status, automated_status, group_id, position,
depends_on: [{ component_id, impact }], status_changed_at, created_at, updated_at }` — `ComponentGroup { id, name, position, collapsed, … }`
- `GET|POST /projects/{project}/components` · `GET|PATCH|DELETE /projects/{project}/components/{component}`
  - create/update `{ name, slug?, description?, group_id?, position?, depends_on?: [{ component, impact }] }`
- `PUT /projects/{project}/components/{component}/status` `{ status | null }` pin / return to automatic
- `PUT /projects/{project}/components/{component}/dependencies` `{ depends_on: [{ component, impact }] }`
- `GET|POST /projects/{project}/component-groups` · `PATCH|DELETE /projects/{project}/component-groups/{group}`

### Incidents
`Incident { id, project_id, title, status: draft|investigating|identified|monitoring|resolved, impact: none|minor|major|critical,
source: manual|monitor|signal|api|template, components: [{ component_id, slug, name, status }], detected_at,
acknowledged_at, published_at, resolved_at, created_at, updated_at, url (public permalink, null for drafts),
postmortem: { id, status } | null, updates?: IncidentUpdate[] }` (updates only on GET one)
`IncidentUpdate { id, kind: update|note|system, visibility: public|internal, status, message, component_statuses: { [component_id]: status }, notify_subscribers, actor: { type: user|api_key|system, label }, created_at }`
- `GET /projects/{project}/incidents?status=active|draft|resolved|all` (default all, newest first)
- `POST /projects/{project}/incidents` `{ title, message?, status? (default investigating), impact? (default minor),
  components?: { "<id|key>": status }, notify_subscribers? (default true), template_id? }`
  - v0 fields accepted: `severity` (critical|high|medium|low → impact), `component_ids` (status from severity), `description`
- `GET|PATCH|DELETE /projects/{project}/incidents/{incident}` — PATCH `{ title?, impact? }`; DELETE is a soft delete
- `POST /projects/{project}/incidents/{incident}/updates` `{ message, status?, visibility? (public), components?: { "<id|key>": status|null }, notify_subscribers? }` → IncidentUpdate
- `POST /projects/{project}/incidents/{incident}/acknowledge` → Incident
- `POST /projects/{project}/incidents/{incident}/publish` `{ message?, status? (investigating), notify_subscribers? }` → Incident (drafts only)
- `GET|PUT /projects/{project}/incidents/{incident}/postmortem` · `POST …/postmortem/publish`
  `Postmortem { id, incident_id, status: draft|published, title, summary, impact, root_cause, resolution, lessons, action_items: [{ id, title, owner, due_date, done, url }], timeline: [{ at, message, … }], published_at, updated_at }`
- `GET|POST /projects/{project}/incident-templates` · `PATCH|DELETE /projects/{project}/incident-templates/{template}`
  `IncidentTemplate { id, name, title, message, impact, status, component_statuses: { "<id|key>": status } }`

### Maintenance windows
`Maintenance { id, project_id, title, description, status: scheduled|in_progress|completed|cancelled, scheduled_start,
scheduled_end, actual_start, actual_end, components: [{ component_id, slug, name }], auto_start, auto_complete,
notify_subscribers, reminder_minutes, mute_alerts, url, created_at, updated_at, updates?: [{ id, status, message, actor, created_at }] }`
- `GET /projects/{project}/maintenances?status=upcoming|active|past|all`
- `POST /projects/{project}/maintenances` `{ title, description?, scheduled_start, scheduled_end, components: ["<id|key>"], auto_start?, auto_complete?, notify_subscribers?, reminder_minutes?, mute_alerts? }`
- `GET|PATCH /projects/{project}/maintenances/{maintenance}` · `DELETE` cancels
- `POST …/{maintenance}/start|complete|cancel` `{ message? }` · `POST …/{maintenance}/updates` `{ message }`

### Monitors
`Monitor { id, project_id, name, type: http|keyword|tcp|dns|tls|heartbeat, enabled, paused_reason, interval_seconds,
timeout_ms, regions: string[], confirm_failures, confirm_regions, recovery_successes, config, secret_header_names: string[],
failure_status, degraded_status, auto_draft_incident, components: [{ component_id, slug, name }], state: pending|up|degraded|down|paused,
state_changed_at, last_checked_at, last_result, last_error, tls_expires_at, heartbeat_url (heartbeat only), created_at, updated_at }`
- `config` by type: http/keyword `{ url, method?, headers?: [{ name, value }], body?, expected_status_codes?: (number|"2xx"|"200-299")[], follow_redirects?, assertions?: [{ source: status_code|header|json|body|response_time, path?, operator, value?, on_fail?: down|degraded }], latency_threshold_ms?, keyword?, keyword_mode?: contains|not_contains, case_sensitive? }`;
  tcp `{ host, port, latency_threshold_ms? }`; dns `{ hostname, record_type?, expected_values?, match?: any|all }`;
  tls `{ hostname, port?, warn_days? }`; heartbeat `{ grace_seconds? }`
- `GET|POST /projects/{project}/monitors` · `GET|PATCH|DELETE /projects/{project}/monitors/{monitor}`
  - write fields: everything above except state fields, plus `secret_headers?: [{ name, value }] | null` (write-only, encrypted; null removes) and `components?: ["<id|key>"]`
- `POST …/monitors/{monitor}/run` → `{ state, results: ProbeResult[] }` · `GET …/monitors/{monitor}/results?region=&limit=&cursor=` → `CheckResult { id, region, status, http_status, latency_ms, error, details, checked_at }`
- Heartbeats (no API key; the token is the secret): `GET|POST|HEAD /heartbeat/{token}` success, `GET|POST /heartbeat/{token}/fail` failure (`?message=` or body `{ message }`)

### Alerts
`AlertChannel { id, type: email|slack|teams|discord|webhook|pagerduty|opsgenie, name, enabled, config, secret_hint, recipients?: [{ email, verified }], created_at, updated_at }`
- `GET|POST /projects/{project}/alert-channels` · `GET|PATCH|DELETE …/{channel}` · `POST …/{channel}/test`
  - write `{ type, name, enabled?, config? (opsgenie: { region: us|eu }), secret?: { webhook_url } (slack/teams/discord) | { url, signing_secret? } (webhook) | { routing_key } (pagerduty) | { api_key } (opsgenie), recipients?: [email] (email; replaces the list) }`
`AlertRule { id, name, enabled, event_types: string[], component_ids, monitor_ids, min_status, channel_ids, cooldown_minutes, position }`
- `GET|POST /projects/{project}/alert-rules` · `PATCH|DELETE …/{rule}`
- `GET /projects/{project}/alert-events?limit&cursor` → `{ id, type, status, suppression_reason, created_at, deliveries: [{ target, target_type, status, attempts, error_message }] }`

### Subscribers
`Subscriber { id, type: email|slack|webhook, email, target_hint, component_ids, confirmed, created_at }`
- `GET|POST /projects/{project}/subscribers` (email subscribers receive a confirmation email) · `DELETE …/{subscriber}`

### Metrics and SLOs
- `GET /projects/{project}/metrics?from=&to=` → `{ uptime, components: [...], incidents: { total, by_impact, mtta_seconds, mttr_seconds, list }, slos: [...] }`
- `GET /projects/{project}/uptime?days=90` → `[{ component_id, slug, name, uptime, days: [{ date, status, downtime_minutes }] }]`
- `GET|POST /projects/{project}/slos` · `PATCH|DELETE …/{slo}` `{ name, target (0-100, exclusive), window_days: 7|14|28|30|90, component_id? }`

### Inbound integrations (external alerts)
`Integration { id, type: alertmanager|grafana|datadog|cloudwatch|generic, name, enabled, url (contains the token), default_component_id, default_status, auto_draft_incident, mappings: [{ match: { label: value }, component_id, status? }], last_received_at, received_count }`
- `GET|POST /projects/{project}/integrations` · `PATCH|DELETE …/{integration}`
- `POST /inbound/{token}` (no API key) accepts the provider's native payload and returns `{ upserted, resolved }`
