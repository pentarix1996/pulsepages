# v2 implementation conventions

How code is organised in the v2 rewrite. Read with `design.md` (product contract), `api.md` (public API contract)
and `/DESIGN.md` (visual system). The components slice is the reference implementation of every pattern below:
`lib/domain/components.ts`, `lib/domain/schemas/components.ts`, `lib/api/spec/components.ts`,
`app/api/v1/projects/[project]/components/**`, `app/api/app/projects/[projectId]/components/**`,
`app/(panel)/p/[projectId]/components/page.tsx`, `components/panel/components/ComponentsManager.tsx`.

## Layers

| Layer | Where | Rules |
|---|---|---|
| Database rules | `supabase/migrations/*.sql` | Business invariants, RLS, plan limits, status computation. New SQL goes in a new migration file; never edit an applied v1 migration. Add tests in `supabase/tests/sql/NN_*.test.sql` and run `PG_TEST_PORT=<your port> ./scripts/test-sql.sh <filter>`. |
| Isomorphic logic | `supabase/functions/_shared/**` (import as `@shared/x.ts` from Next) | Pure TS: no Deno globals, no npm or URL imports, relative `.ts` imports only. Used by Next and Edge Functions. |
| Domain | `lib/domain/<area>.ts` (+ `schemas/<area>.ts`) | `import 'server-only'`. Every function takes a `DomainContext` first, calls `requireProject(ctx, ref, minRole)` (or `requireOrganization`), uses `ctx.db`, throws `DomainError` (helpers in `errors.ts`, `unwrap`/`unwrapOne` for Supabase results), calls `audit()` after each mutation and `invalidateStatusPage()` when the public page changes. Returns API-shaped resources (`toXResource`). |
| Panel API | `app/api/app/**/route.ts` | `appHandler` from `lib/http/app.ts`: session auth + same-origin check. Validate with `readJson(request, schema)`. Return `{ data, status? }` or nothing (204). |
| Public API | `app/api/v1/**/route.ts` | `apiHandler({ scope, idempotent }, handler)` from `lib/http/api.ts`; export `OPTIONS = apiOptions`. Lists return `{ data, nextCursor }`. Register every operation in `lib/api/spec/<area>.ts` with `operation()` and name response schemas with `resource()`. Token endpoints (heartbeat, inbound) use `tokenHandler`. |
| Pages | `app/(panel)/**/page.tsx` | Server Components. `const ctx = await panelContext()`; read through the domain layer wrapped in `guard()` (not found → 404). Pass plain data to one client "manager" component per page. |
| Client components | `components/panel/<area>/*.tsx` | `'use client'`. Mutations with `appRequest()` (`lib/client/api.ts`) inside `useAction().run()` (`lib/client/use-action.ts`), which toasts and calls `router.refresh()`. No global store, no `window.confirm` (use `useConfirm`), no `alert()`. Filters live in the URL (`useSearchParams` + `router.replace`). |

## Access rules

- Roles: viewer < responder < admin < owner (`@shared/domain.ts`). Pass the minimum role to `requireProject`.
  responder: incidents, maintenance, pins, run checks, acknowledge. admin: configuration. owner: billing and owners.
- API keys act as `admin` (write scope) or `viewer` (read scope) inside their organization (or single project).
  Organization-level actions (members, billing, API keys, org settings) call `requireDashboardUser(ctx)`.
- `ctx.db` is RLS-bound for users and service-role-with-actor-header for API keys (the database applies the same
  guards). `ctx.admin()` bypasses everything: use it only after an explicit check, for writes no policy allows
  (secrets tables, audit log, invitations email, plan changes).
- Secrets (monitor headers, channel URLs/keys, subscriber targets) are encrypted with `encryptJson(value, env.secretsKey())`
  from `@shared/crypto.ts` and written with `ctx.admin()` to tables without client policies. Never return them; return
  hints (`secretHint`).
- Monitor and webhook URLs: validate with `@shared/monitoring/ssrf.ts` on save (`validateMonitorUrlWithDns` with a
  `node:dns/promises` resolver) and the Edge Functions re-check before every request.

## UI rules

- Use the kit in `components/ui/*` and classes in `styles/ui.css` / `styles/panel.css`; do not edit those shared files.
  Area-specific CSS goes in `styles/panel/<area>.css`, imported by your page. Prefer existing classes.
- Page skeleton: `<PageHeader title subtitle actions crumbs />`, then cards (`Card`, `CardHeader`), grid tables
  (`.tbl` + `.tr` with `--cols`), `Dialog` for create/edit, `useConfirm` for destructive actions, `EmptyState`.
- Copy in English, sentence case, active verbs; same verb in the button and its toast ("Publish" → "Published").
- Status always shows text next to color (`StatusPill`). Technical values (`.mono`): URLs, keys, regions, codes, ms.
- Times: `RelativeTime` in lists, `formatDateTime` (`lib/format.ts`) for absolute values.

## Working agreements (parallel agents)

- Only create or edit files in the paths assigned to you. Shared files (`lib/domain/{access,context,errors,audit,cache,
  pagination,types}.ts`, `lib/http/*`, `lib/api/openapi.ts`, `components/ui/*`, `styles/{tokens,base,ui,panel}.css`,
  `proxy.ts`, `package.json`) are read-only: if you need a change there, describe it in your final report.
- Type-check with `npx tsc --noEmit` and only fix errors in your files (other agents work in parallel). Run your tests
  with `npx vitest run <your paths>`. Do not run `next build`, `supabase start/stop/db reset`, or `git commit`.
- Tests: Vitest under `__tests__/unit/<area>/` (mock `@/lib/supabase/*` or domain modules with `vi.mock`), SQL tests for
  new SQL. Test behaviour that matters (authorization, validation, mapping), not markup.
- UI copy in English, code comments in English, docs in Spanish.
