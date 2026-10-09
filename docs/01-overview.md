# 01 · Visión general del producto

## Qué es Upvane

Upvane es la capa de **detección y comunicación de incidencias** para equipos que operan servicios en producción:

1. Una persona se registra y recibe una **organización personal** (su slug es su `username`, así que las URL
   `/status/{username}/{slug}` de la v1 siguen funcionando). Puede crear más organizaciones e invitar a su equipo con
   roles `viewer < responder < admin < owner`.
2. Cada organización tiene **status pages** (en el código, *projects*). Cada página tiene **componentes** (API, web,
   base de datos…), opcionalmente agrupados y con dependencias entre ellos.
3. El estado de cada componente lo deciden, por este orden: las **incidencias** activas (cada actualización fija el
   estado de cada componente de forma explícita), los **mantenimientos** en curso, un estado **fijado a mano** y, si no
   hay nada de lo anterior, los **monitores** y las **señales externas** (Alertmanager, Grafana, Datadog, CloudWatch).
4. Los **monitores** comprueban HTTP, keyword, TCP, DNS, certificados TLS y heartbeats desde varias regiones, con
   confirmación (N fallos seguidos en un quórum de regiones) antes de cambiar nada.
5. Las **alertas** se enrutan con reglas (eventos, componentes, monitores, estado mínimo, cooldown) a canales: email con
   doble opt-in, Slack, Teams, Discord, webhook firmado con HMAC, PagerDuty y Opsgenie.
6. La **status page pública** muestra el estado, barras de 90 días por componente, incidencias con su timeline,
   mantenimientos, historial, feeds RSS/Atom, JSON compatible con Statuspage, suscripción (email, Slack, webhook),
   hora local del visitante, modo claro/oscuro, marca del cliente, dominio propio y acceso privado.
7. Todo se puede automatizar con la **API v1** (keys con scopes, rotación sin corte, idempotencia), el **provider de
   Terraform**, la **CLI** `upvane` y la **GitHub Action** que abre un mantenimiento durante un despliegue.

## Funcionalidades (estado a 9-oct-2026)

| Área | Qué incluye | Dónde vive |
|------|-------------|------------|
| Landing | Historia de una caída real paso a paso, precios, FAQ | `app/page.tsx`, `components/landing/*` |
| Cuentas | Registro, login, 2FA (TOTP), recuperación de contraseña, perfil | `app/(auth)/*`, `app/(panel)/settings/{account,security}` |
| Organizaciones y equipo | Varias organizaciones, invitaciones por email, roles, exigir 2FA, salir de una organización | `settings/{organization,members}`, `lib/domain/{organizations,members,invitations}.ts` |
| Status pages (proyectos) | Crear, renombrar, cambiar slug, borrar; lista por organización | `/projects`, `lib/domain/projects.ts` |
| Overview | Banner de incidencia, KPIs, componentes con barras de 90 días, checks en vivo, próximos mantenimientos, checklist de puesta en marcha | `/p/[projectId]/overview` |
| Componentes | Grupos, orden por arrastre, descripciones, dependencias, estado fijado y "volver a automático" | `/p/[projectId]/components` |
| Incidencias | Declarar (o desde plantilla), borradores automáticos desde monitores o señales, acknowledge, actualizaciones públicas o notas internas, estado por componente, publicar, resolver, borrado lógico | `/p/[projectId]/incidents` |
| Postmortems | Borrador automático al resolver (impacto ≥ major), timeline precargado, acciones, publicar en la status page | `/p/[projectId]/postmortems/[id]` |
| Mantenimientos | Programar, inicio y fin automáticos, recordatorio previo a suscriptores, silencio de alertas, actualizaciones | `/p/[projectId]/maintenance` |
| Monitores | HTTP/keyword (método, cabeceras, cabeceras secretas cifradas, body, códigos esperados, redirecciones, aserciones JSON/cabecera/body/tiempo, umbral de latencia), TCP, DNS, TLS, heartbeat; multi-región con confirmación; gráfica p50/p95; "Run now" | `/p/[projectId]/monitors` |
| Integraciones | Receptores de Alertmanager, Grafana, Datadog, CloudWatch y genérico con mapeo a componentes; heartbeats; snippets de Terraform, CLI, GitHub Action y curl | `/p/[projectId]/integrations` |
| Alertas | Canales, destinatarios con doble opt-in, reglas ordenadas con vista previa en lenguaje natural, silencio en mantenimientos, envío de prueba, actividad con motivos de supresión | `/p/[projectId]/alerts` |
| Status page pública | Lo descrito en el punto 6, con permalinks, historial paginado y `noindex` en las páginas privadas | `app/status/[org]/[slug]/**` |
| Ajustes de la status page | Marca (color, logo, tema), zona horaria, pesos de uptime, visibilidad, IPs permitidas, enlaces de acceso, dominio propio, suscriptores (export CSV) | `/p/[projectId]/status-page` |
| Informes | Uptime por componente, MTTA/MTTR, SLOs con error budget, export CSV, informe SLA mensual imprimible | `/p/[projectId]/reports` |
| API keys | Varias por organización, opcionalmente limitadas a un proyecto, scopes `read`/`write`, caducidad, rotación con periodo de gracia, revocación | `/settings/api-keys` |
| Facturación | Cambio de plan con resumen de efectos (monitores que se pausan, etc.); `BILLING_MODE=demo` sin cobro real | `/settings/billing` |
| Audit log | Todas las mutaciones con actor (persona, API key o sistema), filtros, export CSV en Business | `/settings/audit-log` |
| Documentación | Guía de inicio y referencia de la API generada desde OpenAPI | `/docs`, `/docs/api`, `/api/v1/openapi.json` |
| Panel | Tiempo real (Supabase Realtime con refresco), command palette (⌘K), responsive | `components/panel/*` |

### Fuera del código o no implementado

- Cobro real con Stripe (el modo `demo` cambia el plan sin pagar; ver [08-known-issues.md](08-known-issues.md)).
- SSO/SAML (el dominio SSO de la organización existe y se usa en la página privada, pero no hay proveedor SAML).
- Status page multiidioma, widget embebible, importador desde Statuspage/Instatus, SMS y llamadas (P2 de la revisión).

## Planes

Fuente única: `supabase/functions/_shared/plans.ts` y su espejo SQL `plan_limit(plan, key)`.

| | Free | Pro | Business |
|---|---|---|---|
| Status pages | 1 | 5 | Ilimitadas |
| Componentes por página | 10 | 50 | Ilimitados |
| Monitores por organización | 5 | 30 | 100 |
| Intervalo mínimo | 180 s | 60 s | 30 s |
| Regiones por monitor | 1 | 3 | Todas (15) |
| Suscriptores por página | 100 | 2.000 | Ilimitados |
| Historial en la status page | 7 días | 90 días | 365 días |
| Miembros | 3 | 10 | Ilimitados |
| API, Terraform, CLI, Action | — | ✅ | ✅ |
| Dominio propio y marca | — | ✅ | ✅ |
| Páginas privadas, PagerDuty/Opsgenie, export del audit log | — | — | ✅ |
| Rate limit de la API | — | 600/min | 1.200/min |
| Precio | $0 | $9/mes ($7 anual) | $29/mes ($24 anual) |

Al bajar de plan, `enforce_plan_limits()` pausa los monitores sobrantes (los más nuevos primero, `paused_reason =
'plan_limit'`), recorta intervalos y regiones y suspende el dominio propio; al subir, los reanuda. El diálogo de cambio
de plan lo explica antes de confirmar (`planChangeEffects`).

## Stack

| Capa | Tecnología |
|------|------------|
| Framework | Next.js 16.3 (App Router, Turbopack, `reactCompiler: true`, `proxy.ts` en lugar de middleware) |
| UI | React 19.2, CSS propio (`styles/*.css`), tipografías Archivo y JetBrains Mono (`next/font`) |
| Lenguaje | TypeScript 6 estricto; alias `@/*` (raíz) y `@shared/*` (`supabase/functions/_shared`) |
| Datos | Supabase: Postgres 17 + RLS, Auth (con MFA), Vault, `pg_cron`, `pg_net`, PGMQ, Realtime, Storage (logos) |
| Jobs | Edge Functions (Deno): `monitor-runner`, `monitor-probe`, `alert-worker`, `api` |
| Email | Resend (HTTP), Mailpit en local |
| Validación | zod 4 (esquemas de dominio, que también generan la spec OpenAPI) |
| Tests | Vitest 4 + Testing Library; tests SQL sobre Postgres 16 desechable; `deno test`; `go test`; `node --test` |
| IaC | Provider de Terraform en Go (plugin framework), CLI en Node sin dependencias, GitHub Action en Node 20 |
| Hosting previsto | Vercel (app, dominios propios con TLS automático) + Supabase |
