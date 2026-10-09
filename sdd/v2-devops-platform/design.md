# Upvane v2 — DevOps platform redesign

Spec for the change that implements `docs/09-product-review.md` (sections 1, 2-P0, 2-P1) and the visual redesign.
This file is the contract every implementer (human or agent) follows. Keep it updated when a decision changes.

## 0. Principles

- **Rules that must hold live in Postgres** (RLS, triggers, security-definer functions). Next routes, Edge Functions and the public API are thin callers.
- **One implementation per concern.** Isomorphic logic (status ranks, monitor assertions, state machine, alert rendering, SSRF, crypto, plans) lives in `supabase/functions/_shared/` and is imported by Next (`@shared/*`) and by Deno. No Deno globals, no URL imports and only relative `.ts` imports inside `_shared`.
- **Panel reads in Server Components** with the cookie-bound Supabase client (RLS by organization membership). **Mutations go through route handlers** (`app/api/app/**`) that call `lib/domain/**`. The public API (`app/api/v1/**`) calls the same domain functions with an API-key access context.
- **No global client store.** Pages refresh with `router.refresh()`; Supabase Realtime triggers a debounced refresh.
- UI copy in English; docs in Spanish.

## 1. Tenancy, roles, plans

- `organizations(id, name, slug unique, plan, sso_domain, require_2fa, created_by, created_at, updated_at)`. Every user gets a personal organization on sign-up whose slug equals `profiles.username` (so `/status/{username}/{slug}` keeps working).
- `organization_members(organization_id, user_id, role, created_at)`; roles ordered `viewer < responder < admin < owner`.
  - viewer: read everything (secrets never readable).
  - responder: viewer + incidents, incident updates, maintenance windows, component manual status, run checks, acknowledge.
  - admin: responder + components/groups/dependencies, monitors, alert channels/rules, integrations, status page settings, API keys, invitations (not owners).
  - owner: admin + plan/billing, owners/admins management, delete org.
- `organization_invitations(id, organization_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at)`.
- `audit_logs(id, organization_id, project_id, actor_type user|api_key|system, actor_id, actor_label, action, target_type, target_id, metadata, ip, created_at)`.
- `projects.organization_id` (backfilled from the owner's personal org). `projects.user_id` stays as "created by".
- Plan lives on `organizations.plan`; only `service_role` may change it (trigger). `profiles.plan` is deprecated (kept in sync for old clients, not writable by users). Plan changes go through `POST /api/app/billing/plan` (`BILLING_MODE=demo` writes directly with service role; `stripe` reserved).

Plan limits (single source: `_shared/plans.ts` + SQL `plan_limits(plan)`):

| | free | pro | business |
|---|---|---|---|
| status pages (projects) | 1 | 5 | unlimited |
| components / project | 10 | 50 | unlimited |
| monitors / org | 5 | 30 | 100 |
| min interval (s) | 180 | 60 | 30 |
| regions / monitor | 1 | 3 | all |
| subscribers / project | 100 | 2000 | unlimited |
| history days | 7 | 90 | 365 |
| API & IaC | no | yes | yes |
| custom domain, branding | no | yes | yes |
| private pages, SSO, audit log export | no | no | yes |
| team members | 3 | 10 | unlimited |
| alert channels | email, slack, teams, discord, webhook | + | + pagerduty, opsgenie |

## 2. Components and status computation

- `components` gains `slug` (unique per project, used by API/IaC), `description`, `group_id`, `position`, `created_at`, `updated_at`, `manual_status` (pinned override, nullable), `automated_status` (from monitors + external signals, nullable), `status_source`, `status_changed_at`. CHECK on every status column.
- `component_groups(id, project_id, name, position, collapsed)`; `component_dependencies(component_id, depends_on_id, impact)`, no cycles (trigger).
- **Effective status** (`components.status`) is computed only by `recompute_component_status(component_id, reason, incident_id)`:
  1. Active, non-draft incidents that include the component → worst of their current per-component statuses (`incident_components.status`). Humans own the status during an incident.
  2. Else maintenance `in_progress` that includes the component → `maintenance`.
  3. Else `manual_status` when set (pinned until cleared with "Return to automatic").
  4. Else worst of `automated_status` and dependency-derived status (dependency `major_outage` → `impact` (default `partial_outage`); dependency `partial_outage|degraded` → `degraded`).
  5. Else `operational`.
- It writes `component_status_history` when the effective status changes (reasons: `incident`, `incident_resolved`, `maintenance`, `manual`, `monitor`, `monitor_recovery`, `dependency`, `signal`, `system`) and emits `component_status_worsened` / `component_recovered` alert events.
- Triggers call it after changes to `incident_components`, `incidents.status|deleted_at`, `maintenances.status`, `maintenance_components`, `components.manual_status|automated_status`, and dependencies (depth-limited).
- Uptime weights (Atlassian-compatible defaults, per project override `projects.uptime_weights`): major 1.0, partial 0.3, degraded 0, maintenance excluded. Window starts at `max(now - N days, component.created_at)`. Computed in SQL (`component_uptime`, `component_daily_status`).

## 3. Incidents

- `incidents`: `impact none|minor|major|critical` (replaces severity; `severity` kept for v0 API compatibility, mapped critical→critical, high→major, medium→minor, low→none), statuses `draft|investigating|identified|monitoring|resolved`, timestamps `detected_at, acknowledged_at, acknowledged_by, published_at, resolved_at`, `created_by`, `source manual|monitor|signal|api|template`, `source_monitor_id`, `deleted_at` (soft delete), `updated_at`. `component_ids` is kept in sync from `incident_components` for compatibility.
- `incident_components(incident_id, component_id, status)` = current assertion per component.
- `incident_updates`: `kind update|note|system`, `visibility public|internal`, `component_statuses jsonb` snapshot, `notify_subscribers bool`, `created_by`, `actor_label`.
- Every mutation leaves a row: impact/title/component changes are logged as `system` updates by trigger. Delete = soft delete (`deleted_at`) + recompute.
- Draft incidents (from monitors) are never public and never change component status until published.
- `incident_templates(id, project_id, name, title, message, impact, component_statuses jsonb)`.
- `postmortems(id, incident_id unique, project_id, status draft|published, title, summary, impact, root_cause, resolution, action_items jsonb, timeline jsonb, published_at, created_by, updated_at)`. A draft is created on resolve when `projects.auto_postmortem` and impact ≥ major.

## 4. Maintenance

- `maintenances(id, project_id, title, description, status scheduled|in_progress|completed|cancelled, scheduled_start, scheduled_end, actual_start, actual_end, auto_start, auto_complete, notify_subscribers, reminder_minutes, reminder_sent_at, mute_alerts, created_by, ...)`, `maintenance_components`, `maintenance_updates`.
- `process_maintenance_windows()` (pg_cron every minute) starts/completes windows and sends reminders. Alerts for affected components are muted while `in_progress` when `mute_alerts`.

## 5. Monitors

- `monitors(id, project_id, name, type http|keyword|tcp|dns|tls|heartbeat, enabled, paused_reason, interval_seconds, timeout_ms, regions text[], confirm_failures, confirm_regions, recovery_successes, config jsonb, failure_status, degraded_status, state pending|up|degraded|down|paused, state_changed_at, last_checked_at, next_check_at, last_result jsonb, heartbeat_token, last_heartbeat_at, tls_expires_at, tls_checked_at, auto_draft_incident, created_by, ...)`.
- `monitor_components(monitor_id, component_id)` (N:M). `monitor_secrets(monitor_id, headers_encrypted)` never readable by clients. `monitor_region_state(monitor_id, region, consecutive_bad, consecutive_up, confirmed, last_status, last_latency_ms, last_error, last_checked_at)`.
- `monitor_check_results` gains `monitor_id, region, details jsonb`; `config_id` becomes nullable (legacy).
- Regions are Supabase Edge regions (`eu-central-1`, `us-east-1`, `ap-southeast-1`, `sa-east-1`, `eu-west-2`, `us-west-2`, `ap-northeast-1`, `ap-southeast-2`, `ap-south-1`, `ca-central-1`, ...). `monitor-runner` (cron every 30 s) claims due monitors with `claim_due_monitors()` (`for update skip locked`), calls `monitor-probe` once per region with the `x-region` header, evaluates results with `_shared/monitoring/state.ts` and persists them with `record_monitor_run()`.
- State machine: per region a result is `up|degraded|down`; `consecutive_bad` reaching `confirm_failures` confirms the latest bad status; `consecutive_up` reaching `recovery_successes` confirms `up`. Monitor state = `down` if ≥ quorum regions confirmed down, else `degraded` if ≥ quorum regions confirmed bad, else `up`; quorum = `min(confirm_regions, active regions)`. Probe infrastructure errors are `unknown` and never count.
- Monitor → component: `up → operational`, `degraded → degraded_status`, `down → failure_status`; component `automated_status` = worst of linked monitors and active external signals.
- HTTP config: method, URL, headers (+ encrypted secret headers), body, expected status codes/ranges, follow redirects (≤5, SSRF re-check each hop), keyword contains/not contains, JSON/header assertions with `on_fail down|degraded`, latency threshold → degraded, TLS warning days. TCP: host, port. DNS: hostname, record type, expected values. TLS: hostname, port, warn days. Heartbeat: grace seconds; pings at `/api/v1/heartbeat/{token}` (`/fail` reports failure).
- SSRF: https only for HTTP; blocks private/reserved IPv4/IPv6 including IPv4-mapped (`::ffff:0:0/96`), NAT64, `240.0.0.0/4`, CGNAT; validates on save and before every request/hop.

## 6. Alerts

- `alert_channels(id, project_id, type email|slack|teams|discord|webhook|pagerduty|opsgenie, name, enabled, config jsonb (non-secret), secret_encrypted, created_by, ...)`; `alert_email_recipients(channel_id, email, verified_at, token_hash)` (double opt-in unless the email belongs to an org member); `alert_rules(id, project_id, name, enabled, event_types text[], component_ids uuid[], monitor_ids uuid[], min_status, channel_ids uuid[], cooldown_minutes)`.
- `project_alert_configs` keeps `enabled` (master switch) and `mute_during_maintenance`.
- `enqueue_alert_event_and_dispatch()` applies: master switch → test events go to the requested channel → maintenance mute → matching rules → anti-flap cooldown per (rule, component/monitor): worsened events inside the cooldown are suppressed; a recovery is only sent if the last sent event for that key was a worsening → creates deliveries (email: one per verified recipient) → PGMQ → wakes `alert-worker` through `pg_net` (debounced). Suppressed events keep `suppression_reason`.
- Event types: `component_status_worsened, component_recovered, monitor_down, monitor_degraded, monitor_recovered, tls_expiring, heartbeat_missed, incident_created, incident_updated, incident_resolved, incident_draft_created, maintenance_scheduled, maintenance_started, maintenance_completed, test`.
- `alert-worker` delivers email (Resend, full template), Slack/Teams/Discord incoming webhooks, signed generic webhooks (`Upvane-Signature: t=<ts>,v1=<hmac-sha256(secret, ts + "." + body)>`), PagerDuty Events v2 (trigger/resolve, `dedup_key`), Opsgenie (create/close by alias). `processing` deliveries older than 5 minutes are recovered.

## 7. Status page and subscribers

- Project status page settings: `visibility public|private`, `brand_color`, `logo_url`, `theme_default light|dark|system`, `timezone`, `hide_powered_by`, `custom_domain`, `custom_domain_status`, `allowed_ips cidr[]`, `support_url`, `auto_postmortem`, `auto_draft_incidents`.
- `status_page_access_tokens(id, project_id, name, token_hash, created_by, expires_at, revoked_at)`.
- `get_status_page(org_slug, project_slug)` (security definer; anon gets public projects only; service role gets any) returns everything the page needs, with history trimmed by plan.
- `status_page_subscribers(id, project_id, type email|slack|webhook, email, target_encrypted, component_ids, confirmed_at, confirm_token_hash, unsubscribe_token_hash, created_at)`; notifications for public incident updates and maintenance go through the same delivery pipeline (`alert_events.audience = 'subscribers'`).
- Routes: `/status/[org]/[slug]` (+ `/incidents/[id]`, `/maintenance/[id]`, `/history`, `/feed.rss`, `/feed.atom`, `/api/v2/summary.json`, `/api/v2/status.json`). Custom domains are rewritten by `proxy.ts`. Cached with `unstable_cache` (30 s) and tag `status-page:{org}/{slug}`.

## 8. API keys and public API

- `api_keys`: `organization_id`, `project_id` (null = every project of the org), `scopes text[] (read, write)`, `prefix`, `expires_at`, `last_used_at`, `revoked_at`, `created_by`. New keys `upv_live_<32 bytes base62>`; `pp_live_` still accepted. Keys are generated and hashed on the server only. Rotation creates a new key and gives the old one a grace expiry.
- Public API in Next under `/api/v1` (`api.<domain>/v1` is rewritten). Errors `{ "error": string, "code": string }`. Rate limit per key (`X-RateLimit-*`), `Idempotency-Key` on POST, audit log on every mutation, OpenAPI at `/api/v1/openapi.json`, docs at `/docs/api`.
- The legacy Edge Function `api` becomes a proxy to `/api/v1` (same behaviour everywhere).
- Inbound signals: `inbound_integrations(id, project_id, type alertmanager|grafana|datadog|cloudwatch|generic, name, token, enabled, mappings jsonb, default_component_id, default_status, auto_draft_incident, last_received_at)` and `component_signals`. Endpoint `POST /api/v1/inbound/{token}`.

## 9. Metrics

- `slos(id, project_id, component_id null, name, target, window_days)`; `get_project_metrics(project_id, from, to)` → uptime per component, incident count, MTTA, MTTR, error budget per SLO. Monthly SLA report page + CSV.

## 10. Panel information architecture

```
/projects                         project list + create
/p/[projectId]/overview           incident banner, KPIs, components with 90-day bars, live checks, maintenance, status page card
/p/[projectId]/incidents          list + declare
/p/[projectId]/incidents/[id]     command view: composer (stages, per-component status, public/internal, notify), timeline, details
/p/[projectId]/maintenance        list + schedule ; /[id] detail
/p/[projectId]/monitors           list + create ; /[id] detail (chart, regions, config, routing, recent checks)
/p/[projectId]/components         components, groups, dependencies
/p/[projectId]/alerts             channels, rules, deliveries
/p/[projectId]/integrations       inbound signals, heartbeats, Terraform/CLI snippets
/p/[projectId]/status-page        branding, domain, visibility, access tokens, subscribers
/p/[projectId]/reports            SLOs, MTTA/MTTR, monthly SLA report
/p/[projectId]/postmortems/[id]   editor
/settings/account | security (2FA) | organization | members | api-keys | billing | audit-log
```
Old URLs (`/dashboard`, `/project/[id]`, `/incidents`, `/monitoring`, `/alerts`, `/settings`, `/dashboard/settings/api`) redirect.

## 11. Environment

New variables: `UPVANE_SECRETS_KEY` (base64 32 bytes, Next + Edge), `BILLING_MODE` (`demo`), `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (optional, custom domains), `CUSTOM_DOMAIN_CNAME_TARGET`, `NEXT_PUBLIC_APP_URL` (required), `PUBLIC_APP_URL` (Edge), `MONITOR_PROBE_REGIONS` (optional allow-list).
