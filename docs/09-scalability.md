# 09 · Escalabilidad de la v2

Análisis del 9-oct-2026 sobre la rama `feat/v2-redesign-devops`. Las cifras son estimaciones de orden de magnitud
para decidir dónde mirar, no mediciones de producción.

## Escenario de referencia: 100 organizaciones

| Plan | Organizaciones | Monitores (media) | Intervalo | Regiones | Ejecuciones/min | Comprobaciones por región/min |
|------|----------------|-------------------|-----------|----------|-----------------|-------------------------------|
| Free | 70 | 3 → 210 | 180 s | 1 | 70 | 70 |
| Pro | 25 | 15 → 375 | 60 s | 3 | 375 | 1.125 |
| Business | 5 | 50 → 250 | 60 s | 5 | 250 | 1.250 |
| **Total** | **100** | **835** | | | **≈ 695** | **≈ 2.450** |

Además: ~150 status pages, unos pocos miles de componentes y suscriptores, y decenas de personas con el panel abierto.

## Veredicto

La v2 aguanta este escenario con un único proyecto de Supabase Pro y Vercel Pro. Los tres puntos que más crecen son
las **invocaciones de Edge Functions**, el **volumen de resultados de monitores** y el **tiempo real del panel**, y los
tres se han ajustado en esta rama:

| Área | Problema | Ajuste |
|------|----------|--------|
| Invocaciones de la sonda | Una invocación por comprobación y región: ≈ 2.450/min ≈ 105 M/mes | El runner agrupa en una invocación las comprobaciones que una región necesita a la vez (hasta 10): del orden de 250–400/min ≈ 11–17 M/mes |
| `monitor_check_results` | ≈ 3,5 M filas/día conservadas hasta 400 días | 7 días (Free), 14 (Pro), 30 (Business); purga horaria por lotes |
| Realtime | Cada ejecución de monitor actualizaba `monitors` y refrescaba todas las páginas abiertas cada pocos segundos | `monitors` fuera de la publicación; las páginas de monitores se refrescan cada 30 s |

## Monitorización

- **Runner**: pg_cron lo invoca cada 30 s; reclama lotes de 25 (`claim_due_monitors`, `FOR UPDATE SKIP LOCKED`) durante
  ~25 s y ejecuta 20 monitores a la vez. Con objetivos sanos (~0,3–1,5 s por ejecución) son ~1.000 ejecuciones por
  minuto, así que el escenario usa en torno al 70 % de un runner.
- **Cuando muchos objetivos caen** cada comprobación espera su `timeout_ms` (hasta 30 s) y la capacidad baja; los
  monitores se retrasan (su `next_check_at` se desplaza), no se pierden. Como el *claim* usa `SKIP LOCKED`, se puede
  programar un segundo job del runner o subir `CRON_DEFAULTS.concurrency` sin duplicar trabajo.
- **Límites de Edge Functions**: 2 s de CPU por invocación. El runner hace sobre todo E/S; si aparecen `WORKER_LIMIT`
  en los logs, baja `batchSize` o el presupuesto. La sonda ejecuta como mucho 10 comprobaciones por invocación (5 a la
  vez) para no acercarse al límite con los *handshakes* TLS.
- **Base de datos**: `record_monitor_run` inserta una fila por región y actualiza el estado por región y el monitor:
  ≈ 2.450 inserciones/min (≈ 40/s) más ≈ 1.400 actualizaciones/min. Trivial para Postgres en un plan Pro.

## Almacenamiento

| Tabla | Crecimiento | Conservación | Tamaño estable aproximado |
|-------|-------------|--------------|---------------------------|
| `monitor_check_results` | Free ≈ 0,1 M, Pro ≈ 1,6 M, Business ≈ 1,8 M filas/día | 7 / 14 / 30 días | ≈ 77 M filas ≈ 20–25 GB con índices |
| `component_status_history` | Sólo cambios de estado | 400 días | Pequeño |
| `alert_events`, `alert_deliveries` | Sólo transiciones y actualizaciones públicas | 180 días | Pequeño-medio |
| `audit_logs` | Una fila por mutación | 400 días | Pequeño |

El grueso es Business con 30 días. Si hiciera falta reducirlo: guardar sólo los resultados que cambian de estado más
un muestreo de los correctos, o agregados por hora para las gráficas y 2–3 días de detalle (ver K-10 en
[08-known-issues.md](08-known-issues.md)). Nada del producto lee resultados en bruto de más de 7 días: las gráficas son
de 24 h y 7 días y el uptime sale de `component_status_history`.

## Status pages

- `getPublicPayload` usa la caché de datos de Next (`unstable_cache`, 30 s, etiqueta `status-page:{org}/{slug}`): como
  mucho dos lecturas de `get_status_page` por minuto y página, sea cual sea el tráfico. Las mutaciones del dominio
  invalidan la etiqueta al momento.
- Durante una caída la página recibe más visitas y se refresca sola cada 30 s en cada navegador; el coste en base de
  datos no cambia porque todo sale de la caché.
- Las páginas privadas no se cachean entre visitantes (cada uno pasa por la comprobación de acceso); son de Business y
  su tráfico es interno.
- Feeds y JSON salen de la misma caché.

## Panel y API

- Cada página del panel hace un número constante de consultas por carga (el dominio agrupa lecturas con
  `Promise.all`) y Realtime sólo dispara refrescos con cambios de componentes, incidencias y mantenimientos.
- API pública: rate limit por key en SQL (`consume_rate_limit`, cubos por minuto) e idempotencia en
  `api_idempotency_keys` (se purgan a diario). 600–1.200 peticiones/min por key.
- Todo pasa por la API HTTP de Supabase; no hay conexiones directas a Postgres desde Vercel, así que no hay riesgo de
  agotar el pool.

## Alertas

- Sólo se generan eventos en transiciones (con cooldown por regla y componente/monitor) y en actualizaciones públicas.
  `wake_alert_worker` despierta al worker con antirrebote y el cron de cada minuto hace de respaldo.
- El cuello de botella son los proveedores: Resend (cuota del plan), Slack (1 mensaje/s por webhook) y PagerDuty. Los
  429 se reintentan respetando `Retry-After`.
- Suscriptores: una actualización pública de una página con miles de suscriptores genera miles de entregas; el worker
  las procesa por lotes de la cola (`alert-deliveries`). Para páginas muy grandes conviene un dominio de envío con buena
  reputación y vigilar la cuota de Resend.

## Límites a vigilar

1. **Plan de Supabase**: Pro como mínimo (el Free pausa proyectos inactivos y tiene 500 MB de disco).
2. **Invocaciones de Edge Functions**: el plan Pro incluye 2 M al mes; el escenario ronda 11–17 M (unos 20–30 $/mes
   extra). Crece con monitores × regiones ÷ tamaño de lote.
3. **Regiones**: la invocación regional depende de Supabase; si una región no está disponible, se limita con
   `MONITOR_PROBE_REGIONS` y el panel lo explica en cada resultado.
4. **Emails de Auth**: SMTP propio, o el registro deja de funcionar con usuarios reales.
5. **Caché de status pages con cambios de monitores**: hasta 30 s de retraso (K-9).
6. **Más allá de ~1.000 ejecuciones/min**: segundo job del runner (el *claim* lo permite) y, si la tabla de resultados
   pesa, particionarla por día.
