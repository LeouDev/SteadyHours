-- PRD 11.7: pg_cron resumes imports whose worker stopped (timeout, crash, deploy).
-- The function normally chains itself; this is the safety net.
-- Needs two Vault secrets, set once per environment (see README):
--   project_url       e.g. https://<ref>.supabase.co
--   import_cron_key   the service role key, sent as the bearer token
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.resume_stale_imports() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  key text;
  r record;
  n integer := 0;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'import_cron_key';
  if base is null or key is null then
    return 0;
  end if;
  for r in
    select id from public.imports
    where status in ('queued', 'running') and (locked_until is null or locked_until < now())
  loop
    perform net.http_post(
      url := base || '/functions/v1/harvest-import',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body := jsonb_build_object('action', 'resume', 'import_id', r.id)
    );
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.resume_stale_imports() from public, anon, authenticated;

select cron.schedule('resume-stale-imports', '* * * * *', 'select public.resume_stale_imports()');
