# Alerts email setup

Upvane alert email delivery uses Resend from trusted server code only.

## Local development

Set these variables locally:

- `RESEND_API_KEY`
- `ALERTS_EMAIL_FROM`
- `ALERT_WORKER_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

For local testing, `ALERTS_EMAIL_FROM` must be a sender Resend accepts for your account. You may set it to `onboarding@resend.dev` if Resend allows it, but the application does not hardcode that sender.

Queue a test alert from the project Alerts page. The app stores an alert event, creates delivery rows, sends minimal PGMQ messages, and best-effort invokes the Supabase `alert-worker` Edge Function automatically.

Manual worker invocation is only a local troubleshooting escape hatch:

```bash
curl -X POST http://localhost:3000/api/alerts/worker \
  -H "Authorization: Bearer $ALERT_WORKER_SECRET"
```

## Production

Before enabling alerts in production:

1. Enable Supabase Queues/PGMQ, Vault, `pg_cron`, and `pg_net` for the project if the dashboard requires manual activation.
2. Apply database migrations:

   ```bash
   supabase db push
   ```

3. Store worker invocation values in Vault for the database fallback cron:

   ```sql
   select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'SUPABASE_URL');
   select vault.create_secret('YOUR_ALERT_WORKER_SECRET', 'ALERT_WORKER_SECRET');
   select public.schedule_alert_worker_fallback();
   ```

   The scheduled fallback invokes `/functions/v1/alert-worker` every 3 minutes and requeues due pending deliveries missed by immediate dispatch.

4. Deploy the Supabase Edge Functions:

   ```bash
   supabase functions deploy api --no-verify-jwt
   supabase functions deploy monitor-runner
   supabase functions deploy alert-worker
   ```

   Redeploying `api` also ships the existing local fix that avoids ordering components by a missing `created_at` column.

5. Set or verify Edge Function secrets:

   ```bash
   supabase secrets set SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
   supabase secrets set MONITOR_RUNNER_SECRET="YOUR_MONITOR_RUNNER_SECRET"
   supabase secrets set ALERT_WORKER_SECRET="YOUR_ALERT_WORKER_SECRET"
   supabase secrets set RESEND_API_KEY="YOUR_RESEND_KEY"
   supabase secrets set ALERTS_EMAIL_FROM="Upvane <alerts@upvane.com>"
   ```

Legacy checklist:

1. Apply the alerts database migration from `supabase/migrations/*_alerts_system.sql` and `*_alerts_queue_dispatch.sql`.
2. Deploy the touched Supabase Edge Functions:
   - `supabase/functions/api`
   - `supabase/functions/monitor-runner`
   - `supabase/functions/alert-worker`
3. Set or verify Edge Function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MONITOR_RUNNER_SECRET` for `monitor-runner`
4. Set or verify application worker/provider secrets for the Edge worker and Next compatibility worker route:
   - `RESEND_API_KEY`
   - `ALERTS_EMAIL_FROM`
   - `ALERT_WORKER_SECRET`

Production must use a verified domain sender after DNS is configured for `upvane.com`, for example:

```env
ALERTS_EMAIL_FROM="Upvane <alerts@upvane.com>"
```

Do not expose the Resend API key to client components.
