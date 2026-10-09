# 04 · Funcionalidades

Cada sección explica cómo funciona, las reglas de negocio y los archivos implicados. El patrón es siempre el mismo:
SQL (`supabase/migrations`) → dominio (`lib/domain/<área>.ts`) → rutas (`app/api/app/**` y `app/api/v1/**`) → página
(`app/(panel)/**`) → componente cliente (`components/panel/<área>/*`).

## Cuentas, organizaciones y equipo

- **Registro**: crea `profiles` (con `username` único generado), una organización personal (`slug = username`) y la
  pertenencia como owner (`handle_new_user`). Contraseña: 8+ caracteres con mayúscula, minúscula y número.
- **2FA**: TOTP con Supabase MFA (`/settings/security`). Si un usuario tiene un factor verificado, el layout del panel
  exige `aal2`; si una organización tiene `require_2fa`, sus miembros sin factor van a la página de seguridad.
- **Invitaciones**: un admin invita por email con rol (sólo un owner puede invitar owners). Se guarda el hash del token;
  el enlace `/invite/{token}` muestra la invitación y la acepta al iniciar sesión con ese email. Reenviar y revocar.
- **Miembros**: cambiar rol, quitar, salir de una organización. Siempre queda al menos un owner (trigger).
- **Selector de organización**: cookie en el panel (`OrgSwitcher`); los ajustes de organización, miembros, API keys,
  facturación y audit log son de la organización activa.
- Archivos: `lib/domain/{organizations,members,invitations,account}.ts`, `app/(panel)/settings/*`, `app/invite/[token]`.

## Status pages (proyectos)

- `/projects` lista las páginas por organización; crear pide nombre y slug (único por organización). El límite de
  páginas por plan lo aplica SQL.
- Cambiar el slug cambia la URL pública: el panel pide confirmación.
- Borrar una página (admin) se hace desde *Status page → Danger zone* y exige escribir su slug.
- Archivos: `lib/domain/projects.ts`, `components/panel/projects/ProjectsManager.tsx`.

## Overview

`/p/[projectId]/overview` reúne en una sola carga (`getOverview`): banner de la incidencia activa (y de borradores pendientes de
publicar), KPIs (uptime de 30 días con el error budget del SLO, incidencias abiertas, MTTR y monitores), componentes con barras de 90 días, checks en vivo (se refrescan cada 20 s
mientras la pestaña está visible; las filas nuevas entran animadas), próximos mantenimientos, tarjeta de la status page
y una checklist de puesta en marcha que se puede ocultar (cookie por proyecto).

## Componentes

- Grupos plegables, orden por arrastre (`components/reorder`), descripción (aparece como tooltip en la página pública).
- **Estado**: el panel muestra el estado efectivo y su fuente. "Pin status" fija `manual_status` (rol responder);
  "Return to automatic" lo borra. Mientras haya una incidencia activa, manda la incidencia.
- **Dependencias**: "API depende de Database (impacto partial outage)". Sin ciclos.
- El límite de componentes por página lo aplica SQL (también por la API).
- Archivos: `lib/domain/components.ts`, `components/panel/components/ComponentsManager.tsx`.

## Incidencias

- **Declarar** (responder): título, impacto (`none/minor/major/critical`), estado inicial, componentes con su estado
  explícito, mensaje, notificar a suscriptores. Se puede partir de una **plantilla**.
- **Vista de mando** (`/incidents/[id]`): composer con etapas (Investigating → Identified → Monitoring → Resolved),
  estado por componente, visibilidad pública o **nota interna**, notificar o no; timeline *append-only* con quién hizo
  cada cosa (persona, API key o sistema); detalles con tiempos (detectada, reconocida, publicada, resuelta).
- **Acknowledge** registra `acknowledged_at` (MTTA). Repetirlo no hace nada.
- **Borradores**: los crean monitores, integraciones o la API con `status: draft`. No son públicos ni cambian
  componentes hasta publicar. Publicar exige elegir estado.
- **Borrar** (admin) es lógico: desaparece de la página pública y deja de afectar a componentes.
- Compatibilidad v0: `severity` (critical/high/medium/low) se traduce a impacto y `component_ids` reciben el estado que
  implicaba la severidad.
- Archivos: `lib/domain/incidents.ts`, `lib/domain/incident-templates.ts`, `components/panel/incidents/*`.

## Postmortems

- Al resolver con impacto ≥ major y `auto_postmortem` activo se crea un borrador (`ensure_postmortem_draft`); también
  se puede crear a mano desde la incidencia.
- Editor con cinco secciones (resumen, impacto, causa raíz, resolución, lecciones), acciones (responsable, fecha,
  enlace, hecho) y timeline precargado desde la incidencia (editable). Indicador de cambios sin guardar y aviso al salir.
- Publicar muestra en la página pública el título, las secciones y los títulos de las acciones; responsables, fechas,
  enlaces y timeline siguen siendo internos. Se puede despublicar.
- Archivos: `lib/domain/postmortems.ts`, `components/panel/postmortems/PostmortemEditor.tsx`.

## Mantenimientos

- Programar (responder): ventana, componentes, inicio y fin automáticos, aviso a suscriptores, recordatorio N minutos
  antes y silencio de alertas.
- `process_maintenance_windows()` (cada minuto) inicia y completa ventanas y envía recordatorios. Mientras está en
  curso, los componentes pasan a `maintenance` (salvo incidencia activa) y, si `mute_alerts`, sus alertas se suprimen
  con motivo `maintenance`.
- Acciones manuales: iniciar, completar, cancelar (una cancelada muestra las horas programadas), publicar
  actualizaciones.
- Archivos: `lib/domain/maintenances.ts`, `components/panel/maintenance/*`.

## Monitores

- **Tipos y configuración**:
  - HTTP/keyword: método, URL (https), cabeceras, **cabeceras secretas** (cifradas con `UPVANE_SECRETS_KEY`, nunca se
    devuelven; en el formulario se ven como "saved"), body, códigos esperados (`200`, `2xx`, `200-299`), seguir
    redirecciones (hasta 5, revalidando SSRF en cada salto), keyword (contiene / no contiene), aserciones sobre código,
    cabecera, JSON path, body o tiempo de respuesta con resultado `down` o `degraded`, umbral de latencia → degradado.
  - TCP: host y puerto. DNS: nombre, tipo de registro, valores esperados (cualquiera o todos). TLS: host, puerto, días
    de aviso (evento `tls_expiring`). Heartbeat: periodo de gracia.
- **Frecuencia y regiones** limitadas por plan; selector de regiones por continente. **Confirmación**: fallos seguidos
  por región, regiones que deben coincidir y éxitos para recuperar; el formulario lo resume en una frase.
- **Componentes** vinculados (N:M) y estado al fallar o degradarse. **Borrador automático** de incidencia al caer.
- **Detalle**: estado por región, gráfica de tiempos de respuesta p50/p95 por región (24 h / 7 días) con la línea del
  umbral, configuración, enrutado de alertas que le afecta, checks recientes con filtros y paginación, y para heartbeats
  la URL de ping con ejemplos.
- **Run now** devuelve el resultado de cada región en el momento. Pausar y reanudar. El límite de monitores es por
  organización.
- Archivos: `lib/domain/{monitors,heartbeats}.ts`, `supabase/functions/_shared/monitoring/*`,
  `supabase/functions/monitor-{runner,probe}`, `components/panel/monitors/*`.

## Integraciones (alertas externas)

- Receptores para Alertmanager, Grafana, Datadog, CloudWatch (SNS, confirma la suscripción) y genérico. Cada uno tiene
  una URL con token (`/api/v1/inbound/{token}`), mapeos `label=valor → componente (estado)`, componente y estado por
  defecto y borrador automático de incidencia.
- La página muestra los pasos de configuración de cada proveedor (plantilla de Datadog incluida), la lista de
  heartbeats y snippets de **configuración como código** (Terraform, CLI, GitHub Action y curl) con el slug real del
  proyecto. Sólo admins.
- Archivos: `lib/domain/integrations.ts`, `lib/domain/inbound/*`, `components/panel/integrations/IntegrationsManager.tsx`.

## Alertas

- **Canales**: email (destinatarios con doble opt-in salvo miembros del equipo; reenviar verificación), Slack, Teams,
  Discord (URL de webhook validada por proveedor), webhook genérico (https público, firma HMAC opcional con secreto que
  se genera y se muestra una vez; rotable), PagerDuty (routing key) y Opsgenie (API key, región US/EU). PagerDuty y
  Opsgenie requieren Business.
- **Reglas** ordenadas (subir/bajar): tipos de evento agrupados, canales, componentes y monitores (vacío = todos),
  estado mínimo, cooldown. Vista previa en lenguaje natural ("Incidents (new) → Team email · every component · cooldown
  15 min") y avisos si la regla no puede entregar nada.
- **Ajustes**: interruptor general y silencio durante mantenimientos.
- **Probar** un canal envía un evento `test` sólo a ese canal (limitado).
- **Actividad**: eventos con su estado, motivo de supresión (`disabled`, `maintenance`, `cooldown`, `no_rule`, …) y
  entregas por destino con intentos y error.
- Archivos: `lib/domain/alerts.ts`, `supabase/functions/_shared/alerts/*`, `supabase/functions/alert-worker`,
  `components/panel/alerts/*`, `app/alerts/verify` (confirmación de destinatarios con clic).

## Status page pública

- **Inicio**: banner global con frase que nombra lo afectado ("API is affected and Database is under maintenance"),
  incidencias activas con su última actualización, mantenimientos, componentes por grupo con barras de 90 días (30 en
  móvil) y tooltip por día, y "Past 7 days".
- **Permalinks** de incidencia (timeline completo, cambios de componentes por actualización, postmortem publicado) y de
  mantenimiento. **Historial** paginado por meses (cursores `before`/`after`), limitado por el plan.
- **Visitante**: tema claro/oscuro/sistema (recordado por página), zona horaria detectada o elegida, suscripción
  (popover y tarjeta; funciona sin JavaScript), feeds y JSON.
- **Marca**: color (con contraste garantizado), logo (PNG/JPEG/WebP/SVG ≤ 1 MB; SVG sin scripts ni referencias
  externas), tema por defecto, ocultar "Powered by" (Pro).
- **Privada** (Business): acceso para miembros, enlaces con token (se crean, se muestran una vez y se revocan) o lista
  de IPs/CIDR. `noindex` y caché privada.
- **Dominio propio** (Pro): el cliente apunta un CNAME a `CUSTOM_DOMAIN_CNAME_TARGET`; con `VERCEL_API_TOKEN` el dominio
  se añade al proyecto de Vercel para emitir TLS. Estados `pending`, `verified`, `error`, `suspended` (al bajar de plan).
- Archivos: `app/status/[org]/[slug]/**`, `lib/status-page/*`, `components/status/**`, `styles/status.css`,
  `lib/domain/{status-page-settings,custom-domains,access-tokens}.ts`, `components/panel/status-page/*`.

## Suscriptores

- Email (doble opt-in), Slack y webhook firmado, por toda la página o por componentes. Límite por plan (al superarlo, el
  visitante ve un mensaje claro y se le propone el RSS).
- Baja con un clic (RFC 8058) o desde la página de baja, que pide confirmar.
- Panel: KPIs, filtros, alta manual, baja, export CSV.
- Archivos: `lib/status-page/{subscribe,subscriptions}.ts`, `lib/domain/subscribers.ts`, `app/subscriptions/*`,
  `app/api/public/**`.

## Informes y SLOs

- Periodo (7/30/90 días o mes), uptime por componente, incidencias con impacto y duración, MTTA y MTTR, SLOs con error
  budget restante y export CSV (uptime o incidencias).
- **Informe SLA mensual** (`/reports/sla`) preparado para imprimir o guardar como PDF.
- Archivos: `lib/domain/{metrics,slos}.ts`, `components/panel/reports/*`.

## API keys

- Nombre, acceso `read` o `write`, toda la organización o un proyecto, caducidad. El token (`upv_live_…`) se muestra una
  vez; se guarda el SHA-256 y un prefijo visible.
- **Rotar** crea una key nueva y deja la anterior viva 1 h, 24 h o 7 días. **Revocar** exige escribir el nombre.
- Archivos: `lib/domain/api-keys.ts`, `components/panel/settings/ApiKeysManager.tsx`.

## Facturación

- Tarjetas de plan con mensual/anual, consumo frente a límites y un diálogo que explica los efectos del cambio antes de
  confirmar (`planChangeEffects`). Sólo owners.
- `BILLING_MODE=demo` cambia el plan sin cobro (con el rol de servicio y registro en el audit log). Cualquier otro valor
  responde 501 hasta conectar un proveedor de pagos.
- Archivos: `lib/domain/billing.ts`, `components/panel/settings/BillingManager.tsx`.

## Audit log

- Cada mutación del dominio registra acción, actor, objetivo y metadatos. Filtros por grupo de acción, actor y fechas.
  Export CSV en Business.
- Archivos: `lib/domain/{audit,audit-log}.ts`, `components/panel/settings/AuditLogView.tsx`.

## Documentación pública

- `/docs`: guía de inicio. `/docs/api`: referencia generada desde la spec OpenAPI (`lib/api/reference.ts`), con
  parámetros, campos del cuerpo, respuesta, scope, idempotencia y ejemplos curl. `/api/v1/openapi.json`: la spec.

## Herramientas de automatización

- **Terraform** (`integrations/terraform-provider-upvane`): recursos de status page, componentes, grupos, monitores,
  canales, reglas, mantenimientos y data sources. Probado con `apply` → plan vacío → cambio → plan vacío → `destroy`.
- **CLI** (`packages/cli`, binario `upvane`): status, componentes (pin/unpin), incidencias, mantenimientos (`--now
  --duration`), monitores (run/pause/resume), heartbeat (envuelve un comando y avisa del resultado), whoami.
- **GitHub Action** (`integrations/github-action`): abre un mantenimiento al empezar el job y lo completa en el paso
  `post` (también si el job falla).

## Panel: transversal

- Command palette (⌘K / Ctrl K) para navegar y crear.
- Tiempo real con Supabase Realtime (refresco con antirrebote).
- Páginas de "no encontrado" dentro del panel y fuera de él.
- Responsive hasta móvil; foco visible; `prefers-reduced-motion` respetado.
