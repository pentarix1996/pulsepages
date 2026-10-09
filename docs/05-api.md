# 05 · API y rutas

Hay cuatro superficies HTTP:

| Superficie | Prefijo | Autenticación | Para quién |
|------------|---------|---------------|------------|
| API pública v1 | `/api/v1/**` (también `https://api.<dominio>/v1/**`) | `Authorization: Bearer upv_live_…` | Clientes, Terraform, CLI, GitHub Action |
| Endpoints con token | `/api/v1/heartbeat/{token}`, `/api/v1/inbound/{token}` | El token de la URL | Cron jobs del cliente, Alertmanager, Grafana, Datadog, CloudWatch |
| API interna del panel | `/api/app/**` | Sesión de Supabase (cookies) + mismo origen | El propio panel |
| Rutas públicas | `/status/**`, `/api/public/**`, `/subscriptions/**`, `/alerts/verify`, `/invite/{token}` | Ninguna, token de un solo uso o acceso a página privada | Visitantes y destinatarios de emails |

La referencia completa y siempre actualizada de la API v1 está en `/docs/api` (generada desde la spec) y en
`/api/v1/openapi.json`. El contrato humano que siguen el provider, la CLI y la Action está en
`sdd/v2-devops-platform/api.md`. Este documento resume convenciones y dónde vive cada cosa.

## API pública v1

### Convenciones

- **Keys**: pertenecen a una organización y pueden limitarse a un proyecto. Scopes `read` y `write`. Requieren plan Pro o
  Business (`402 plan_required`). Las `pp_live_` de la v1 siguen funcionando. Una key con `write` actúa como admin de su
  ámbito; con `read`, como viewer.
- **Respuestas**: `{ "data": … }`; listas `{ "data": [...], "next_cursor": string | null }` con `?limit=1..100&cursor=`.
- **Errores**: `{ "error": "mensaje legible", "code": "…", "details"?: [{ path, message }], "request_id": "req_…" }`.
  Códigos: `unauthorized 401`, `plan_required 402`, `plan_limit 402`, `forbidden 403`, `not_found 404`,
  `conflict 409`, `idempotency_conflict 409`, `invalid_request 422`, `rate_limited 429`, `unavailable 503`,
  `internal 500`.
- **Referencias**: `{project}` acepta id o slug; `{component}` acepta id o *key* (slug). El resto son UUID.
- **Idempotencia**: `Idempotency-Key` en los POST de creación y acciones; la primera respuesta se reproduce durante 24 h
  (`Idempotent-Replayed: true`). Reutilizar la clave con otro cuerpo → `409 idempotency_conflict`.
- **Rate limit** por key: 600/min (Business 1.200). Cabeceras `X-RateLimit-Limit|Remaining|Reset` y `Retry-After`.
- Todas las respuestas llevan `X-Request-Id`; todas las mutaciones quedan en el audit log con la key como actor.
- CORS abierto (las keys no viajan en cookies). Fechas en ISO 8601 UTC.
- `PUT` se acepta como alias de `PATCH` en componentes e incidencias (compatibilidad v0).

### Recursos (49 rutas)

| Área | Rutas |
|------|-------|
| Identidad | `GET /me` |
| Status pages | `GET/POST /projects` (crear sólo con keys de organización) · `GET/PATCH/DELETE /projects/{project}` · `GET /projects/{project}/status` · `POST …/custom-domain/verify` |
| Componentes | `GET/POST …/components` · `GET/PATCH/PUT/DELETE …/components/{component}` · `PUT …/status` (fijar o `null` para volver a automático) · `PUT …/dependencies` · `GET/POST …/component-groups` · `PATCH/DELETE …/component-groups/{group}` |
| Incidencias | `GET/POST …/incidents` (`?status=active\|draft\|resolved\|all`) · `GET/PATCH/PUT/DELETE …/incidents/{incident}` · `POST …/updates` · `POST …/acknowledge` · `POST …/publish` · `GET/PUT …/postmortem` · `POST …/postmortem/publish\|unpublish` · `GET/POST …/incident-templates` · `PATCH/DELETE …/incident-templates/{template}` |
| Mantenimientos | `GET/POST …/maintenances` (`?status=upcoming\|active\|past\|all`) · `GET/PATCH/DELETE …/maintenances/{maintenance}` · `POST …/start\|complete\|cancel\|updates` |
| Monitores | `GET/POST …/monitors` · `GET/PATCH/DELETE …/monitors/{monitor}` · `POST …/run` · `GET …/results?region=&limit=&cursor=` |
| Alertas | `GET/POST …/alert-channels` · `GET/PATCH/DELETE …/alert-channels/{channel}` · `POST …/test` · `GET/POST …/alert-rules` · `PATCH/DELETE …/alert-rules/{rule}` · `GET …/alert-events` |
| Suscriptores | `GET/POST …/subscribers` · `DELETE …/subscribers/{subscriber}` |
| Métricas | `GET …/metrics?from=&to=` · `GET …/uptime?days=` · `GET/POST …/slos` · `PATCH/DELETE …/slos/{slo}` |
| Integraciones | `GET/POST …/integrations` · `PATCH/DELETE …/integrations/{integration}` |
| Spec | `GET /openapi.json` |

Los secretos son de sólo escritura: `secret_headers` de monitores, `secret` de canales y destinos de suscriptores se
guardan cifrados y la API sólo devuelve nombres o pistas (`secret_hint`, `target_hint`).

### Endpoints con token

- `GET|POST|HEAD /api/v1/heartbeat/{token}` registra un éxito; `GET|POST /api/v1/heartbeat/{token}/fail` un fallo
  (`?message=` o cuerpo `{ "message" }`). Sin API key: el token es el secreto. Respuesta `{ data: { state } }`.
- `POST /api/v1/inbound/{token}` acepta el payload nativo del proveedor de la integración y responde `{ data: {
  upserted, resolved } }`. CloudWatch: además confirma la suscripción SNS abriendo `SubscribeURL` sólo si es de
  `sns.<región>.amazonaws.com`.

### Cómo se implementa una ruta

```ts
// app/api/v1/projects/[project]/components/route.ts
export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => {
  const { components } = await listComponents(ctx, params.project)
  return { data: components, nextCursor: null }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, componentCreateInput)
  return { data: await createComponent(ctx, params.project, input), status: 201 }
})
```

Cada operación se registra en `lib/api/spec/<área>.ts` con `operation()`; los esquemas zod de
`lib/domain/schemas/*` generan la spec. `/docs/api` se construye con `lib/api/reference.ts`.

### Compatibilidad v0

La Edge Function `api` (`supabase/functions/api`) reenvía las llamadas v0 a `/api/v1` con la misma key. Los campos v0
(`severity`, `component_ids`, `description`) se traducen en el dominio.

## API interna del panel (`/api/app`)

- `appHandler` (`lib/http/app.ts`): exige sesión de usuario, rechaza peticiones de otro sitio (`Sec-Fetch-Site`) y
  devuelve `{ data }` o 204. Mismo formato de error que la API pública.
- Las rutas son las de la API v1 con `projectId` en lugar de `{project}` (ver `app/api/app/projects/[projectId]/**`) más
  lo que sólo hace una persona: cuenta (`/account`, `/account/email`, `/account/password`), organizaciones,
  invitaciones, miembros, API keys (`/api-keys`, `/api-keys/{id}/rotate`), plan (`/billing/plan`), export del audit log,
  logo (`/projects/{id}/logo`, multipart), dominio propio (`PUT/DELETE /projects/{id}/custom-domain`, `POST …/verify`),
  enlaces de acceso, reordenar componentes y reglas, reenviar verificación de destinatarios, exports CSV de
  suscriptores e informes (`/reports/export?kind=uptime|incidents&from=&to=`).
- En el cliente: `appRequest(path, { method, body })` (`lib/client/api.ts`) dentro de `useAction().run()`.
- `/api/dev/login` sólo existe con `NODE_ENV !== production` y `UPVANE_DEV_LOGIN=1` (inicio de sesión de usuarios de
  `supabase/seed.sql` para capturas y pruebas).

## Rutas públicas

| Ruta | Qué hace |
|------|----------|
| `/status/{org}/{slug}` | Status page. En un dominio propio, la raíz del dominio. |
| `…/incidents/{id}`, `…/maintenance/{id}`, `…/history?before=&after=` | Permalinks e historial. |
| `…/feed.rss`, `…/feed.atom` | Últimas 50 incidencias y mantenimientos. |
| `…/api/v2/summary.json`, `…/api/v2/status.json` | JSON compatible con Statuspage (CORS `*` en páginas públicas). |
| `POST /api/public/status/{org}/{slug}/subscribe` | Suscripción (JSON → `201 { data: { result, message, signing_secret? } }`; formulario → 303 a la página con `?subscribe=`). |
| `GET /api/public/status/{org}/{slug}/access?token=&next=` | Canjea un enlace de acceso por una cookie y redirige sin el token. |
| `/subscriptions/confirm?token=`, `/subscriptions/unsubscribe?token=` | Páginas que piden un clic para confirmar o darse de baja. |
| `POST /subscriptions/unsubscribe?token=` | Baja en un clic (RFC 8058); `proxy.ts` la envía a `/api/public/subscriptions/unsubscribe`. |
| `/alerts/verify?token=` | Confirmación de un destinatario de alertas (con clic). |
| `/invite/{token}` | Ver y aceptar una invitación. |
| `/docs`, `/docs/api` | Documentación. |

## `proxy.ts`

1. Peticiones `POST` de baja en un clic → ruta de la API.
2. `api.<dominio>/v1/*` → `/api/v1/*` (si `UPVANE_API_HOST` está configurado).
3. Dominios propios → `/status/{org}/{slug}/*` (con `resolve_custom_domain`; un dominio desconocido va a
   `/status/domain-not-found`).
4. API, feeds y status pages no tocan la sesión del panel.
5. Refresco de la sesión de Supabase, rutas protegidas del panel y redirecciones 308 de las URL de la v1
   (`/dashboard`, `/project/{id}`, `/incidents`, `/monitoring`, `/alerts`, `/settings`, `/dashboard/settings/api`).
