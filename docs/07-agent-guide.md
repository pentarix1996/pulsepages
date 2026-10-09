# 07 · Guía para agentes: convenciones y reglas de trabajo

## Antes de empezar

1. Lee `docs/README.md`, el documento de la zona que vas a tocar y `sdd/v2-devops-platform/conventions.md`.
2. **Next.js 16 tiene cambios incompatibles** con lo que puedas recordar: lee la guía correspondiente en
   `node_modules/next/dist/docs/` antes de escribir código (`params` y `searchParams` son Promises, `proxy.ts` sustituye a
   `middleware.ts`, `next lint` ya no existe, `revalidateTag` pide perfil, etc.).
3. Revisa `docs/08-known-issues.md` y `TODO.md`.
4. Si tocas la base de datos, añade una migración nueva y un test SQL.

## Dónde poner cada cosa

| Necesitas… | Hazlo en… |
|------------|-----------|
| Una regla que no se pueda saltar (límites, roles, estados, enrutado) | Postgres: RLS, CHECK, trigger o función en una migración nueva. Repítela en cliente sólo como UX. |
| Lógica que usan Next y las Edge Functions | `supabase/functions/_shared/**`, TS puro con imports relativos `.ts`; desde Next `@shared/x.ts`. Nunca la dupliques. |
| Una operación de negocio (leer o escribir) | `lib/domain/<área>.ts` con su esquema zod en `lib/domain/schemas/<área>.ts`. |
| Una ruta del panel | `app/api/app/**/route.ts` con `appHandler` y `readJson(request, schema)`. |
| Una ruta de la API pública | `app/api/v1/**/route.ts` con `apiHandler({ scope, idempotent })`, `export const OPTIONS = apiOptions` y la operación registrada en `lib/api/spec/<área>.ts`. |
| Una pantalla del panel | `app/(panel)/**/page.tsx` (Server Component: `panelContext()` + dominio dentro de `guard()`) y un componente cliente en `components/panel/<área>/`. |
| Estilos | Kit en `components/ui/*` y clases de `styles/ui.css` / `styles/panel.css`. CSS de un área en `styles/panel/<área>.css`, importado por su página. Status page: `styles/status.css`. Sigue `DESIGN.md`. |
| Acceso privilegiado | `ctx.admin()` sólo tras una comprobación explícita (secretos, audit log, invitaciones, plan). Nunca en componentes cliente. |
| Algo que tarda o corre en segundo plano | Edge Function o job de `pg_cron`, no una ruta de Next. |

## Patrones de código

- **Dominio**: `requireProject(ctx, ref, 'responder')` al principio; `unwrap`/`unwrapOne` para resultados de Supabase;
  errores con `invalid()`, `notFound()`, `conflict()`, `forbidden()`; `audit()` después de cada mutación;
  `invalidateStatusPage()` (o `touchStatusPage`) si cambia algo público; devuelve recursos con forma de API.
- **Contexto**: `DomainContext` tiene `actor` (`user` o `api_key`), `db` (RLS para usuarios; servicio con
  `x-upvane-actor` para keys), `admin()`, `ip` y `requestId`. Las acciones de organización (miembros, facturación,
  API keys) llaman a `requireDashboardUser(ctx)`.
- **Secretos**: `encryptJson(valor, env.secretsKey())` de `@shared/crypto.ts`, escritos con `ctx.admin()` en tablas sin
  políticas de cliente. Se devuelven pistas (`secretHint`), nunca el valor.
- **URLs externas** (monitores, webhooks, suscriptores webhook): `validateMonitorUrlWithDns` de
  `@shared/monitoring/ssrf.ts` al guardar; las Edge Functions validan otra vez antes de cada petición y salto.
- **Cliente**: `appRequest()` dentro de `useAction().run(fn, { success, successDescription, refresh })`, que muestra el
  toast, devuelve `fieldErrors` por ruta y llama a `router.refresh()`. `useConfirm({ title, description, confirmLabel,
  requireText })` para acciones destructivas. `useToast()` para avisos sueltos. Filtros en la URL. Sin store global,
  sin `window.confirm` ni `alert()`.
- **Hooks**: el linter aplica las reglas del React Compiler (`react-hooks/set-state-in-effect`, `purity`, `refs`). Para
  relojes usa `useNow()` de `components/ui/Time.tsx`; para estado derivado, `useState` y no refs leídas en render.
- **Fechas**: `RelativeTime` en listas, `formatDateTime` (`lib/format.ts`) para valores absolutos; en la status page,
  `LocalTime`/`formatStamp` (zona del visitante).
- **Copy**: inglés, frases en *sentence case*, verbos activos; el mismo verbo en el botón y en su toast ("Publish" →
  "Published"). El estado siempre lleva texto además de color. Datos técnicos en `.mono`.
- **Idioma**: código, UI y mensajes en inglés; documentación (`docs/`, `TODO.md`, `sdd/`) en español.

## Seguridad: reglas que no se negocian

1. Toda tabla accesible desde el navegador tiene RLS correcta. Asume que un atacante llama a PostgREST con la
   publishable key y su JWT.
2. Las funciones `security definer` fijan `search_path`, hacen `revoke execute … from public, anon, authenticated`,
   conceden sólo a quien la necesita y validan sus argumentos (`17_security_invariants` lo comprueba).
3. Las URLs de monitores y webhooks pasan la validación SSRF al guardar y antes de cada petición.
4. Las API keys, tokens de acceso, de invitación, de confirmación y de baja sólo se guardan hasheados.
5. Secretos sólo en entorno de servidor, secretos de Supabase o Vault. Nunca en migraciones ni en `NEXT_PUBLIC_*`.
6. Toda ruta que recibe un proyecto comprueba la pertenencia y el rol (`requireProject`) antes de leer o escribir.
7. Los enlaces de un solo uso que llegan por email (confirmar suscripción, baja, verificar destinatario) piden un clic:
   los escáneres de enlaces no deben poder ejecutarlos.
8. Nada de `dangerouslySetInnerHTML` salvo los scripts inline de la status page (`InlineScript`, que escapa `<`, U+2028
   y U+2029). En emails, todo valor dinámico pasa por el escape de la plantilla.

## Testing

- Vitest en `__tests__/unit/<área>/`. El patrón de dominio usa `__tests__/unit/projects/fake-db.ts` (`fakeDb`, `userCtx`,
  `apiKeyCtx`) y `vi.mock('@/lib/domain/access')` para fijar el rol. `server-only` se sustituye por un mock.
- Prueba lo que importa: autorización, validación, mapeos y efectos (audit, invalidación), no el marcado.
- SQL: `supabase/tests/sql/NN_*.test.sql` con los helpers `tests.as_user()`, `tests.as_anon()`, `tests.as_service()`,
  `tests.as_api_key()`. Cada fichero va en una transacción con `rollback`.
- Edge Functions: `*_test.ts` junto a cada función, con fetch, DNS, TCP y TLS simulados.
- Flujos en navegador: `scripts/screenshot.mjs` y scripts de Playwright (`playwright-core` con
  `/opt/pw-browsers/chromium` en este entorno).

## Checklist de entrega

- [ ] `npm run typecheck`, `npm run lint` y `npm test` en verde.
- [ ] `npm run test:sql` si hay SQL; `deno task check && deno task test` si tocas `supabase/functions`.
- [ ] `npm run build` si tocas rutas, layouts o configuración.
- [ ] Migración nueva e idempotente, con RLS, `search_path` y `revoke`.
- [ ] Spec de la API actualizada si cambia un contrato (`lib/api/spec/*`); provider, CLI y Action si les afecta.
- [ ] Variables nuevas en `.env.example` y `docs/06-operations.md`.
- [ ] `docs/` actualizado; `08-known-issues.md` y `TODO.md` si procede.
- [ ] Sin secretos ni datos reales en el diff.
- [ ] Cambios visuales según `DESIGN.md`, revisados en móvil (390 px), en claro y oscuro en la status page, y con
      `prefers-reduced-motion`.

## Zonas frágiles

- `recompute_component_status` y los triggers que la llaman: cualquier cambio afecta a status pages, alertas y uptime.
- `enqueue_alert_event_and_dispatch` y `finalize_alert_event`: orden de reglas, cooldowns y concurrencia del worker.
- `_shared/monitoring/state.ts`: la máquina de confirmación por región (tests en `__tests__/unit/shared/state.test.ts`).
- `_shared/monitoring/ssrf.ts`: la usan Next, la sonda y el worker.
- `proxy.ts`: dominios propios, API host, sesión y redirecciones; un error aquí rompe todas las páginas.
- `lib/status-page/time.ts` (`formatStamp`): su código fuente se inyecta en la página; debe seguir siendo ES5 y sin
  dependencias.
- `lib/http/api.ts`: autenticación, rate limit e idempotencia de toda la API pública.
