-- Launch-gate numbers for the operator. Counts only: no names, emails or workspace contents.
-- The `internal` schema is not exposed through the API and grants nothing to app users, so these
-- are readable only from the SQL editor or a direct database connection (see scripts/gate.mjs).
create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

create view internal.gate_summary as
select
  (select count(*) from auth.users) as signups,
  (select count(*) from auth.users where email_confirmed_at is not null) as confirmed_signups,
  (select count(distinct workspace_id) from public.imports) as workspaces_with_an_import,
  (select count(*) from public.imports) as imports_started,
  (select count(*) from public.imports where status = 'succeeded') as imports_completed,
  (select count(*) from public.imports where status = 'failed') as imports_failed,
  (select count(*) from public.imports where status in ('queued', 'running')) as imports_running,
  (select count(*) from public.time_entries where source_id is not null) as time_entries_imported,
  (select count(*) from public.invoices where source_id is not null) as invoices_imported;

create view internal.gate_workspaces as
select
  w.id as workspace_id,
  w.created_at as signed_up_at,
  w.default_currency,
  i.imports_started,
  i.imports_completed,
  i.imports_failed,
  i.last_finished_at,
  last.status as last_status,
  last.progress -> 'skipped' as last_refused_types,
  (last.progress ->> 'runs')::int as last_runs,
  (select count(*) from public.memberships m where m.workspace_id = w.id and m.source_id is not null) as people,
  (select count(*) from public.clients c where c.workspace_id = w.id and c.source_id is not null) as clients,
  (select count(*) from public.projects p where p.workspace_id = w.id and p.source_id is not null) as projects,
  (select count(*) from public.time_entries t where t.workspace_id = w.id and t.source_id is not null) as time_entries,
  (select count(*) from public.expenses e where e.workspace_id = w.id and e.source_id is not null) as expenses,
  (select count(*) from public.invoices v where v.workspace_id = w.id and v.source_id is not null) as invoices,
  (select count(*) from public.estimates s where s.workspace_id = w.id and s.source_id is not null) as estimates
from public.workspaces w
left join lateral (
  select count(*) as imports_started,
    count(*) filter (where status = 'succeeded') as imports_completed,
    count(*) filter (where status = 'failed') as imports_failed,
    max(finished_at) as last_finished_at
  from public.imports where workspace_id = w.id
) i on true
left join lateral (
  select status, progress from public.imports where workspace_id = w.id order by started_at desc limit 1
) last on true
order by w.created_at desc;

revoke all on internal.gate_summary, internal.gate_workspaces from public, anon, authenticated;
