# Edge Functions de monitorización y alertas

| Función | Quién la llama | Qué hace |
|---|---|---|
| `monitor-runner` | pg_cron cada 30 s (`upvane-monitor-runner`) y "Run now" del panel | Reclama monitores con `claim_due_monitors(25)` durante ~25 s (8 a la vez), llama a `monitor-probe` una vez por región, evalúa con `_shared/monitoring/state.ts` y guarda con `record_monitor_run()`. |
| `monitor-probe` | `monitor-runner`, con la cabecera `x-region` (invocación regional de Supabase) | Ejecuta una comprobación (`http`, `keyword`, `tcp`, `dns`, `tls`) en su región y devuelve un `ProbeResult`. |
| `alert-worker` | `wake_alert_worker()` (pg_net) y pg_cron cada minuto (`upvane-alert-worker`) | Recupera entregas atascadas, lee la cola PGMQ `alert-deliveries` durante ~50 s y envía email (Resend o Mailpit), Slack, Teams, Discord, webhooks firmados, PagerDuty y Opsgenie. |
| `api` | Clientes de la API v0 | Proxy a `${PUBLIC_APP_URL}/api/v1/projects/...` con los nombres de la v0 y `Deprecation: true`. |

## Contratos

- `monitor-runner`: `POST`, `Authorization: Bearer MONITOR_RUNNER_SECRET`.
  - `{ "source": "cron" }` (por defecto) → `{ source, claimed, processed, persisted, failed, states, budget_exhausted, duration_ms }`.
  - `{ "monitor_id": "<uuid>" }` → `200 { state, results }`, `409 { error, code: "conflict" }` si se ejecutó hace menos de 10 s, `404 { error, code: "not_found" }` si no existe o es un heartbeat.
- `monitor-probe`: `POST`, `Authorization: Bearer MONITOR_PROBE_SECRET` (o `MONITOR_RUNNER_SECRET`), cuerpo `ProbeRequest` → `ProbeResult`. La región es `SB_REGION`; en local se usa `x-region` y se marca `details.region_simulated`.
  - Fallos del objetivo (timeout, DNS, conexión rechazada, SSRF, certificado) → `down`; fallos de la sonda (petición inválida, falta `UPVANE_SECRETS_KEY`) → `error`, que la máquina de estados ignora.
- `alert-worker`: `POST`, `Authorization: Bearer ALERT_WORKER_SECRET` (también `ALERTS_DISPATCHER_SECRET`).

## Variables

| Variable | runner | probe | worker | api |
|---|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (las pone Supabase) | sí | | sí | |
| `MONITOR_RUNNER_SECRET` | sí | sí (si no hay `MONITOR_PROBE_SECRET`) | | |
| `MONITOR_PROBE_SECRET` (opcional, secreto propio de la sonda) | sí | sí | | |
| `MONITOR_PROBE_REGIONS` (opcional, lista separada por comas) | sí | | | |
| `UPVANE_SECRETS_KEY` | | sí (cabeceras secretas) | sí | |
| `ALERT_WORKER_SECRET` | | | sí | |
| `PUBLIC_APP_URL` | | | sí | sí |
| `RESEND_API_KEY`, `ALERTS_EMAIL_FROM` | | | sí | |
| `LOCAL_MAILPIT_URL` (solo local, si no hay Resend) | | | sí | |

## Desarrollo

```bash
cd supabase/functions
deno task check   # deno check de las cuatro funciones
deno task test    # tests de Deno (fetch, DNS, TCP y TLS simulados)
# Ejecutar una función fuera del edge runtime:
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... deno run -A --env-file=.env monitor-runner/index.ts
```

Los cron jobs leen `SUPABASE_URL`, `MONITOR_RUNNER_SECRET` y `ALERT_WORKER_SECRET` de Vault; después de crearlos o rotarlos ejecuta `select public.schedule_upvane_jobs();`.
