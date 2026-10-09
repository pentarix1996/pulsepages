# 08 · Limitaciones conocidas y deuda técnica

Estado a 9-oct-2026, rama `feat/v2-redesign-devops`. Los bugs de la revisión anterior (C-1 … B-13) quedaron resueltos en
la rama `fix/security-bugs-scalability` y la v2 reescribe las zonas afectadas; aquí sólo queda lo que sigue abierto.

**Verificación de la rama**: `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅ 27 ficheros / 337 tests ·
`npm run test:sql` ✅ 14 ficheros (incluye invariantes de seguridad del esquema y retención) · `deno task check` +
`deno task test` ✅ 48 tests · `go test ./...` ✅ · CLI ✅ 10 · Action ✅ 5 · `next build` ✅. Además se probaron en navegador los flujos
de monitores, integraciones, alertas, verificación de destinatarios, suscripción y baja (email real en Mailpit), página
privada con enlace de acceso, API keys y rotación, y el ciclo completo de Terraform, la CLI y la Action contra la API
local.

Leyenda: ⏸ abierto a propósito · ⚠️ requiere acción fuera del código · 🔧 deuda técnica

## Producto y negocio

| ID | Estado | Tema | Detalle |
|----|--------|------|---------|
| K-1 | ⏸ | Cobro real | `BILLING_MODE=demo` cambia el plan sin pagar. El plan ya no es editable por usuarios (sólo el rol de servicio, con audit log), así que el antiguo C-4 está cerrado; falta conectar Stripe (checkout + webhook que llame a `change_organization_plan`). |
| K-2 | ⏸ | SSO/SAML | Existe `organizations.sso_domain` (se muestra en la puerta de las páginas privadas) pero no hay proveedor SAML configurado. |
| K-3 | ⏸ | P2 de la revisión | Status page multiidioma, widget embebible, importador desde Statuspage/Instatus, SMS y llamadas. |

## Operación

| ID | Estado | Tema | Detalle |
|----|--------|------|---------|
| K-4 | ⚠️ | Regiones reales | La sonda usa la invocación regional de Supabase (`x-region`). Hay que comprobar en el proyecto de producción que todas las regiones de `_shared/regions.ts` están disponibles; si no, limitar con `MONITOR_PROBE_REGIONS`. En local las regiones son simuladas. |
| K-5 | ⚠️ | Jobs y secretos | Sin los secretos de Vault (`SUPABASE_URL`, `MONITOR_RUNNER_SECRET`, `ALERT_WORKER_SECRET`) y `schedule_upvane_jobs()`, ni los monitores ni las alertas funcionan. Ver [06-operations.md](06-operations.md#despliegue). |
| K-6 | ⚠️ | Dominios propios | Sin `VERCEL_API_TOKEN` el dominio hay que añadirlo a mano en Vercel. La verificación se lanza al guardar y con el botón *Verify*; no hay un job que la repita sola. |
| K-7 | ⚠️ | Auth | SMTP propio, MFA y *JWT signing keys* asimétricas se configuran en el panel de Supabase. |
| K-8 | ⚠️ | Migración de producción | `db push` convierte los datos de la v1 (probado con datos sembrados en `supabase/tests/harness/legacy_seed.sql`). Tras migrar, los destinatarios de alertas que no sean miembros deben confirmar su email otra vez. |

## Deuda técnica

| ID | Estado | Tema | Detalle |
|----|--------|------|---------|
| K-9 | 🔧 | Caché de la status page | Las mutaciones del dominio invalidan la caché al momento, pero los cambios que hacen los monitores o las señales dentro de la base de datos tardan hasta 30 s en verse (TTL). Opción: que `emit_component_transition` llame por `pg_net` a una ruta de revalidación firmada. |
| K-10 | 🔧 | Volumen de resultados | Mitigado: los resultados en bruto se conservan 7/14/30 días según el plan y la purga es horaria. Si algún día se quieren gráficas de latencia de más de 7 días, hará falta una tabla de agregados por hora (ver [09-scalability.md](09-scalability.md)). |
| K-11 | 🔧 | Tablas v1 | `component_monitor_configs`, `alert_channel_configs`, `alert_cooldowns` y `profiles.plan` se conservan por compatibilidad; borrarlas cuando producción haya migrado. |
| K-12 | 🔧 | API v0 | La Edge Function `api` es un proxy hacia `/api/v1` con `Deprecation: true`. Retirarla cuando no haya tráfico. |
| K-13 | 🔧 | CI | No hay workflow de CI en el repositorio. Recomendado: typecheck, lint, Vitest, tests SQL (Postgres 16 en el runner), Deno, Go, CLI y Action en cada PR. |
| K-14 | 🔧 | E2E | Los flujos de navegador se han probado con scripts de Playwright fuera del repositorio. Falta convertirlos en una suite E2E versionada. |
| K-15 | 🔧 | DNS rebinding | Las sondas validan la IP resuelta antes de cada petición y salto, pero la conexión vuelve a resolver el nombre. El riesgo residual se acota con HTTPS (el certificado debe coincidir con el host). |
| K-16 | 🔧 | Emails desde Next | La confirmación de suscripción y las invitaciones se envían en la petición (sin cola). Si Resend falla, la persona ve un error y puede reintentar. |

## Datos de prueba en local

Las pruebas manuales dejan filas en la base de datos local (monitores y heartbeats de prueba, incidencias y
mantenimientos de los agentes). `npx supabase db reset` vuelve al seed.
