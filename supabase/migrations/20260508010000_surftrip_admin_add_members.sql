-- Surftrip admin: add members directly from existing DM partners.
-- Hosts and admins can pick from users they already have a 1-1 conversation
-- with and add them straight into the group (no join request flow).
--
-- Two RPCs:
--   list_addable_dm_partners(group_id) — DM partners not already in the group.
--   add_surftrip_members_from_dms(group_id, user_ids[]) — bulk insert. Caps to
--     the group's remaining max_members slots and returns the ids actually added.

-- ============================================================================
-- RPC: list_addable_dm_partners
-- ============================================================================
create or replace function public.list_addable_dm_partners(
  p_group_id uuid
)
returns table (
  user_id uuid,
  last_dm_at timestamptz
)
language plpgsql
security definer
stable
as $$
#variable_conflict use_column
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select role into v_caller_role
    from public.surftrip_group_members
    where group_id = p_group_id and user_id = v_caller;

  if v_caller_role is null or v_caller_role not in ('host','admin') then
    raise exception 'only host or admin can list addable members';
  end if;

  return query
    select
      cm_other.user_id,
      max(c.updated_at) as last_dm_at
    from public.conversation_members cm_self
    join public.conversations c
      on c.id = cm_self.conversation_id
    join public.conversation_members cm_other
      on cm_other.conversation_id = c.id
    where cm_self.user_id = v_caller
      and c.is_direct = true
      and cm_other.user_id <> v_caller
      and not exists (
        select 1 from public.surftrip_group_members m
        where m.group_id = p_group_id
          and m.user_id = cm_other.user_id
      )
    group by cm_other.user_id
    order by max(c.updated_at) desc nulls last;
end;
$$;

grant execute on function public.list_addable_dm_partners(uuid) to authenticated;

-- ============================================================================
-- RPC: add_surftrip_members_from_dms
-- Host/admin only. Inserts up to remaining max_members slots into both
-- surftrip_group_members and conversation_members. Skips users already in
-- the group, the caller, and any user without an existing 1-1 DM with the
-- caller. Returns the user_ids actually added.
-- ============================================================================
create or replace function public.add_surftrip_members_from_dms(
  p_group_id uuid,
  p_user_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_conversation_id uuid;
  v_max integer;
  v_current integer;
  v_available integer;
  v_to_add uuid[];
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return array[]::uuid[];
  end if;

  -- Lock the group row to prevent races on slot computation.
  select g.conversation_id, g.max_members
    into v_conversation_id, v_max
    from public.surftrip_groups g
    where g.id = p_group_id
    for update;

  if v_conversation_id is null then
    raise exception 'group not found';
  end if;

  select role into v_caller_role
    from public.surftrip_group_members
    where group_id = p_group_id and user_id = v_caller;

  if v_caller_role is null or v_caller_role not in ('host','admin') then
    raise exception 'only host or admin can add members';
  end if;

  select count(*) into v_current
    from public.surftrip_group_members
    where group_id = p_group_id;

  v_available := v_max - v_current;
  if v_available <= 0 then
    return array[]::uuid[];
  end if;

  -- Eligibility: caller must have an existing 1-1 DM with the user, the user
  -- must not already be a member, and must not be the caller. Preserve the
  -- caller-supplied order so a partial add is predictable.
  with caller_dm_partners as (
    select distinct cm_other.user_id
    from public.conversation_members cm_self
    join public.conversations c
      on c.id = cm_self.conversation_id
    join public.conversation_members cm_other
      on cm_other.conversation_id = c.id
    where cm_self.user_id = v_caller
      and c.is_direct = true
      and cm_other.user_id <> v_caller
  ),
  eligible as (
    select u.uid, u.ord
    from unnest(p_user_ids) with ordinality as u(uid, ord)
    where u.uid <> v_caller
      and u.uid in (select user_id from caller_dm_partners)
      and not exists (
        select 1 from public.surftrip_group_members m
        where m.group_id = p_group_id
          and m.user_id = u.uid
      )
    order by u.ord
    limit v_available
  )
  select array_agg(uid order by ord) into v_to_add from eligible;

  if v_to_add is null or array_length(v_to_add, 1) is null then
    return array[]::uuid[];
  end if;

  insert into public.surftrip_group_members (group_id, user_id, role)
  select p_group_id, uid, 'member' from unnest(v_to_add) as t(uid)
  on conflict (group_id, user_id) do nothing;

  insert into public.conversation_members (conversation_id, user_id, role)
  select v_conversation_id, uid, 'member' from unnest(v_to_add) as t(uid)
  on conflict (conversation_id, user_id) do nothing;

  return v_to_add;
end;
$$;

grant execute on function public.add_surftrip_members_from_dms(uuid, uuid[]) to authenticated;

-- ============================================================================
-- RPC: list_my_dm_partners
-- Used at surftrip-creation time so the host can pick people to add
-- immediately, before the group exists.
-- ============================================================================
create or replace function public.list_my_dm_partners()
returns table (
  user_id uuid,
  last_dm_at timestamptz
)
language plpgsql
security definer
stable
as $$
#variable_conflict use_column
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  return query
    select
      cm_other.user_id,
      max(c.updated_at) as last_dm_at
    from public.conversation_members cm_self
    join public.conversations c
      on c.id = cm_self.conversation_id
    join public.conversation_members cm_other
      on cm_other.conversation_id = c.id
    where cm_self.user_id = v_caller
      and c.is_direct = true
      and cm_other.user_id <> v_caller
    group by cm_other.user_id
    order by max(c.updated_at) desc nulls last;
end;
$$;

grant execute on function public.list_my_dm_partners() to authenticated;
