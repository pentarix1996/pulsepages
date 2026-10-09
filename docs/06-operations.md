# 06 · Operación: entorno, desarrollo local y despliegue

## Variables de entorno

La lista completa y comentada está en `.env.example`. Next lee `.env.local`; las Edge Functions leen
`supabase/functions/.env` en local (`supabase functions serve --env-file`) y los secretos de Supabase en producción.
Nunca pongas secretos en variables `NEXT_PUBLIC_*` ni en migraciones.

### Next.js

| Variable | Obligatoria | Uso |
|----------|-------------|-----|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sí | Cliente de Supabase (navegador y servidor). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Sólo servidor: API keys, secretos, audit log, status pages privadas, cambio de plan. |
| `NEXT_PUBLIC_APP_URL` | Sí | URL pública sin barra final: enlaces de status pages, emails, feeds y documentación. |
| `UPVANE_SECRETS_KEY` | Sí | 32 bytes aleatorios en base64 (`openssl rand -base64 32`). Cifra cabeceras secretas, secretos de canales y destinos de suscriptores, y deriva los tokens de baja. **El mismo valor en Next y en las Edge Functions.** Rotarlo invalida todo lo cifrado. |
| `MONITOR_RUNNER_SECRET` | Sí | Compartido con `monitor-runner`: permite "Run now". |
| `BILLING_MODE` | No | `demo` cambia el plan sin cobrar. Cualquier otro valor responde 501. |
| `UPVANE_API_HOST` | No | Host que sirve la API (`api.example.com/v1` → `/api/v1`). |
| `RESEND_API_KEY`, `ALERTS_EMAIL_FROM` | En producción | Emails de confirmación de suscriptores e invitaciones desde Next. |
| `LOCAL_MAILPIT_URL` | Local | Sin `RESEND_API_KEY`, los emails van a Mailpit. |
| `CUSTOM_DOMAIN_CNAME_TARGET` | Para dominios propios | Destino del CNAME que se muestra al cliente. |
| `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | No | Si están, los dominios propios se añaden al proyecto de Vercel para emitir TLS. |
| `UPVANE_DEV_LOGIN` | Sólo local | `1` activa `/api/dev/login`. Nunca en producción (además la ruta no existe con `NODE_ENV=production`). |

### Edge Functions (secretos de Supabase)

| Secreto | Funciones |
|---------|-----------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Las pone Supabase. |
| `PUBLIC_APP_URL` | `alert-worker` (enlaces), `api` (destino del proxy). |
| `UPVANE_SECRETS_KEY` | `monitor-probe`, `alert-worker`. Mismo valor que en Next. |
| `MONITOR_RUNNER_SECRET` | `monitor-runner`, `monitor-probe` (si no hay `MONITOR_PROBE_SECRET`). |
| `MONITOR_PROBE_SECRET` | Opcional: secreto propio entre runner y sonda. |
| `MONITOR_PROBE_REGIONS` | Opcional: lista de regiones permitidas (`eu-central-1,us-east-1`). |
| `MONITOR_PROBE_URL` | Opcional: URL de la sonda (stacks locales). |
| `ALERT_WORKER_SECRET` | `alert-worker`. |
| `RESEND_API_KEY`, `ALERTS_EMAIL_FROM` | `alert-worker`. |
| `LOCAL_MAILPIT_URL` | Sólo local (`http://host.docker.internal:54324`). |

### Vault (para `pg_cron` + `pg_net`)

| Nombre | Valor |
|--------|-------|
| `SUPABASE_URL` | URL del proyecto (`https://<ref>.supabase.co`). |
| `MONITOR_RUNNER_SECRET` | El mismo que en Next y en la función. |
| `ALERT_WORKER_SECRET` | El mismo que en la función. |

Tras crear o rotar estos secretos: `select public.schedule_upvane_jobs();`.

## Desarrollo local

Requisitos: Node 22, Supabase CLI (va en `devDependencies`), Docker, Deno 2 (Edge Functions), Go 1.24 (provider) y
Postgres 16 si quieres los tests SQL fuera de Docker.

```bash
npm install
cp .env.example .env.local            # rellena las claves locales que imprime `npx supabase status`
npx supabase start                    # API :54321 · DB :54322 · Studio :54323 · Mailpit :54324
npx supabase db reset                 # aplica migraciones + supabase/seed.sql
npx supabase functions serve --env-file supabase/functions/.env
npm run dev                           # http://localhost:3000
```

- **Datos de ejemplo** (`supabase/seed.sql`): organización `quillbase` (Business) con la página `status`
  (`/status/quillbase/status`), componentes, monitores, incidencias, mantenimientos y alertas. Usuarios
  `owner@upvane.test` (owner) y `oncall@upvane.test` (responder), contraseña `upvane-demo-1`. API key de prueba
  `upv_live_demo0000000000000000000000000000000000`.
- **Entrar sin formulario**: con `UPVANE_DEV_LOGIN=1`, `http://localhost:3000/api/dev/login?email=owner@upvane.test&next=/projects`.
- **Capturas**: `node scripts/screenshot.mjs <ruta> <salida.png> [--full] [--width 390] [--anon] [--dark]`.
- **Jobs en local**: sin secretos en Vault los jobs HTTP no se programan. Para probar el ciclo completo, crea en Vault
  `SUPABASE_URL = http://host.docker.internal:54321` y los dos secretos, y ejecuta `select public.schedule_upvane_jobs();`.
  También puedes invocar las funciones a mano con `curl -X POST -H "Authorization: Bearer $SECRETO" http://127.0.0.1:54321/functions/v1/monitor-runner`.
- **Emails**: sin `RESEND_API_KEY` llegan a Mailpit (`http://127.0.0.1:54324`).
- **Regiones**: en local `monitor-probe` no se ejecuta en varias regiones; devuelve la región pedida marcada como simulada.
- **La sonda no arranca en local** (`worker boot error … Failed loading … @types/node`): el edge runtime descarga los
  tipos de Node por el `import 'node:tls'` y no puede llegar a npm (por ejemplo detrás de un proxy TLS). Ejecuta la
  sonda con Deno fuera del contenedor (`DENO_CERT=<ca> deno run -A monitor-probe/index.ts`) y apunta
  `MONITOR_PROBE_URL` a ella.

## Calidad: comandos

| Comando | Qué comprueba |
|---------|---------------|
| `npm run typecheck` | TypeScript estricto. |
| `npm run lint` | ESLint (flat config con `eslint-config-next` + TypeScript). |
| `npm test` | Vitest: dominio, status page, alertas, monitorización, SSRF, cifrado, landing. |
| `npm run test:sql [filtro]` | Crea un Postgres 16 desechable, aplica todas las migraciones (con datos v1 antes de la v2) y ejecuta `supabase/tests/sql/*.test.sql`. `PG_TEST_PORT` cambia el puerto (54329 por defecto). |
| `cd supabase/functions && deno task check && deno task test` | Tipos y tests de las Edge Functions. |
| `cd integrations/terraform-provider-upvane && go test ./...` | Esquema del provider. |
| `cd packages/cli && npm test` · `cd integrations/github-action && npm test` | CLI y Action. |
| `npm run build` | Build de producción (ya no ejecuta el linter). |

## Despliegue

### Supabase

1. Plan Pro recomendado (el Free pausa proyectos y se queda corto de disco con monitores; ver
   [09-scalability.md](09-scalability.md)).
2. Activa las extensiones `pg_cron`, `pg_net`, `pgmq` y Vault (Database → Extensions / Integrations).
3. `npx supabase link --project-ref <ref>` y `npx supabase db push`. Las migraciones son idempotentes y convierten los
   datos de la v1 (organización personal por usuario, monitores y canales migrados, severidad → impacto).
4. Secretos de las funciones: `npx supabase secrets set UPVANE_SECRETS_KEY=… MONITOR_RUNNER_SECRET=… ALERT_WORKER_SECRET=… PUBLIC_APP_URL=… RESEND_API_KEY=… ALERTS_EMAIL_FROM=…`.
5. Funciones: `npx supabase functions deploy monitor-probe` y después `monitor-runner alert-worker api`
   (`verify_jwt = false` ya está en `supabase/config.toml`; cada función valida su secreto). La sonda va primero: el
   runner envía lotes de comprobaciones que una sonda anterior no entiende.
6. Vault: crea `SUPABASE_URL`, `MONITOR_RUNNER_SECRET` y `ALERT_WORKER_SECRET` y ejecuta `select public.schedule_upvane_jobs();`.
   Comprueba con `select jobname, schedule from cron.job;` (cinco jobs `upvane-*`).
7. Auth: SMTP propio (Resend SMTP) para los emails de registro, MFA TOTP activado, `site_url` y URL de redirección con
   el dominio de producción, y *JWT signing keys* asimétricas para que `getClaims` verifique en local.
8. Storage: la migración crea el bucket público `branding` (logos, 1 MB, PNG/JPEG/WebP/SVG).

### Vercel

1. Variables de la tabla de Next (con `SUPABASE_SERVICE_ROLE_KEY`, `UPVANE_SECRETS_KEY` y `MONITOR_RUNNER_SECRET` como
   secretos de servidor).
2. Dominio de la app y, si se quiere, `api.<dominio>` apuntando al mismo proyecto con `UPVANE_API_HOST`.
3. Dominios propios de clientes: el cliente crea un CNAME a `CUSTOM_DOMAIN_CNAME_TARGET`; con `VERCEL_API_TOKEN` y
   `VERCEL_PROJECT_ID` Upvane añade el dominio al proyecto y Vercel emite el certificado. Sin token, hay que añadirlo a
   mano en Vercel.
4. Las rutas "Run now" usan `maxDuration = 60`; el plan de Vercel debe permitirlo.

### Email (Resend)

1. Verifica el dominio de envío en Resend (DKIM, SPF/Return-Path y DMARC recomendado).
2. Crea una API key y configura `RESEND_API_KEY` y `ALERTS_EMAIL_FROM` (por ejemplo `Upvane <alerts@upvane.com>`) en
   Vercel y en los secretos de Supabase. No uses `onboarding@resend.dev` en producción.
3. Los emails a suscriptores llevan `List-Unsubscribe` y `List-Unsubscribe-Post`; las bajas en un clic llegan por
   `POST /subscriptions/unsubscribe`.

### Tras desplegar

- Abre `/status/<org>/<slug>`, `/api/v1/openapi.json` y `/docs/api`.
- Crea un monitor y comprueba que aparecen resultados de varias regiones en su detalle.
- Envía una alerta de prueba desde *Alerts and routing* y revisa *Activity*.
- En la base de datos: `select status, count(*) from alert_deliveries group by 1;` y
  `select * from cron.job_run_details order by start_time desc limit 10;`.

## Migraciones: reglas

- Nunca edites una migración aplicada: crea otra (`supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`).
- Idempotentes (`if not exists`, `create or replace`, `drop policy if exists`).
- Toda tabla nueva con RLS; toda función `security definer` con `set search_path` y `revoke execute … from public,
  anon, authenticated`. El test `17_security_invariants` falla si no.
- Añade o amplía un test en `supabase/tests/sql/` y ejecuta `npm run test:sql`.
- `npx supabase db reset` en local re-ejecuta todo y el seed (borra los datos locales).
