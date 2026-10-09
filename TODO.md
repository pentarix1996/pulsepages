# Pendiente en Upvane

Fuente de verdad de lo que falta. Lo hecho está en `docs/` (estado a 9-oct-2026, rama `feat/v2-redesign-devops`); los
identificadores K-n remiten a `docs/08-known-issues.md`.

## Antes de abrir a clientes

- [ ] **Desplegar la v2**: Supabase Pro, extensiones, `db push`, secretos de funciones, Vault y
      `schedule_upvane_jobs()`; Vercel con las variables de `.env.example`. Pasos en `docs/06-operations.md`.
- [ ] **Dominio y email**: dominio oficial, dominio de envío verificado en Resend (DKIM, SPF, DMARC) y SMTP propio en
      Supabase Auth. No usar `onboarding@resend.dev` en producción.
- [ ] **Regiones de la sonda**: comprobar en producción qué regiones admite la invocación regional y ajustar
      `MONITOR_PROBE_REGIONS` si hace falta (K-4).
- [ ] **Legal**: Terms of Service y Privacy Policy (se tratan datos de incidencias, emails de suscriptores y URLs
      internas de clientes), enlazados desde la landing, el registro y el pie de las status pages.
- [ ] **Cobro real** (K-1): Stripe Checkout desde *Billing* y un webhook que llame a `change_organization_plan`. Mientras
      tanto `BILLING_MODE=demo`.

## Calidad

- [ ] **CI** (K-13): workflow con typecheck, lint, Vitest, `npm run test:sql` (Postgres 16 en el runner), `deno task
      check/test`, `go test` del provider y tests de la CLI y la Action.
- [ ] **E2E** (K-14): convertir en suite versionada los flujos que se probaron con Playwright (monitores,
      integraciones, alertas, suscripción y baja, página privada, API keys).

## Producto

- [ ] **SSO/SAML** para Business (K-2).
- [ ] **Revalidar la status page desde la base de datos** cuando un monitor o una señal cambian un componente (K-9).
- [ ] **Reverificación periódica de dominios propios** (K-6).
- [ ] P2 de la revisión de producto: status page multiidioma, widget/badge embebible, importador desde Statuspage o
      Instatus, SMS y llamadas, status page pública de Upvane.

## Limpieza tras migrar producción

- [ ] Borrar `component_monitor_configs`, `alert_channel_configs`, `alert_cooldowns` y `profiles.plan` (K-11).
- [ ] Retirar la Edge Function `api` (proxy v0) cuando no tenga tráfico (K-12).
