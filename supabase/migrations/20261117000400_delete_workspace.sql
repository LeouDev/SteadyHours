-- "Delete my workspace": the owner removes the workspace and everything in it, permanently.
-- Every table holding workspace data references workspaces(id) with ON DELETE CASCADE, and
-- import_secrets cascades from imports, so one delete removes it all in a single transaction.
-- A login exists only to reach its workspace, so the owner's login goes too unless it belongs
-- to another workspace.
create function public.delete_workspace(ws uuid, confirmation text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  workspace_name text;
begin
  if uid is null then
    raise exception 'Sign in to delete a workspace.' using errcode = '42501';
  end if;
  if not public.has_role(ws, array['owner']::public.member_role[]) then
    raise exception 'Only the workspace owner can delete it.' using errcode = '42501';
  end if;
  select name into workspace_name from public.workspaces where id = ws;
  if confirmation is distinct from workspace_name then
    raise exception 'The name you typed doesn’t match the workspace name.' using errcode = '22023';
  end if;

  delete from public.workspaces where id = ws;

  if not exists (select 1 from public.memberships where user_id = uid) then
    delete from auth.users where id = uid;
  end if;
end $$;

revoke execute on function public.delete_workspace(uuid, text) from public, anon;
grant execute on function public.delete_workspace(uuid, text) to authenticated;
