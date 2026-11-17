-- Core schema from PRD 11.6.
-- Money is integer minor units (bigint: IDR/VND totals overflow int4).
-- Every child row carries workspace_id, and references use composite
-- (workspace_id, id) foreign keys so a row can never point into another workspace.

create type public.member_role as enum ('owner', 'admin', 'member');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  invoice_prefix text not null default '',
  next_invoice_number integer not null default 1,
  plan text not null default 'archive',
  plan_status text not null default 'active',
  trial_ends_at timestamptz,
  billing_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.workspaces (billing_customer_id);

-- A membership is a person in a workspace. People imported from Harvest have
-- no login yet, so user_id is nullable and name/email/source_id describe them.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid references auth.users on delete set null,
  role public.member_role not null default 'member',
  name text not null default '',
  email text,
  default_rate_cents bigint,
  is_active boolean not null default true,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  unique (workspace_id, source_id),
  unique (workspace_id, id)
);
create index on public.memberships (user_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  address text,
  tax_id text,
  is_archived boolean not null default false,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_id),
  unique (workspace_id, id)
);
create index on public.clients (workspace_id, is_archived);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null,
  name text not null default '',
  email text,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  unique (workspace_id, source_id)
);
create index on public.contacts (client_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null,
  name text not null,
  code text,
  is_billable boolean not null default true,
  hourly_rate_cents bigint,
  is_archived boolean not null default false,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  unique (workspace_id, source_id),
  unique (workspace_id, id)
);
create index on public.projects (workspace_id, client_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  is_billable_default boolean not null default true,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_id),
  unique (workspace_id, id)
);
create index on public.tasks (workspace_id);

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  project_id uuid not null,
  task_id uuid not null,
  is_billable boolean not null default true,
  rate_cents bigint,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id),
  unique (project_id, task_id),
  unique (workspace_id, source_id)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null,
  number text not null,
  -- 'closed' exists only on imports: Harvest's closed (written-off) state.
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void', 'closed')),
  subject text,
  issue_date date,
  due_date date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_cents bigint not null default 0,
  discount_rate numeric,
  discount_cents bigint not null default 0,
  tax_rate numeric,
  tax_cents bigint not null default 0,
  tax2_rate numeric,
  tax2_cents bigint not null default 0,
  total_cents bigint not null default 0,
  due_cents bigint not null default 0,
  paid_at timestamptz,
  payment_url text,
  notes text,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  unique (workspace_id, source_id),
  unique (workspace_id, id)
);
-- Harvest allows duplicate invoice numbers, so uniqueness applies to native invoices only.
create unique index invoices_native_number_key on public.invoices (workspace_id, number) where source_id is null;
create index on public.invoices (workspace_id, status);
create index on public.invoices (workspace_id, issue_date);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  invoice_id uuid not null,
  project_id uuid,
  kind text,
  description text,
  quantity numeric not null default 1,
  unit_price_cents bigint not null default 0,
  amount_cents bigint not null default 0,
  taxed boolean not null default false,
  taxed2 boolean not null default false,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, invoice_id) references public.invoices (workspace_id, id) on delete cascade,
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  unique (workspace_id, source_id)
);
create index on public.invoice_items (invoice_id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  membership_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  invoice_id uuid,
  spent_on date not null,
  minutes integer not null default 0 check (minutes >= 0),
  -- Harvest's exact decimal hours; null for native entries. Reconciliation sums these.
  source_hours numeric,
  source_rounded_hours numeric,
  started_at timestamptz,
  notes text,
  is_billable boolean not null default true,
  is_billed boolean not null default false,
  rate_cents bigint,
  is_running boolean not null default false,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, membership_id) references public.memberships (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, task_id) references public.tasks (workspace_id, id),
  foreign key (workspace_id, invoice_id) references public.invoices (workspace_id, id),
  unique (workspace_id, source_id)
);
create index on public.time_entries (workspace_id, spent_on);
create index on public.time_entries (workspace_id, project_id, spent_on);
create index on public.time_entries (workspace_id, membership_id, spent_on);
create index time_entries_unbilled_idx on public.time_entries (workspace_id, project_id) where invoice_id is null;
create unique index time_entries_one_running_idx on public.time_entries (membership_id) where is_running;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  project_id uuid not null,
  membership_id uuid not null,
  invoice_id uuid,
  spent_on date not null,
  amount_cents bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text,
  notes text,
  is_billable boolean not null default true,
  is_billed boolean not null default false,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (workspace_id, membership_id) references public.memberships (workspace_id, id),
  foreign key (workspace_id, invoice_id) references public.invoices (workspace_id, id),
  unique (workspace_id, source_id)
);
create index on public.expenses (workspace_id, spent_on);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null,
  number text,
  status text not null,
  issue_date date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_cents bigint not null default 0,
  source_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id),
  unique (workspace_id, source_id)
);
create index on public.estimates (workspace_id);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  started_by uuid references auth.users on delete set null,
  provider text not null default 'harvest',
  source_account_id text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  counts jsonb not null default '{}',
  -- {stage, next_url, skipped[], warnings{}}: where to continue after a timeout.
  progress jsonb not null default '{}',
  error text,
  attempts integer not null default 0,
  locked_until timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.imports (workspace_id);
create unique index imports_one_active_idx on public.imports (workspace_id) where status in ('queued', 'running');

-- Encrypted Harvest token, held only while an import runs. No policies: service role only.
create table public.import_secrets (
  import_id uuid primary key references public.imports on delete cascade,
  token_ciphertext text not null,
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  email text not null,
  role public.member_role not null default 'member',
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.invitations (token_hash);
create index on public.invitations (workspace_id);

do $$
declare t text;
begin
  foreach t in array array['workspaces','memberships','clients','contacts','projects','tasks','project_tasks',
    'invoices','invoice_items','time_entries','expenses','estimates','imports','invitations'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

---------------------------------------------------------------------------
-- Row Level Security helpers (security definer: they read memberships for auth.uid()).
---------------------------------------------------------------------------

create function public.my_workspace_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select workspace_id from public.memberships
  where user_id = (select auth.uid()) and is_active
$$;

create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships
    where workspace_id = ws and user_id = (select auth.uid()) and is_active)
$$;

create function public.has_role(ws uuid, roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships
    where workspace_id = ws and user_id = (select auth.uid()) and is_active and role = any (roles))
$$;

create function public.my_membership_id(ws uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.memberships
  where workspace_id = ws and user_id = (select auth.uid()) and is_active
$$;

-- False on the free archive plan and once a trial has lapsed: the database, not
-- the interface, makes those workspaces read-only.
create function public.is_writable(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces w
    where w.id = ws
      and w.plan <> 'archive'
      and w.plan_status in ('trialing', 'active', 'past_due')
      and (w.plan_status <> 'trialing' or w.trial_ends_at > now()))
$$;

create function public.can_admin_write(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_writable(ws) and public.has_role(ws, array['owner','admin']::public.member_role[])
$$;

revoke execute on function public.my_workspace_ids(), public.is_member(uuid), public.has_role(uuid, public.member_role[]),
  public.my_membership_id(uuid), public.is_writable(uuid), public.can_admin_write(uuid) from public, anon;
grant execute on function public.my_workspace_ids(), public.is_member(uuid), public.has_role(uuid, public.member_role[]),
  public.my_membership_id(uuid), public.is_writable(uuid), public.can_admin_write(uuid) to authenticated;

---------------------------------------------------------------------------
-- Policies
---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['workspaces','memberships','clients','contacts','projects','tasks','project_tasks',
    'invoices','invoice_items','time_entries','expenses','estimates','imports','invitations','import_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- Read: members of the workspace.
  foreach t in array array['memberships','clients','contacts','projects','tasks','project_tasks',
    'invoices','invoice_items','time_entries','expenses','estimates','imports'] loop
    execute format('create policy members_read on public.%I for select to authenticated
      using (workspace_id in (select public.my_workspace_ids()))', t);
  end loop;

  -- Write: admins and owners, only while the workspace is writable.
  foreach t in array array['clients','contacts','projects','tasks','project_tasks','invoices','invoice_items'] loop
    execute format('create policy admins_insert on public.%I for insert to authenticated
      with check (public.can_admin_write(workspace_id))', t);
    execute format('create policy admins_update on public.%I for update to authenticated
      using (public.can_admin_write(workspace_id)) with check (public.can_admin_write(workspace_id))', t);
    execute format('create policy admins_delete on public.%I for delete to authenticated
      using (public.can_admin_write(workspace_id))', t);
  end loop;
end $$;

-- Nobody but the service role touches stored tokens.
revoke all on public.import_secrets from authenticated;

create policy members_read on public.workspaces for select to authenticated
  using (id in (select public.my_workspace_ids()));
create policy owners_update on public.workspaces for update to authenticated
  using (public.has_role(id, array['owner']::public.member_role[]) and public.is_writable(id))
  with check (public.has_role(id, array['owner']::public.member_role[]) and public.is_writable(id));
-- Plan and billing fields are written only by the service role (billing webhook).
revoke update on public.workspaces from authenticated;
grant update (name, default_currency, invoice_prefix) on public.workspaces to authenticated;

create policy admins_read on public.invitations for select to authenticated
  using (public.has_role(workspace_id, array['owner','admin']::public.member_role[]));

-- Time entries: members edit their own uninvoiced rows; admins and owners any row.
create policy entries_insert on public.time_entries for insert to authenticated
  with check (public.is_writable(workspace_id) and (
    public.has_role(workspace_id, array['owner','admin']::public.member_role[])
    or (membership_id = public.my_membership_id(workspace_id) and invoice_id is null)));
create policy entries_update on public.time_entries for update to authenticated
  using (public.is_writable(workspace_id) and (
    public.has_role(workspace_id, array['owner','admin']::public.member_role[])
    or (membership_id = public.my_membership_id(workspace_id) and invoice_id is null)))
  with check (public.is_writable(workspace_id) and (
    public.has_role(workspace_id, array['owner','admin']::public.member_role[])
    or (membership_id = public.my_membership_id(workspace_id) and invoice_id is null)));
create policy entries_delete on public.time_entries for delete to authenticated
  using (public.is_writable(workspace_id) and (
    public.has_role(workspace_id, array['owner','admin']::public.member_role[])
    or (membership_id = public.my_membership_id(workspace_id) and invoice_id is null)));

-- memberships, expenses, estimates, imports: read-only for users in this slice
-- (imports and imported records are written by the import function's service role).

---------------------------------------------------------------------------
-- Signup: every new auth user gets a workspace and an owner membership.
---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
  who text := coalesce(nullif(split_part(new.email, '@', 1), ''), 'My');
begin
  insert into public.workspaces (name) values (who || '''s workspace') returning id into ws;
  insert into public.memberships (workspace_id, user_id, role, name, email)
    values (ws, new.id, 'owner', who, new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

---------------------------------------------------------------------------
-- Reconciliation views (security_invoker: RLS of the caller applies).
---------------------------------------------------------------------------

create view public.reconciliation_hours with (security_invoker = true) as
select workspace_id,
  extract(year from spent_on)::int as year,
  count(*) as entries,
  sum(coalesce(source_hours, minutes / 60.0)) as hours,
  sum(coalesce(source_rounded_hours, source_hours, minutes / 60.0)) as rounded_hours,
  coalesce(sum(coalesce(source_hours, minutes / 60.0)) filter (where is_billable), 0) as billable_hours
from public.time_entries
group by workspace_id, extract(year from spent_on);

create view public.reconciliation_invoices with (security_invoker = true) as
select workspace_id,
  extract(year from issue_date)::int as year,
  currency,
  status,
  count(*) as invoices,
  sum(total_cents) as total_cents,
  sum(due_cents) as due_cents
from public.invoices
group by workspace_id, extract(year from issue_date), currency, status;

-- Invoices whose stored totals don't add up: line items, discount, both taxes.
create view public.invoice_mismatches with (security_invoker = true) as
select i.workspace_id, i.id, i.number, i.currency, i.subtotal_cents, i.discount_cents,
  i.tax_cents, i.tax2_cents, i.total_cents,
  coalesce(li.items_cents, 0) as items_cents
from public.invoices i
left join lateral (
  select sum(amount_cents) as items_cents from public.invoice_items where invoice_id = i.id
) li on true
where i.subtotal_cents <> coalesce(li.items_cents, 0)
   or i.total_cents <> i.subtotal_cents - i.discount_cents + i.tax_cents + i.tax2_cents;

revoke all on public.reconciliation_hours, public.reconciliation_invoices, public.invoice_mismatches from anon;
