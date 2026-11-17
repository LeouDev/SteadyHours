-- pg_cron's resume calls were refused on the hosted project: the function compared the bearer to its
-- own SUPABASE_SERVICE_ROLE_KEY, which need not equal the service role key stored in Vault.
-- Calls now also carry a dedicated shared secret (Vault `import_internal_secret`, function secret
-- IMPORT_INTERNAL_SECRET). The service role key stays in Authorization for the gateway's JWT check.
create or replace function public.resume_stale_imports() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  key text;
  internal text;
  r record;
  n integer := 0;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'import_cron_key';
  select decrypted_secret into internal from vault.decrypted_secrets where name = 'import_internal_secret';
  if base is null or key is null then
    return 0;
  end if;
  for r in
    select id from public.imports
    where status in ('queued', 'running') and (locked_until is null or locked_until < now())
  loop
    perform net.http_post(
      url := base || '/functions/v1/harvest-import',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key,
        'x-import-internal', coalesce(internal, '')),
      body := jsonb_build_object('action', 'resume', 'import_id', r.id)
    );
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.resume_stale_imports() from public, anon, authenticated;
