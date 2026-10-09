-- ==========================================
-- Migration: stop streaming monitors over Realtime
-- ==========================================
-- Every monitor run updates its row twice (claim and result). Streaming those changes made every open dashboard page
-- refresh every few seconds and made Realtime evaluate RLS for each change and subscriber. Monitor state changes still
-- reach the dashboard through `components` (linked components change status) and the monitor pages poll every 30 s.
do $$
begin
  if exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monitors'
  ) then
    alter publication supabase_realtime drop table public.monitors;
  end if;
end $$;
