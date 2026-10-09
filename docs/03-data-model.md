# 03 · Modelo de datos

El esquema completo está en `supabase/migrations/`. Las cinco primeras migraciones son la v1 (baseline idempotente,
API keys por proyecto, monitorización y alertas v1). La v2 empieza en `20261009120000_v2_organizations.sql`:

| Migración | Contenido |
|-----------|-----------|
| `120000_v2_organizations` | Organizaciones, miembros, invitaciones, audit log, roles, planes en SQL, actor de API key |
| `120100_v2_components_incidents` | Grupos, dependencias, estado efectivo, incidencias v2, plantillas, postmortems, mantenimientos |
| `120200_v2_monitors` | Monitores, regiones, estado por región, secretos, resultados, señales externas, heartbeats |
| `120300_v2_alerts_subscribers` | Canales, destinatarios, reglas, eventos, entregas, cola, suscriptores |
| `120400_v2_metrics` | Uptime ponderado, estado diario, métricas (MTTA/MTTR), SLOs |
| `120500_v2_status_page_api` | Ajustes de la status page, `get_status_page*`, API keys v2, rate limit, idempotencia |
| `120600_v2_rls` | Todas las políticas RLS y permisos de la v2 |
| `120700_v2_cron_realtime` | Retención, programación de jobs, publicación de Realtime |
| `1301xx`–`130600` | Extras por área (incidencias, monitores, cuenta, métricas, status page) |
| `130700_v2_alert_finalize_lock` | `finalize_alert_event` bloquea el evento antes de contar entregas |
| `130800_v2_check_result_retention` | Retención de resultados de monitores por plan (7/14/30 días) y purga horaria por lotes |
| `130900_v2_realtime_without_monitors` | Saca `monitors` de la publicación de Realtime |

## Tablas por área

Todas las tablas de `public` tienen RLS. Las marcadas como *sin políticas de cliente* sólo se leen y escriben con el
rol de servicio (desde el dominio tras una comprobación explícita o desde las Edge Functions).

### Cuentas y organizaciones

| Tabla | Columnas clave | Notas |
|-------|----------------|-------|
| `profiles` | `id`, `name`, `username`, `plan` | `plan` está obsoleto (se sincroniza desde la organización personal; no editable por usuarios). |
| `organizations` | `slug` único, `plan`, `personal`, `sso_domain`, `require_2fa`, `created_by` | Sólo `service_role` cambia `plan` (trigger). `change_organization_plan` aplica `enforce_plan_limits`. |
| `organization_members` | `(organization_id, user_id)`, `role` | `viewer < responder < admin < owner`. Siempre queda al menos un owner. |
| `organization_invitations` | `email`, `role`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at` | Sin políticas de cliente; se gestionan desde el dominio. |
| `audit_logs` | `actor_type user\|api_key\|system`, `actor_label`, `action`, `target_*`, `metadata`, `ip` | Se escribe con `write_audit_log`; lectura para admins. |
| `api_keys` | `organization_id`, `project_id` (null = toda la organización), `scopes`, `prefix`, `token_hash`, `expires_at`, `last_used_at`, `revoked_at` | Sólo el hash SHA-256. Las `pp_live_` de la v1 siguen funcionando. |
| `api_idempotency_keys`, `rate_limit_buckets` | | Sin políticas de cliente. |

### Status pages y componentes

| Tabla | Columnas clave | Notas |
|-------|----------------|-------|
| `projects` | `organization_id`, `slug` (único por organización), `visibility`, `brand_color`, `logo_url`, `theme_default`, `timezone`, `hide_powered_by`, `custom_domain` + `custom_domain_status`, `allowed_ips cidr[]`, `support_url`, `uptime_weights`, `auto_postmortem`, `auto_draft_incidents` | `user_id` queda como "creado por". |
| `components` | `slug`, `group_id`, `position`, `status` (efectivo), `manual_status`, `automated_status`, `status_source`, `status_changed_at` | Sólo `recompute_component_status` escribe `status`. |
| `component_groups` | `name`, `position`, `collapsed` | |
| `component_dependencies` | `component_id`, `depends_on_id`, `impact` | Sin ciclos (trigger), profundidad limitada. |
| `component_status_history` | `status`, `reason`, `incident_id`, `changed_at` | Base del uptime y de las barras diarias. |
| `component_signals` | `integration_id`, `external_id`, `status`, `labels`, `active` | Alertas externas activas por componente. |
| `status_page_access_tokens` | `token_hash`, `prefix`, `expires_at`, `revoked_at`, `last_used_at` | Enlaces `spat_…` para páginas privadas. |
| `status_page_subscribers` | `type email\|slack\|webhook`, `email`, `target_encrypted`, `target_hint`, `component_ids`, `confirmed_at`, `confirm_token_hash`, `unsubscribe_token_hash` | Destinos cifrados; sólo hashes de tokens. |

### Incidencias, postmortems y mantenimientos

| Tabla | Columnas clave | Notas |
|-------|----------------|-------|
| `incidents` | `status draft\|investigating\|identified\|monitoring\|resolved`, `impact none\|minor\|major\|critical`, `detected_at`, `acknowledged_at`/`_by`, `published_at`, `resolved_at`, `source manual\|monitor\|signal\|api\|template`, `source_monitor_id`, `source_signal_id`, `deleted_at` | `severity` y `component_ids` se mantienen sincronizados para la API v0. Borrado lógico. |
| `incident_components` | `(incident_id, component_id)`, `status` | Lo que la incidencia afirma ahora de cada componente. |
| `incident_updates` | `kind update\|note\|system`, `visibility public\|internal`, `status`, `component_statuses`, `notify_subscribers`, `created_by`, `actor_label` | *Append-only*. Los cambios de título, impacto o componentes dejan una fila `system`. |
| `incident_templates` | `title`, `message`, `impact`, `status`, `component_statuses` | |
| `postmortems` | `incident_id` único, `status draft\|published`, cinco secciones, `action_items`, `timeline`, `published_at` | |
| `maintenances` | `status scheduled\|in_progress\|completed\|cancelled`, `scheduled_*`, `actual_*`, `auto_start`, `auto_complete`, `notify_subscribers`, `reminder_minutes`, `reminder_sent_at`, `mute_alerts` | |
| `maintenance_components`, `maintenance_updates` | | |

### Monitores

| Tabla | Columnas clave | Notas |
|-------|----------------|-------|
| `monitors` | `type http\|keyword\|tcp\|dns\|tls\|heartbeat`, `enabled`, `paused_reason`, `interval_seconds`, `timeout_ms`, `regions`, `confirm_failures`, `confirm_regions`, `recovery_successes`, `config`, `failure_status`, `degraded_status`, `state pending\|up\|degraded\|down\|paused`, `next_check_at`, `last_result`, `heartbeat_token`, `tls_expires_at`, `auto_draft_incident` | `enforce_monitor_config_rules` valida tipo, intervalo y regiones contra el plan. |
| `monitor_components` | `(monitor_id, component_id)` | N:M. |
| `monitor_region_state` | `consecutive_bad`, `consecutive_up`, `confirmed`, `last_status`, `last_latency_ms` | Estado de la máquina de confirmación por región. |
| `monitor_check_results` | `monitor_id`, `region`, `status`, `http_status`, `response_time_ms`, `error_message`, `details`, `checked_at` | Una fila por comprobación y región. La tabla que más crece: se conserva 7, 14 o 30 días según el plan (ver [09-scalability.md](09-scalability.md)). |
| `monitor_secrets` | `headers_encrypted`, `header_names` | Sin políticas de cliente; sólo se devuelven los nombres. |
| `inbound_integrations` | `type alertmanager\|grafana\|datadog\|cloudwatch\|generic`, `token`, `mappings`, `default_component_id`, `default_status`, `auto_draft_incident`, `received_count` | El token va en la URL del receptor. |

### Alertas

| Tabla | Columnas clave | Notas |
|-------|----------------|-------|
| `project_alert_configs` | `enabled` (interruptor general), `mute_during_maintenance` | El resto de columnas son de la v1. |
| `alert_channels` | `type email\|slack\|teams\|discord\|webhook\|pagerduty\|opsgenie`, `name`, `enabled`, `config` (no secreto) | |
| `alert_channel_secrets` | `secret_encrypted`, `hint` | Sin políticas de cliente. |
| `alert_email_recipients` | `email`, `verified_at`, `token_hash` | Doble opt-in salvo miembros de la organización. |
| `alert_rules` | `event_types`, `component_ids`, `monitor_ids`, `min_status`, `channel_ids`, `cooldown_minutes`, `position` | Se evalúan en orden de `position`. |
| `alert_events` | `type`, `audience team\|subscribers`, `status`, `suppression_reason`, `dedupe_key`, `payload`, referencias a componente/monitor/incidencia/mantenimiento | |
| `alert_deliveries` | `channel_id` o `subscriber_id`, `target_type`, `status pending\|processing\|retryable\|sent\|failed\|suppressed`, `attempts`, `next_retry_at`, `rule_id` | |
| `alert_rule_cooldowns` | `(rule_id, dedupe_key)`, `last_event_type`, `last_rank`, `last_sent_at` | Antirrebote por regla y componente/monitor. |
| `alert_worker_wakeups` | `last_woken_at` | Antirrebote de `wake_alert_worker`. |

### Métricas

| Tabla | Notas |
|-------|-------|
| `slos` | `component_id` (null = página entera), `target` (0–100), `window_days 7\|14\|28\|30\|90`. |

### Tablas de la v1 que se conservan

`component_monitor_configs`, `alert_channel_configs` y `alert_cooldowns` se migraron a `monitors`, `alert_channels` y
`alert_rule_cooldowns` (columnas `legacy_*_id`). No se usan en código nuevo; se pueden borrar cuando producción haya
migrado.

## RLS y permisos

- Lectura: miembros de la organización (`member_project_ids('viewer')`). Escritura según rol con `has_project_role`
  (responder para incidencias, mantenimientos y estado fijado; admin para configuración; owner para facturación y
  owners). Las API keys pasan por el rol de servicio con `x-upvane-actor`, y los triggers aplican las mismas guardas.
- Ninguna tabla tiene lectura anónima. Lo público sale por `get_status_page`, `get_status_page_incident`,
  `get_status_page_maintenance`, `get_status_page_history(_newer)` y `resolve_custom_domain`.
- Toda función `security definer` fija `search_path` y hace `revoke execute … from public, anon, authenticated`; sólo
  una lista cerrada se vuelve a conceder (ver `supabase/tests/sql/17_security_invariants.test.sql`, que falla si
  aparece una función nueva expuesta).

## Funciones SQL principales

| Función | Para qué |
|---------|----------|
| `recompute_component_status`, `recompute_component_automation` | Estado efectivo y estado automático (monitores + señales + dependencias). |
| `create_incident`, `post_incident_update`, `update_incident_details`, `acknowledge_incident`, `delete_incident`, `apply_incident_components` | Escrituras de incidencias con su timeline. |
| `create_maintenance`, `update_maintenance`, `set_maintenance_status`, `post_maintenance_update`, `process_maintenance_windows` | Mantenimientos y su ciclo automático. |
| `ensure_postmortem_draft` | Borrador de postmortem al resolver. |
| `claim_due_monitors`, `claim_monitor`, `record_monitor_run`, `record_heartbeat`, `process_heartbeats`, `ingest_signals` | Ejecución de monitores, heartbeats y señales externas. |
| `enqueue_alert_event_and_dispatch`, `create_channel_deliveries`, `enqueue_subscriber_notification`, `wake_alert_worker`, `alert_worker_*`, `recover_alert_delivery_queue`, `finalize_alert_event` | Pipeline de alertas. |
| `subscribe_to_status_page`, `confirm_status_page_subscription`, `unsubscribe_from_status_page`, `verify_alert_recipient` | Suscriptores y destinatarios. |
| `component_uptime`, `component_daily_status`, `get_project_uptime`, `get_project_metrics`, `get_project_slos`, `get_project_latency`, `monitor_latency_series` | Métricas. Uptime ponderado: major 1, partial 0,3, degraded 0, mantenimiento excluido (configurable por proyecto). |
| `get_status_page*`, `status_page_access_info`, `check_status_page_access`, `resolve_custom_domain` | Status page pública y privada. |
| `authenticate_api_key`, `consume_rate_limit`, `request_api_actor`, `is_privileged_session`, `is_trusted_caller` | API pública. |
| `plan_limit`, `enforce_plan_limits`, `change_organization_plan`, `organization_usage` | Planes. |
| `write_audit_log` | Audit log. |

## Cron y colas

`schedule_upvane_jobs()` (se ejecuta en la migración y hay que repetirlo tras crear o rotar secretos de Vault):

| Job | Frecuencia | Qué hace |
|-----|------------|----------|
| `upvane-monitor-runner` | 30 s | `net.http_post` a `monitor-runner` con `MONITOR_RUNNER_SECRET` de Vault |
| `upvane-alert-worker` | 1 min | Respaldo de `alert-worker` (normalmente lo despierta `wake_alert_worker`) |
| `upvane-maintenance-windows` | 1 min | `process_maintenance_windows()`: inicio/fin automáticos y recordatorios |
| `upvane-heartbeats` | 1 min | `process_heartbeats()`: heartbeats vencidos |
| `upvane-retention` | cada hora (minuto 17) | `purge_old_data()` |

Cola PGMQ: `alert-deliveries` (mensajes mínimos con el id de la entrega).

## Retención (`purge_old_data`)

| Datos | Se conservan |
|-------|--------------|
| `monitor_check_results` | 7 días (Free), 14 (Pro), 30 (Business): `check_result_retention_days(plan)`. Se borra por proyecto en lotes de 20.000 con un presupuesto de 5 minutos por ejecución; lo que quede sigue en la hora siguiente. |
| `alert_events` (y sus entregas) | 180 días |
| `component_status_history`, `audit_logs` | 400 días |
| `rate_limit_buckets` | 2 días |
| `api_idempotency_keys` | 1 día |
| Invitaciones no aceptadas | 30 días después de caducar |

## Realtime

Publicación `supabase_realtime`: `components`, `incidents`, `incident_updates`, `incident_components` y `maintenances`.
RLS aplica a las suscripciones. `monitors` no está: cada ejecución actualiza su fila dos veces y refrescaba las páginas
abiertas cada pocos segundos; las páginas de monitores se refrescan cada 30 s mientras están visibles.
