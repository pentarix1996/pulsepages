# 09 · Revisión de producto para equipos DevOps

Revisión del 9-oct-2026 sobre el commit `9564b24`. Complementa a [08-known-issues.md](08-known-issues.md): aquel documento
recoge limitaciones; este recoge **decisiones de producto** que convenía replantear pensando en el usuario objetivo
(DevOps, SRE, equipos de plataforma) y lo que les faltaba para adoptar Upvane. La sección 4 resume qué se hizo en la v2.

La propuesta visual está en el canvas **"Upvane redesign"** (landing, panel de overview, incidencia, monitor y status
page en escritorio y móvil) y ya se aplicó a toda la aplicación (ver `DESIGN.md`).

---

## 1. Funcionalidades mal planteadas o mal ejecutadas

### 1.1 Incidencias: la severidad decide por ti

- **Severidad → estado de componente automático.** Un SRE no piensa "severidad high = partial outage en todos los
  componentes afectados". En una misma incidencia cada componente está en un estado distinto (Payments caído, Webhooks
  degradado). El mapeo además pisaba estados manuales y de monitor al resolver.
  - *Propuesta*: la incidencia tiene un `impact` (`none/minor/major/critical`) para comunicar, y **cada
    `incident_update` lleva el estado explícito de cada componente** (`{component_id: status}`).
- **`maintenance` como estado de incidencia** (sólo por API). Mezcla dos conceptos. El mantenimiento es una entidad
  propia: ventana programada, inicio y fin automáticos, aviso previo a suscriptores y silencio de alertas.
- **Sin marcas de tiempo operativas.** No había `detected_at`, `acknowledged_at` ni `resolved_at`. Sin eso no hay MTTA
  ni MTTR, que es lo primero que mide un equipo de guardia.
- **El historial no era fiable.** Cambiar título, severidad o componentes no dejaba rastro y borrar no dejaba huella.
  Para DevOps el timeline es un registro de auditoría: append-only, borrado lógico y distinción entre **notas
  internas** y **updates públicos**.
- **No había postmortem** ni forma de enlazarlo.

### 1.2 Monitorización: falsos positivos por diseño

- **Un único punto de observación y sin confirmación.** Un solo check fallido ponía el componente en `major_outage` y
  disparaba alertas.
  - *Propuesta*: N fallos consecutivos + quórum multi-región y recuperación tras M éxitos.
- **Sólo GET/HEAD sin cabeceras ni body**, sin cabeceras secretas.
- **Tipos que faltaban**: keyword, TCP, DNS, caducidad de certificado TLS y **heartbeat**.
- **Redirecciones prohibidas.** Permitir seguir hasta N saltos revalidando SSRF en cada salto.
- **La latencia se guardaba pero no se usaba.** Ni gráfica ni umbral "degradado si responde en más de X ms".
- **Monitor 1:1 con componente.** Desacoplar: `monitors` N:M `components` y monitores privados.

### 1.3 Uptime: mezcla lo comunicado con lo medido

- Separar el **SLI medido por checks** (panel) del **estado publicado** (status page).
- `degraded` contaba como caída completa. Lo habitual es ponderar; debería ser configurable.
- Sin desglose diario (barras de 90 días), sin SLO ni *error budget*.

### 1.4 Alertas: un solo canal y sin enrutado

- **Sólo email.** El mínimo para un equipo DevOps es Slack/Teams y un webhook firmado (HMAC); PagerDuty y Opsgenie
  para paging.
- **Sin enrutado**: hacen falta reglas por componente, estado y tipo → canal, cooldown por clave, silencio durante
  mantenimientos.

### 1.5 API: impedía trabajar como código

- **Una key por proyecto y usuario; regenerar = borrar y crear.** Hacen falta varias keys con nombre, *scopes*,
  caducidad, `last_used_at`, revocación individual, rotación sin corte y keys de organización.
- Sin OpenAPI ni documentación; faltaban `Idempotency-Key`, paginación y cabeceras de *rate limit*.
- No había Terraform provider, CLI ni GitHub Action.

### 1.6 Status page: lo básico que espera el visitante

- Faltaban barras de 90 días, grupos, descripciones, suscripción, mantenimientos, permalinks, historial, hora local,
  feeds RSS/Atom/JSON, modo oscuro y dominio propio.
- Sin caché; todo público y enumerable; no había páginas privadas.

### 1.7 Cuentas, equipo y planes

- **No había organizaciones**: hacen falta roles, invitaciones, 2FA, SSO en Business y audit log.
- Plan autoasignable desde el navegador.
- **Planes desalineados con el mercado.** El Free no incluía monitorización, mientras que las herramientas de referencia
  sí (UptimeRobot, Better Stack, Instatus).
- La landing prometía funciones que no existían.

### 1.8 Panel

- Cambio de estado con un `<select>` suelto, borrado con `confirm()`, sin renombrar componentes ni editar proyectos.
- **Sin tiempo real** y con actualizaciones optimistas que no se revertían.
- **Sin vista operativa** ni atajos de teclado.

---

## 2. Funcionalidades que faltaban (priorizadas)

### P0 · Sin esto un equipo DevOps no lo adopta

1. Monitorización fiable: multi-región con confirmación, cabeceras/body/secretos, umbral de latencia, heartbeat,
   keyword, TCP, DNS y caducidad de TLS.
2. Alertas por Slack/Teams y webhooks firmados, con reglas de enrutado, cooldown y silencio.
3. Mantenimientos programados con aviso previo y silencio de alertas.
4. Suscriptores en la status page: email con doble opt-in, RSS/Atom, Slack y webhook.
5. Status page completa: barras de 90 días, grupos, permalinks, historial y caché.
6. Equipos y roles con audit log.
7. API keys múltiples con scopes y rotación sin corte; spec OpenAPI y documentación en `/docs`.

### P1 · Diferenciadores

8. Ingesta de alertas externas (Alertmanager, Grafana, Datadog, CloudWatch) mapeadas a componentes.
9. Terraform provider, CLI y GitHub Action.
10. Incidencia desde un monitor (borrador) y plantillas de incidencia.
11. MTTA/MTTR, SLO y error budget, e informes mensuales de SLA exportables.
12. Dominio propio con TLS automático y branding.
13. Páginas privadas: SSO, lista de IPs o enlace con token.
14. Postmortems vinculados a la incidencia, con el timeline precargado.
15. Dependencias entre componentes.
16. Tiempo real en el panel y command palette.

### P2

17. Status page multiidioma. 18. Widget y badge embebibles; JSON compatible con el `summary.json` de Statuspage.
19. Importador desde Statuspage o Instatus. 20. SMS y llamada. 21. Status page pública de Upvane (dogfooding).

**Fuera de alcance recomendado**: calendarios de guardia y escalados propios. Mejor integrar con PagerDuty u Opsgenie.

---

## 3. Rediseño

- **Dirección visual**: fondo tinta azul noche (`#0C1222`) en landing y panel; índigo de marca (`#5B58E8`, `#A9A6FF`)
  sólo para acciones; estados semánticos verde, ámbar, naranja, rojo y azul. Tipografía **Archivo** (eje de anchura,
  condensada en titulares) y **JetBrains Mono** para datos técnicos.
- **Status page pública** en claro por defecto, con modo oscuro y color de marca del cliente.
- **Movimiento**: una animación protagonista en la landing (una caída completa paso a paso); el resto responde a datos o
  acciones. Todo respeta `prefers-reduced-motion`.

---

## 4. Estado tras la v2 (9-oct-2026)

Todo lo de las secciones 1, P0 y P1 está implementado en la rama `feat/v2-redesign-devops`, salvo lo indicado.

| Punto | Estado | Cómo quedó |
|-------|--------|------------|
| 1.1 Incidencias | ✅ | `impact` + estado explícito por componente en cada actualización; mantenimientos como entidad propia; `detected/acknowledged/published/resolved_at`; timeline append-only con notas internas y filas `system`; borrado lógico; postmortems. |
| 1.2 Monitorización | ✅ | Seis tipos, multi-región con confirmación y quórum, cabeceras secretas cifradas, redirecciones con SSRF por salto, aserciones, umbral de latencia, gráfica p50/p95, N:M con componentes. |
| 1.3 Uptime | ✅ | Pesos configurables (por defecto major 1, partial 0,3, degraded 0), barras diarias de 90 días, SLOs con error budget, SLI de monitores separado del estado publicado. |
| 1.4 Alertas | ✅ | Siete canales, reglas ordenadas con cooldown por clave, silencio en mantenimientos, actividad con motivos. |
| 1.5 API | ✅ | Keys de organización o proyecto con scopes, caducidad y rotación con gracia; OpenAPI, `/docs/api`, idempotencia, paginación y rate limit. |
| 1.6 Status page | ✅ | Todo lo listado, caché por etiqueta con invalidación, páginas privadas. |
| 1.7 Cuentas y planes | ✅ (SSO ⏸) | Organizaciones, roles, invitaciones, 2FA (exigible por organización), audit log; plan sólo editable por el servidor; Free con 5 monitores. SSO/SAML pendiente (K-2). |
| 1.8 Panel | ✅ | Rediseño completo, confirmaciones accesibles, tiempo real, command palette, overview operativo. |
| P0 1–7 | ✅ | |
| P1 8–16 | ✅ (13: SSO ⏸) | Las páginas privadas funcionan con miembros, enlaces con token e IPs. |
| P2 | Parcial | 18: el JSON compatible con Statuspage está hecho; el widget no. El resto, pendiente (K-3). |

## Fuentes

- [UptimeRobot · Pricing](https://uptimerobot.com/pricing/)
- [Better Stack · Pricing](https://betterstack.com/pricing)
- [Instatus · Pricing](https://instatus.com/pricing)
