# Documentación de Upvane

Upvane es un SaaS de **status pages y monitorización para equipos DevOps y SRE**. Cada organización tiene status pages
(proyectos) con componentes, incidencias con estado explícito por componente, mantenimientos programados, monitores
multi-región, alertas enrutadas a Slack, Teams, Discord, webhooks, email, PagerDuty u Opsgenie, suscriptores en la
página pública y una API REST pensada para gestionarlo todo como código (Terraform, CLI y GitHub Action).

Esta carpeta es la fuente de verdad para cualquier persona o agente que vaya a tocar el código. Describe la versión 2
(rama `feat/v2-redesign-devops`, octubre de 2026). Léela en este orden:

| # | Documento | Para qué sirve |
|---|-----------|----------------|
| 1 | [01-overview.md](01-overview.md) | Qué es el producto, funcionalidades, planes y stack. |
| 2 | [02-architecture.md](02-architecture.md) | Piezas del sistema y flujos: estado de componentes, monitores, alertas, status page, API. |
| 3 | [03-data-model.md](03-data-model.md) | Tablas por área, RLS, funciones SQL, cron y retención. |
| 4 | [04-features.md](04-features.md) | Cada funcionalidad: cómo funciona, reglas de negocio y archivos implicados. |
| 5 | [05-api.md](05-api.md) | API pública `/api/v1`, API interna del panel `/api/app`, rutas públicas y feeds. |
| 6 | [06-operations.md](06-operations.md) | Variables de entorno, desarrollo local, despliegue, secretos, cron, email y dominios. |
| 7 | [07-agent-guide.md](07-agent-guide.md) | Convenciones, dónde va cada cosa, seguridad, tests y checklist de entrega. |
| 8 | [08-known-issues.md](08-known-issues.md) | Limitaciones conocidas, deuda técnica y lo que queda fuera del código. |
| 9 | [09-product-review.md](09-product-review.md) | Revisión de producto que motivó la v2 y estado de cada punto. |
| 9b | [09-scalability.md](09-scalability.md) | Capacidad estimada, cuellos de botella y límites a vigilar. |

Otros documentos del repositorio:

- `DESIGN.md`: sistema de diseño (tokens, tipografía Archivo + JetBrains Mono, componentes, movimiento). Obligatorio
  para cualquier cambio visual.
- `sdd/v2-devops-platform/`: especificación de la v2 (`design.md` contrato de producto, `api.md` contrato de la API,
  `conventions.md` capas y patrones). Si una decisión cambia, se actualiza allí y aquí.
- `TODO.md`: lo pendiente, en español.
- `integrations/terraform-provider-upvane`, `packages/cli`, `integrations/github-action`: cada uno con su README.
- `implementation.md`: plan original del MVP. Obsoleto en lo técnico; sólo contexto de negocio.

## Resumen en 30 segundos

- **App**: Next.js 16 (App Router, React 19, React Compiler, `proxy.ts`), TypeScript estricto, CSS propio con los
  tokens de `DESIGN.md`. El panel lee en Server Components con el cliente de Supabase ligado a la sesión (RLS por
  pertenencia a la organización) y escribe a través de rutas `app/api/app/**` que llaman a la capa de dominio
  (`lib/domain/**`). La API pública `app/api/v1/**` usa exactamente las mismas funciones de dominio.
- **Datos**: Supabase (Postgres + RLS + Auth + Vault + `pg_cron` + `pg_net` + PGMQ + Realtime). Las reglas que no se
  pueden saltar (estado efectivo de un componente, límites de plan, roles, enrutado de alertas) viven en SQL.
- **Trabajos**: Edge Functions en Deno: `monitor-runner` (cada 30 s), `monitor-probe` (una por región),
  `alert-worker` (cola PGMQ) y `api` (proxy de compatibilidad de la API v0 hacia `/api/v1`).
- **Código isomórfico**: `supabase/functions/_shared/**` (estados, planes, máquina de estados de monitores, aserciones,
  SSRF, cifrado, plantillas de alerta y email). Next lo importa como `@shared/*.ts`.
- **Calidad (9-oct-2026)**: `npm run typecheck` y `npm run lint` sin errores; `npm test` 27 ficheros / 337 tests;
  `npm run test:sql` 14 ficheros; `deno task check` y `deno task test` (48 tests); `go test ./...` en el provider;
  tests de la CLI (10) y de la Action (5); `next build` limpio.

## Mantener esta documentación

Si cambias comportamiento, actualiza el documento correspondiente en el mismo cambio:

- Tabla, columna, política o función SQL → `03-data-model.md` y una migración nueva en `supabase/migrations/`.
- Ruta nueva o cambio de contrato → `05-api.md` y la spec en `lib/api/spec/*` (genera `/api/v1/openapi.json` y `/docs/api`).
- Variable de entorno o secreto → `06-operations.md` y `.env.example`.
- Limitación resuelta o descubierta → `08-known-issues.md`.
