-- Surftrip Invite Links
-- Tokenized invite links for surftrip groups. Behavior at accept-time depends
-- on the sharer's role (frozen at creation as audit, but re-checked at click).
--   - sharer was AND still is host/admin → invitee auto-joins
--   - otherwise (member-shared, demoted, or sharer left group) → pending request
-- One stable token per (group_id, created_by). Revocable via revoked_at.

-- ============================================================================
-- Table: surftrip_invite_links
-- ============================================================================
create table if not exists public.surftrip_invite_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.surftrip_groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_role text not null check (created_role in ('host','admin','member')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (group_id, created_by)
);

create index if not exists surftrip_invite_links_group_id_idx
  on public.surftrip_invite_links(group_id);
create index if not exists surftrip_invite_links_created_by_idx
  on public.surftrip_invite_links(created_by);

alter table public.surftrip_invite_links enable row level security;

-- A member can read their own invite token row to retrieve / re-share the link.
-- All writes go through SECURITY DEFINER RPCs.
drop policy if exists "surftrip_invite_links creator can read own" on public.surftrip_invite_links;
create policy "surftrip_invite_links creator can read own"
  on public.surftrip_invite_links for select
  to authenticated
  using (
    created_by = auth.uid()
    and exists (
      select 1 from public.surftrip_group_members m
      where m.group_id = surftrip_invite_links.group_id
        and m.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Helper: add member to surftrip + conversation atomically
-- Mirrors what handle_surftrip_join_request_approval does inline today.
-- Used by the new accept_surftrip_invite RPC AND the (refactored) approval trigger.
-- ============================================================================
create or replace function public.add_surftrip_member_with_conversation(
  p_group_id uuid,
  p_user_id uuid,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
as $$
declare
  v_conversation_id uuid;
begin
  insert into public.surftrip_group_members (group_id, user_id, role)
  values (p_group_id, p_user_id, p_role)
  on conflict (group_id, user_id) do nothing;

  select conversation_id into v_conversation_id
  from public.surftrip_groups where id = p_group_id;

  if v_conversation_id is not null then
    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_conversation_id, p_user_id, 'member')
    on conflict (conversation_id, user_id) do nothing;
  end if;
end;
$$;

-- ============================================================================
-- Refactor: handle_surftrip_join_request_approval
-- Now wraps the membership insert in an advisory lock + capacity check so the
-- existing approval flow can't overflow max_members. Calls the new helper.
-- ============================================================================
create or replace function public.handle_surftrip_join_request_approval()
returns trigger
language plpgsql
security definer
as $$
declare
  v_max int;
  v_count int;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    -- Serialize concurrent approvals/accepts on the same group.
    perform pg_advisory_xact_lock(hashtext('surftrip:' || new.group_id::text));

    select max_members into v_max
    from public.surftrip_groups where id = new.group_id;

    select count(*) into v_count
    from public.surftrip_group_members where group_id = new.group_id;

    if v_max is not null and v_count >= v_max then
      raise exception 'surftrip_group_full' using errcode = 'check_violation';
    end if;

    perform public.add_surftrip_member_with_conversation(
      new.group_id, new.requester_id, 'member'
    );
  end if;
  return new;
end;
$$;

-- (Trigger itself is unchanged — already created in 20260506000000.)

-- ============================================================================
-- RPC: create_surftrip_invite
-- Caller must be a member. Captures current role. Upserts a stable token row
-- per (group_id, created_by). If a revoked row exists for the caller, un-revokes
-- it and refreshes created_role to current.
-- ============================================================================
create or replace function public.create_surftrip_invite(p_group_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select role into v_role
  from public.surftrip_group_members
  where group_id = p_group_id and user_id = v_user;

  if v_role is null then
    raise exception 'not a member of this surftrip';
  end if;

  insert into public.surftrip_invite_links (group_id, created_by, created_role)
  values (p_group_id, v_user, v_role)
  on conflict (group_id, created_by) do update
    set created_role = excluded.created_role,
        revoked_at = null
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_surftrip_invite(uuid) to authenticated;

-- ============================================================================
-- RPC: accept_surftrip_invite
-- Outcomes (json):
--   {outcome: 'invalid'}                        — token missing/revoked, or group archived
--   {outcome: 'already_member', group_id, conversation_id}
--   {outcome: 'joined',         group_id, conversation_id}   — auto-join (admin link, sharer still authoritative)
--   {outcome: 'requested',      group_id}                    — pending request created
--   {outcome: 'group_full'}                                  — admin link but no seats
-- ============================================================================
create or replace function public.accept_surftrip_invite(p_token uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_user uuid := auth.uid();
  v_link public.surftrip_invite_links;
  v_group public.surftrip_groups;
  v_current_role text;
  v_effective_role text;
  v_count int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_link from public.surftrip_invite_links where id = p_token;
  if v_link.id is null or v_link.revoked_at is not null then
    return json_build_object('outcome', 'invalid');
  end if;

  select * into v_group from public.surftrip_groups where id = v_link.group_id;
  if v_group.id is null or v_group.status <> 'active' then
    return json_build_object('outcome', 'invalid');
  end if;

  -- Already a member?
  if exists (
    select 1 from public.surftrip_group_members
    where group_id = v_link.group_id and user_id = v_user
  ) then
    return json_build_object(
      'outcome', 'already_member',
      'group_id', v_group.id,
      'conversation_id', v_group.conversation_id
    );
  end if;

  -- Current role of sharer (null if they left the group).
  select role into v_current_role
  from public.surftrip_group_members
  where group_id = v_link.group_id and user_id = v_link.created_by;

  -- Effective role: link grants min(frozen, current). Sharer must still be a
  -- member for the link to retain any authority at all. This is the "hybrid"
  -- safety check — frozen role is the audit trail, current role is the gate.
  if v_current_role is null then
    v_effective_role := null;
  elsif v_link.created_role = 'member' or v_current_role = 'member' then
    v_effective_role := 'member';
  elsif v_link.created_role = 'admin' or v_current_role = 'admin' then
    v_effective_role := 'admin';
  else
    v_effective_role := 'host';
  end if;

  -- Auto-join path: sharer was AND still is admin/host.
  if v_effective_role in ('host','admin') then
    -- Serialize concurrent accepts to enforce max_members deterministically.
    perform pg_advisory_xact_lock(hashtext('surftrip:' || v_group.id::text));

    select count(*) into v_count
    from public.surftrip_group_members where group_id = v_group.id;

    if v_count >= coalesce(v_group.max_members, 50) then
      return json_build_object('outcome', 'group_full');
    end if;

    perform public.add_surftrip_member_with_conversation(
      v_group.id, v_user, 'member'
    );

    -- If a pending request happens to exist, mark it approved for clean state.
    -- Membership is already inserted, so the approval trigger's insert no-ops.
    update public.surftrip_join_requests
       set status = 'approved',
           reviewed_by = v_link.created_by,
           reviewed_at = now()
     where group_id = v_group.id
       and requester_id = v_user
       and status = 'pending';

    return json_build_object(
      'outcome', 'joined',
      'group_id', v_group.id,
      'conversation_id', v_group.conversation_id
    );
  end if;

  -- Request path: member-shared, sharer demoted, or sharer no longer in group.
  insert into public.surftrip_join_requests (group_id, requester_id, request_note)
  values (v_group.id, v_user, null)
  on conflict do nothing;
  -- (partial unique index on group_id+requester_id where status='pending'
  --  blocks duplicate pending; declined/withdrawn rows don't conflict.)

  return json_build_object('outcome', 'requested', 'group_id', v_group.id);
end;
$$;

grant execute on function public.accept_surftrip_invite(uuid) to authenticated;

-- ============================================================================
-- RPC: get_surftrip_invite_preview
-- Anonymous-callable. Returns a whitelisted preview for the landing page so
-- unauthenticated visitors see "Join Eyal's Costa Rica Trip" instead of a
-- generic Get-the-App page. Returns null fields for invalid/revoked tokens
-- (don't leak existence).
-- ============================================================================
create or replace function public.get_surftrip_invite_preview(p_token uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_link public.surftrip_invite_links;
  v_group public.surftrip_groups;
  v_host_name text;
  v_count int;
begin
  select * into v_link from public.surftrip_invite_links where id = p_token;
  if v_link.id is null or v_link.revoked_at is not null then
    return json_build_object(
      'group_name', null,
      'hero_image_url', null,
      'host_display_name', null,
      'member_count', null,
      'max_members', null
    );
  end if;

  select * into v_group from public.surftrip_groups where id = v_link.group_id;
  if v_group.id is null or v_group.status <> 'active' then
    return json_build_object(
      'group_name', null,
      'hero_image_url', null,
      'host_display_name', null,
      'member_count', null,
      'max_members', null
    );
  end if;

  select name into v_host_name from public.surfers where user_id = v_group.host_id;
  select count(*) into v_count
  from public.surftrip_group_members where group_id = v_group.id;

  return json_build_object(
    'group_name', v_group.name,
    'hero_image_url', v_group.hero_image_url,
    'host_display_name', v_host_name,
    'member_count', v_count,
    'max_members', v_group.max_members
  );
end;
$$;

grant execute on function public.get_surftrip_invite_preview(uuid) to anon, authenticated;
