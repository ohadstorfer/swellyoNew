-- Auto-promote the oldest remaining member to host when the last host/admin
-- leaves a surftrip group. Keeps surftrip_groups.host_id in sync so RLS
-- policies that reference host_id continue to grant the right user.

create or replace function public.handle_surftrip_member_removed()
returns trigger
language plpgsql
security definer
as $$
declare
  v_remaining_admins integer;
  v_new_host_user_id uuid;
begin
  -- Only react when the row that left was a host or admin.
  if old.role not in ('host', 'admin') then
    return old;
  end if;

  -- Count remaining host/admin rows for this group.
  select count(*) into v_remaining_admins
    from public.surftrip_group_members
    where group_id = old.group_id
      and role in ('host', 'admin');

  if v_remaining_admins > 0 then
    return old; -- still at least one admin/host
  end if;

  -- No admin/host left. Find the oldest remaining member.
  select user_id into v_new_host_user_id
    from public.surftrip_group_members
    where group_id = old.group_id
    order by joined_at asc
    limit 1;

  if v_new_host_user_id is null then
    return old; -- group has no members; nothing to do
  end if;

  -- Promote them to host, and sync the group's host_id pointer.
  update public.surftrip_group_members
    set role = 'host'
    where group_id = old.group_id
      and user_id = v_new_host_user_id;

  update public.surftrip_groups
    set host_id = v_new_host_user_id
    where id = old.group_id;

  return old;
end;
$$;

drop trigger if exists trg_surftrip_auto_promote_oldest on public.surftrip_group_members;
create trigger trg_surftrip_auto_promote_oldest
  after delete on public.surftrip_group_members
  for each row execute function public.handle_surftrip_member_removed();
