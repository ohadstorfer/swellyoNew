-- Trip chat membership sync (spec: docs/specs/trip-chat-tab.md, reqs 22-27).
--
-- What this does, in short:
--   1. conversation_members.left_at: a row with left_at set is a DEPARTED
--      member. They can read messages up to left_at and nothing else.
--   2. The server now owns who is in a trip chat. One function,
--      recompute_trip_chat_member(trip, user), looks at every source (trip
--      owner, host rows, active travelers, chat staff) and makes the chat row
--      active or departed. Triggers on participants, staff, staff tiers,
--      group_trips.host_id and conversations all call it.
--   3. ensure_trip_conversation(trip_id) RPC: returns the trip chat id, and
--      creates it (with all members) when a legacy trip has none.
--   4. RLS: "member" now means ACTIVE member everywhere (send, react, edit,
--      delete, realtime topics, uploads). Departed members keep read access to
--      old messages, the conversation row and the member list.
--   5. Guards so old app builds cannot undo the server: a user can no longer
--      change left_at, delete a trip chat row, or add themselves to a trip chat
--      they are not entitled to.
--   6. Backfill.
--
-- Everything is based on the LIVE definitions read on 2026-09-23, not on older
-- repo copies. Policies are changed with ALTER POLICY, so their name, command,
-- roles and permissive flag stay exactly as they are live.
--
-- "Active" in a trip chat (same rule as the old Trip Chat button):
--   - group_trips.host_id, or
--   - a participant row with role 'host' and status 'onboarding'/'active', or
--   - a participant row with role 'member' and status 'active'
--     ('onboarding' travelers hold no seat and never got the chat), or
--   - an operator-trip staff row: user_id set, accepted, not revoked, and the
--     tier resolves (same lookup as trip_staff_can) to a capability list with
--     'chat.participate'.
--
-- The trip chat is the OLDEST non-direct conversation whose metadata.trip_id
-- is the trip ("canonical"). Live has duplicates (El Salvador 26 has 3). Only
-- the canonical one is synced. Duplicates are left as they are.
--
-- Apply with MCP apply_migration. Never `db push`.


-- ---------------------------------------------------------------------------
-- 1. Column + index
-- ---------------------------------------------------------------------------

alter table public.conversation_members
  add column if not exists left_at timestamptz null;

comment on column public.conversation_members.left_at is
  'Set when the member left the chat (trip departure, staff revoked). Null = active. Departed members can read messages with created_at <= left_at only. Written only by the server (see guard_conversation_member_write).';

-- Trip chat lookups by trip id (triggers, RPC, and the client's
-- getConversationByTripId all filter on this).
create index if not exists idx_conversations_trip_id
  on public.conversations ((metadata->>'trip_id'));


-- ---------------------------------------------------------------------------
-- 2. Small helpers
-- ---------------------------------------------------------------------------

-- True while one of our own sync functions is writing conversation_members.
-- The guard trigger (section 5) lets those writes through.
create or replace function public._trip_chat_sync_on()
returns boolean
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select coalesce(nullif(current_setting('app.trip_chat_sync', true), ''), 'off') = 'on';
$function$;

-- The canonical trip chat: the oldest one for the trip. Null if none.
create or replace function public.trip_conversation_id(p_trip_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select c.id
  from public.conversations c
  where c.metadata->>'trip_id' = p_trip_id::text
    and c.is_direct = false
  order by c.created_at asc, c.id asc
  limit 1;
$function$;

-- Should this user be an ACTIVE member of this trip's chat right now?
-- Reads every source. The staff part copies trip_staff_can's tier lookup
-- (operator override first, then the global tier).
create or replace function public.trip_chat_entitled(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select p_user_id is not null and (
    -- the trip owner, always
    exists (
      select 1 from public.group_trips t
      where t.id = p_trip_id and t.host_id = p_user_id
    )
    -- hosts, and travelers who hold a seat
    or exists (
      select 1 from public.group_trip_participants p
      where p.trip_id = p_trip_id and p.user_id = p_user_id
        and (
          (p.role = 'host' and p.status in ('onboarding', 'active'))
          or (p.role <> 'host' and p.status = 'active')
        )
    )
    -- operator-trip staff whose tier can chat
    or exists (
      select 1
      from public.organized_trip_staff s
      join public.group_trips t on t.id = s.trip_id and t.hosting_style = 'C'
      join lateral (
        select r.capabilities from public.organized_trip_staff_roles r
        where r.role_key = s.role_key
          and (r.operator_id = s.operator_id or r.operator_id is null)
        order by r.operator_id nulls last
        limit 1
      ) r on true
      where s.trip_id = p_trip_id and s.user_id = p_user_id
        and s.accepted_at is not null and s.revoked_at is null
        and 'chat.participate' = any(r.capabilities)
    )
  );
$function$;


-- ---------------------------------------------------------------------------
-- 3. The one function that decides, and the "whole trip" version
-- ---------------------------------------------------------------------------

-- Make one user's row in the trip chat match the rules above.
--   entitled  -> upsert, left_at = null (rejoin clears it)
--   not       -> left_at = p_left_at (or now()), only if currently active
-- Does nothing when the trip or its chat does not exist, or the user has no
-- public.users row (conversation_members.user_id references it).
create or replace function public.recompute_trip_chat_member(
  p_trip_id uuid,
  p_user_id uuid,
  p_left_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_conv    uuid;
  v_creator uuid;
  v_prev    text;
begin
  if p_trip_id is null or p_user_id is null then
    return;
  end if;
  -- Trip gone (e.g. this runs inside the trip's ON DELETE CASCADE): leave the
  -- chat exactly as it is.
  if not exists (select 1 from public.group_trips where id = p_trip_id) then
    return;
  end if;

  v_conv := public.trip_conversation_id(p_trip_id);
  if v_conv is null then
    return;   -- legacy trip, chat not created yet. ensure_trip_conversation adds everyone.
  end if;

  v_prev := current_setting('app.trip_chat_sync', true);
  perform set_config('app.trip_chat_sync', 'on', true);

  if public.trip_chat_entitled(p_trip_id, p_user_id) then
    if exists (select 1 from public.users where id = p_user_id) then
      select created_by into v_creator from public.conversations where id = v_conv;
      insert into public.conversation_members (conversation_id, user_id, role, left_at)
      values (v_conv, p_user_id,
              case when p_user_id = v_creator then 'owner' else 'member' end,
              null)
      on conflict (conversation_id, user_id) do update
        set left_at = null
        where conversation_members.left_at is not null;
    end if;
  else
    update public.conversation_members
       set left_at = coalesce(p_left_at, now())
     where conversation_id = v_conv
       and user_id = p_user_id
       and left_at is null;
  end if;

  perform set_config('app.trip_chat_sync', coalesce(v_prev, ''), true);
end;
$function$;

-- Recompute every person who is, or could be, in the trip chat.
create or replace function public.sync_trip_chat_members(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_conv uuid;
  v_user uuid;
begin
  v_conv := public.trip_conversation_id(p_trip_id);
  if v_conv is null then
    return;
  end if;

  for v_user in
    select t.host_id from public.group_trips t
     where t.id = p_trip_id and t.host_id is not null
    union
    select p.user_id from public.group_trip_participants p where p.trip_id = p_trip_id
    union
    select s.user_id from public.organized_trip_staff s
     where s.trip_id = p_trip_id and s.user_id is not null
    union
    select cm.user_id from public.conversation_members cm where cm.conversation_id = v_conv
  loop
    perform public.recompute_trip_chat_member(p_trip_id, v_user);
  end loop;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 4. Triggers that keep the chat in sync
--
-- A failed chat sync must never block leaving, removal, refunds or staff
-- changes, so each trigger catches errors and raises a WARNING instead.
-- ---------------------------------------------------------------------------

-- group_trip_participants: approve, activate, leave, remove, delete (peer
-- trips), host promote/demote. Named trg_sync_trip_chat_member so it runs
-- AFTER trg_sync_primary_trip_host (triggers run in name order): by then a
-- reassigned host_id is already in place.
create or replace function public.tg_sync_trip_chat_from_participant()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  begin
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.recompute_trip_chat_member(
        old.trip_id, old.user_id,
        -- operator trips record the real departure time on the row
        case when tg_op = 'UPDATE' and new.status in ('left', 'removed')
             then new.left_at end
      );
    end if;
    if tg_op in ('INSERT', 'UPDATE')
       and (tg_op = 'INSERT' or new.trip_id is distinct from old.trip_id
            or new.user_id is distinct from old.user_id) then
      perform public.recompute_trip_chat_member(new.trip_id, new.user_id);
    end if;
  exception when others then
    raise warning 'trip chat sync (participant) failed for trip %, user %: %',
      coalesce(new.trip_id, old.trip_id), coalesce(new.user_id, old.user_id), sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_sync_trip_chat_member on public.group_trip_participants;
create trigger trg_sync_trip_chat_member
  after insert or delete or update of status, role, user_id, trip_id
  on public.group_trip_participants
  for each row execute function public.tg_sync_trip_chat_from_participant();

-- organized_trip_staff: invite accepted, revoked, tier changed, deleted.
create or replace function public.tg_sync_trip_chat_from_staff()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  begin
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.recompute_trip_chat_member(old.trip_id, old.user_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE')
       and (tg_op = 'INSERT' or new.trip_id is distinct from old.trip_id
            or new.user_id is distinct from old.user_id) then
      perform public.recompute_trip_chat_member(new.trip_id, new.user_id);
    end if;
  exception when others then
    raise warning 'trip chat sync (staff) failed for trip %, user %: %',
      coalesce(new.trip_id, old.trip_id), coalesce(new.user_id, old.user_id), sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_sync_trip_chat_member on public.organized_trip_staff;
create trigger trg_sync_trip_chat_member
  after insert or delete or update of accepted_at, revoked_at, role_key, user_id, trip_id
  on public.organized_trip_staff
  for each row execute function public.tg_sync_trip_chat_from_staff();

-- organized_trip_staff_roles: a tier gains or loses chat.participate.
-- Tiers are global (operator_id null) with optional per-operator overrides, so
-- a global change touches that tier's staff on every trip, and an override
-- touches only that operator's staff. Inserting or deleting an override can
-- change the resolved tier too, so those fire as well.
create or replace function public.tg_sync_trip_chat_from_staff_role()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_row record;
begin
  begin
    for v_row in
      select distinct s.trip_id, s.user_id
      from public.organized_trip_staff s
      where s.user_id is not null
        and (
          (tg_op <> 'INSERT' and s.role_key = old.role_key
             and (old.operator_id is null or s.operator_id = old.operator_id))
          or
          (tg_op <> 'DELETE' and s.role_key = new.role_key
             and (new.operator_id is null or s.operator_id = new.operator_id))
        )
    loop
      perform public.recompute_trip_chat_member(v_row.trip_id, v_row.user_id);
    end loop;
  exception when others then
    raise warning 'trip chat sync (staff tier) failed: %', sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_sync_trip_chat_members on public.organized_trip_staff_roles;
create trigger trg_sync_trip_chat_members
  after insert or delete or update of capabilities, role_key, operator_id
  on public.organized_trip_staff_roles
  for each row execute function public.tg_sync_trip_chat_from_staff_role();

-- group_trips.host_id moves (sync_primary_trip_host reassigns it). The new
-- owner is always active; the old one is recomputed from their other roles.
create or replace function public.tg_sync_trip_chat_from_trip_host()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  begin
    perform public.recompute_trip_chat_member(new.id, new.host_id);
    perform public.recompute_trip_chat_member(new.id, old.host_id);
  exception when others then
    raise warning 'trip chat sync (host_id) failed for trip %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_sync_trip_chat_host on public.group_trips;
create trigger trg_sync_trip_chat_host
  after update of host_id on public.group_trips
  for each row
  when (old.host_id is distinct from new.host_id)
  execute function public.tg_sync_trip_chat_from_trip_host();

-- A trip chat is created (by the RPC below, or by an OLD app build that still
-- inserts the conversation itself): add every current member at once.
create or replace function public.tg_sync_trip_chat_on_create()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_trip uuid;
begin
  begin
    v_trip := (new.metadata->>'trip_id')::uuid;
    -- Only the canonical chat is synced. A late duplicate is left alone.
    if public.trip_conversation_id(v_trip) = new.id then
      perform public.sync_trip_chat_members(v_trip);
    end if;
  exception when others then
    raise warning 'trip chat sync (create) failed for conversation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_sync_trip_chat_on_create on public.conversations;
create trigger trg_sync_trip_chat_on_create
  after insert on public.conversations
  for each row
  when (new.is_direct = false and (new.metadata ? 'trip_id'))
  execute function public.tg_sync_trip_chat_on_create();


-- ---------------------------------------------------------------------------
-- 5. Guard: users cannot undo the server
--
-- The existing conversation_members policies let a user insert, update and
-- delete their own row, and let the conversation creator do it for anyone.
-- Without this guard:
--   - a departed user could UPDATE left_at back to null,
--   - an old build's removeConversationMember would DELETE the row and wipe
--     the departed user's read-only history,
--   - anyone could INSERT themselves into a trip chat they are not on.
-- Only applies to signed-in users (auth.uid() set) outside our own sync
-- functions. Service role and our SECURITY DEFINER sync are not affected.
-- ---------------------------------------------------------------------------

create or replace function public.guard_conversation_member_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_trip_text text;
  v_is_trip   boolean;
begin
  -- Trusted paths: service role, and our own sync functions.
  if auth.uid() is null or public._trip_chat_sync_on() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select c.metadata->>'trip_id', (c.is_direct = false and c.metadata ? 'trip_id')
    into v_trip_text, v_is_trip
    from public.conversations c
   where c.id = case when tg_op = 'DELETE' then old.conversation_id else new.conversation_id end;
  v_is_trip := coalesce(v_is_trip, false);

  if tg_op = 'UPDATE' then
    -- Users may update their read watermark and preferences, never who is
    -- in the chat or whether they left.
    new.left_at         := old.left_at;
    new.conversation_id := old.conversation_id;
    new.user_id         := old.user_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Direct statement on a trip chat (depth 1): keep the row. The trip
    -- triggers already set left_at. A cascade (conversation or user deleted)
    -- runs deeper and is allowed.
    if v_is_trip and pg_trigger_depth() = 1 then
      return null;
    end if;
    return old;
  end if;

  -- INSERT
  new.left_at := null;
  if v_is_trip then
    -- Old builds insert the owner row after creating the chat, and upsert on
    -- approval. The server already did it: skip, so the insert does not fail
    -- on the primary key.
    if exists (select 1 from public.conversation_members cm
                where cm.conversation_id = new.conversation_id
                  and cm.user_id = new.user_id) then
      return null;
    end if;
    -- Not on the trip: silently skip, never let them in.
    begin
      if not public.trip_chat_entitled(v_trip_text::uuid, new.user_id) then
        return null;
      end if;
    exception when invalid_text_representation then
      return null;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_conversation_member_write on public.conversation_members;
create trigger trg_guard_conversation_member_write
  before insert or update or delete on public.conversation_members
  for each row execute function public.guard_conversation_member_write();

-- Tell the user's inbox when they leave or come back, so the app refetches.
-- Same channel and payload shape as broadcast_new_member ('member_added' on
-- rejoin; new op 'member_left' on departure).
create or replace function public.broadcast_member_left_at_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'realtime'
as $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'conversation_id', new.conversation_id,
        'op', case when new.left_at is null then 'member_added' else 'member_left' end
      ),
      'inbox_change',
      'user-inbox:' || new.user_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_member_left_at_change failed for %: %', new.user_id, sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists trg_broadcast_member_left_at_change on public.conversation_members;
create trigger trg_broadcast_member_left_at_change
  after update of left_at on public.conversation_members
  for each row
  when (old.left_at is distinct from new.left_at)
  execute function public.broadcast_member_left_at_change();


-- ---------------------------------------------------------------------------
-- 6. RPC: ensure_trip_conversation(p_trip_id uuid) returns uuid
--
-- Returns the trip chat id. Creates it when the trip has none (legacy trips),
-- the same shape the client used to insert: is_direct false, title = trip
-- title (trimmed, 'Surftrip' when empty), metadata {"trip_id": "<uuid>"}.
-- The creation trigger then adds every current member.
--
-- created_by is the trip OWNER (host_id), not the caller. created_by gives
-- extra rights in the conversations/conversation_members policies, which a
-- traveler who happened to open the chat first should not get.
--
-- Who may call it:
--   - an active member (see the rules at the top): gets the id, chat created
--     if needed;
--   - a departed member (has a row with left_at set): gets the id of the
--     existing chat, never creates one;
--   - anyone else: error 42501.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_trip_conversation(p_trip_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_host  uuid;
  v_title text;
  v_conv  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select t.host_id, t.title into v_host, v_title
    from public.group_trips t where t.id = p_trip_id;
  if not found then
    raise exception 'No such trip' using errcode = 'P0002';
  end if;

  if not public.trip_chat_entitled(p_trip_id, v_uid) then
    v_conv := public.trip_conversation_id(p_trip_id);
    if v_conv is not null and exists (
      select 1 from public.conversation_members cm
       where cm.conversation_id = v_conv and cm.user_id = v_uid
    ) then
      return v_conv;   -- departed: read-only view of the existing chat
    end if;
    raise exception 'You are not a member of this trip chat' using errcode = '42501';
  end if;

  -- One creator at a time per trip, so two people opening a legacy trip at
  -- once do not make two chats.
  perform pg_advisory_xact_lock(hashtext('trip_chat:' || p_trip_id::text));

  v_conv := public.trip_conversation_id(p_trip_id);
  if v_conv is null then
    insert into public.conversations (is_direct, title, created_by, metadata)
    values (false,
            coalesce(nullif(btrim(v_title), ''), 'Surftrip'),
            coalesce(v_host, v_uid),
            jsonb_build_object('trip_id', p_trip_id::text))
    returning id into v_conv;
    -- trg_sync_trip_chat_on_create has now added every member.
  end if;

  -- Heals the caller's own row if it drifted (cheap, idempotent).
  perform public.recompute_trip_chat_member(p_trip_id, v_uid);

  return v_conv;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 7. Membership helpers used by RLS
-- ---------------------------------------------------------------------------

-- "Member" now means ACTIVE member. Same signatures, same languages as live;
-- only `and cm.left_at is null` is added.
create or replace function public.is_user_conversation_member(check_user_id uuid, conv_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- SECURITY DEFINER so it can read conversation_members without RLS recursion.
  -- Active members only (left_at is null).
  return exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conv_id
      and cm.user_id = check_user_id
      and cm.left_at is null
  );
end;
$function$;

create or replace function public.is_conversation_member(conv_id uuid, check_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- Active members only (left_at is null).
  return exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conv_id
      and cm.user_id = check_user_id
      and cm.left_at is null
  );
end;
$function$;

create or replace function public.is_conversation_member(conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conv and cm.user_id = (select auth.uid())
      and cm.left_at is null
  );
$function$;

create or replace function public.is_conv_member_for_current_user(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conv_id and cm.user_id = (select auth.uid())
      and cm.left_at is null
  );
$function$;

-- NEW: has a row at all, active OR departed. For read-only things a departed
-- member still needs: the conversation row (title) and the member list
-- (sender names in the history).
create or replace function public.was_conversation_member(conv_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conv_id and cm.user_id = check_user_id
  );
$function$;

-- NEW: the departed member's left_at, or null when active / not a member.
-- `created_at <= null` is null, so an active member never matches the
-- departed branch through this.
create or replace function public.conversation_left_at(check_user_id uuid, conv_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select cm.left_at from public.conversation_members cm
  where cm.conversation_id = conv_id and cm.user_id = check_user_id;
$function$;


-- ---------------------------------------------------------------------------
-- 8. RLS policies (ALTER POLICY: only the expression changes)
-- ---------------------------------------------------------------------------

-- conversations: departed members can still load the row (title).
-- live: ((created_by = auth.uid()) OR is_conversation_member(id, auth.uid()))
alter policy conversations_select_members on public.conversations
  using ((created_by = auth.uid()) or public.was_conversation_member(id, auth.uid()));

-- conversations: only ACTIVE owner/admin members may rename etc.
alter policy conversations_update_admin_or_creator on public.conversations
  using ((created_by = auth.uid()) or (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversations.id and cm.user_id = auth.uid()
      and cm.role = any (array['owner'::text, 'admin'::text])
      and cm.left_at is null)))
  with check ((created_by = auth.uid()) or (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversations.id and cm.user_id = auth.uid()
      and cm.role = any (array['owner'::text, 'admin'::text])
      and cm.left_at is null)));

-- conversation_members: departed members still see the member list.
alter policy conversation_members_select on public.conversation_members
  using ((user_id = (select auth.uid()))
         or (exists (select 1 from public.conversations c
                      where c.id = conversation_members.conversation_id
                        and c.created_by = (select auth.uid())))
         or public.was_conversation_member(conversation_id, (select auth.uid())));

-- messages SELECT, active members: unchanged text, but the helper is now
-- active-only (section 7).
--   messages_select_members: is_user_conversation_member((select auth.uid()), conversation_id)

-- messages SELECT, departed members: history up to the moment they left.
drop policy if exists messages_select_departed on public.messages;
create policy messages_select_departed on public.messages
  for select to authenticated
  using (created_at <= public.conversation_left_at((select auth.uid()), conversation_id));

-- messages INSERT: active members only.
alter policy messages_insert_members on public.messages
  with check ((sender_id = (select auth.uid())) and (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
      and cm.left_at is null)));

-- messages UPDATE / DELETE: own messages, and only while an active member.
-- live: (sender_id = (select auth.uid()))
alter policy messages_update_sender on public.messages
  using ((sender_id = (select auth.uid()))
         and public.is_user_conversation_member((select auth.uid()), conversation_id))
  with check ((sender_id = (select auth.uid()))
         and public.is_user_conversation_member((select auth.uid()), conversation_id));

alter policy messages_delete_sender on public.messages
  using ((sender_id = (select auth.uid()))
         and public.is_user_conversation_member((select auth.uid()), conversation_id));

-- message_reactions. Live has duplicate policy pairs (reactions_x and
-- reactions_x_user, identical). Both must change, or the old one still lets
-- the action through.
--   SELECT: active, or departed and the message is from before they left.
alter policy reactions_select on public.message_reactions
  using (exists (
    select 1 from public.conversation_members cm
    join public.messages m on m.conversation_id = cm.conversation_id
    where cm.user_id = (select auth.uid()) and m.id = message_reactions.message_id
      and (cm.left_at is null or m.created_at <= cm.left_at)));
alter policy reactions_select_user on public.message_reactions
  using (exists (
    select 1 from public.conversation_members cm
    join public.messages m on m.conversation_id = cm.conversation_id
    where cm.user_id = (select auth.uid()) and m.id = message_reactions.message_id
      and (cm.left_at is null or m.created_at <= cm.left_at)));

--   INSERT: active members only.
alter policy reactions_insert on public.message_reactions
  with check ((user_id = (select auth.uid())) and (exists (
    select 1 from public.conversation_members cm
    join public.messages m on m.conversation_id = cm.conversation_id
    where cm.user_id = (select auth.uid()) and m.id = message_reactions.message_id
      and cm.left_at is null)));
alter policy reactions_insert_user on public.message_reactions
  with check ((user_id = (select auth.uid())) and (exists (
    select 1 from public.conversation_members cm
    join public.messages m on m.conversation_id = cm.conversation_id
    where cm.user_id = (select auth.uid()) and m.id = message_reactions.message_id
      and cm.left_at is null)));

--   UPDATE / DELETE own reaction: active members only ("no react" for departed).
alter policy reactions_update on public.message_reactions
  using ((user_id = (select auth.uid())) and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_user_conversation_member((select auth.uid()), m.conversation_id)))
  with check ((user_id = (select auth.uid())) and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_user_conversation_member((select auth.uid()), m.conversation_id)));
alter policy reactions_delete on public.message_reactions
  using ((user_id = (select auth.uid())) and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_user_conversation_member((select auth.uid()), m.conversation_id)));
alter policy reactions_delete_user on public.message_reactions
  using ((user_id = (select auth.uid())) and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_user_conversation_member((select auth.uid()), m.conversation_id)));

-- Realtime topic + storage upload policies moved to
-- 20260923000001_trip_chat_realtime_storage_policies.sql: those tables are owned
-- by supabase_realtime_admin / supabase_storage_admin, and a failed ALTER there
-- must not roll back this whole migration.

-- user_activity: a departed member no longer sees trip mates' activity.
alter policy "Users can view conversation member activity" on public.user_activity
  using (exists (
    select 1 from public.conversation_members cm1
    join public.conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
    where cm1.user_id = auth.uid() and cm2.user_id = user_activity.user_id
      and cm1.left_at is null));


-- ---------------------------------------------------------------------------
-- 9. SECURITY DEFINER functions that bypass RLS and read membership
-- ---------------------------------------------------------------------------

-- search_messages: live body, plus one line. A departed member only finds
-- messages from before they left.
create or replace function public.search_messages(
  p_query text,
  p_conversation_id uuid default null::uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table(message_id uuid, conversation_id uuid, body text, message_created_at timestamp with time zone, sender_id uuid, sender_name text, sender_avatar_url text, conversation_is_direct boolean, conversation_name text)
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  SELECT
    m.id,
    m.conversation_id,
    m.body,
    m.created_at,
    m.sender_id,
    sp.name,
    sp.profile_image_url,
    c.is_direct,
    CASE WHEN c.is_direct THEN op.name ELSE c.title END AS conversation_name
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  JOIN public.conversation_members me
    ON me.conversation_id = m.conversation_id AND me.user_id = auth.uid()
  LEFT JOIN public.surfers sp ON sp.user_id = m.sender_id
  LEFT JOIN LATERAL (
    SELECT s.name
    FROM public.conversation_members om
    JOIN public.surfers s ON s.user_id = om.user_id
    WHERE om.conversation_id = c.id AND om.user_id <> auth.uid()
    LIMIT 1
  ) op ON c.is_direct
  WHERE m.deleted = false
    AND m.is_system = false
    AND m.body <> ''
    AND (me.left_at IS NULL OR m.created_at <= me.left_at)   -- departed: history only
    AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
    AND length(trim(p_query)) BETWEEN 2 AND 100
    AND m.body ILIKE '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

-- broadcast_message_change: live body, but inbox events go to ACTIVE members
-- only. Departed members stop getting "new message" pings.
create or replace function public.broadcast_message_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'realtime'
as $function$
declare
  v_conversation_id uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  v_event text := case TG_OP
                    when 'INSERT' then 'new_message'
                    when 'UPDATE' then 'update_message'
                    else 'delete_message' end;
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_member record;
begin
  -- 1) Full row to the open-chat topic
  begin
    perform realtime.send(
      jsonb_build_object('op', TG_OP, 'message', v_row),
      v_event,
      'messages:' || v_conversation_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_message_change conversation topic failed: %', sqlerrm;
  end;

  -- 2) Compact event to every ACTIVE member's inbox topic
  for v_member in
    select cm.user_id
    from public.conversation_members cm
    where cm.conversation_id = v_conversation_id
      and cm.left_at is null
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'conversation_id', v_conversation_id,
          'message_id', coalesce(NEW.id, OLD.id),
          'op', TG_OP
        ),
        'inbox_change',
        'user-inbox:' || v_member.user_id::text,
        true   -- private channel
      );
    exception when others then
      raise warning 'broadcast_message_change inbox topic failed for %: %', v_member.user_id, sqlerrm;
    end;
  end loop;

  return null; -- AFTER trigger: return value ignored
end;
$function$;


-- ---------------------------------------------------------------------------
-- 10. Grants
--
-- Supabase gives new public functions EXECUTE to anon + authenticated by
-- default, and PUBLIC always has it until revoked. Lock everything down, then
-- grant back only what the app calls directly or what RLS calls as the user.
-- The replaced functions get the same ACL they had live.
-- ---------------------------------------------------------------------------

-- Internal: triggers and sync only.
revoke all on function public._trip_chat_sync_on() from public, anon, authenticated;
revoke all on function public.trip_conversation_id(uuid) from public, anon, authenticated;
revoke all on function public.trip_chat_entitled(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recompute_trip_chat_member(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.sync_trip_chat_members(uuid) from public, anon, authenticated;
revoke all on function public.tg_sync_trip_chat_from_participant() from public, anon, authenticated;
revoke all on function public.tg_sync_trip_chat_from_staff() from public, anon, authenticated;
revoke all on function public.tg_sync_trip_chat_from_staff_role() from public, anon, authenticated;
revoke all on function public.tg_sync_trip_chat_from_trip_host() from public, anon, authenticated;
revoke all on function public.tg_sync_trip_chat_on_create() from public, anon, authenticated;
revoke all on function public.guard_conversation_member_write() from public, anon, authenticated;
revoke all on function public.broadcast_member_left_at_change() from public, anon, authenticated;
grant execute on function public._trip_chat_sync_on() to service_role;
grant execute on function public.trip_conversation_id(uuid) to service_role;
grant execute on function public.trip_chat_entitled(uuid, uuid) to service_role;
grant execute on function public.recompute_trip_chat_member(uuid, uuid, timestamptz) to service_role;
grant execute on function public.sync_trip_chat_members(uuid) to service_role;

-- The RPC.
revoke all on function public.ensure_trip_conversation(uuid) from public, anon;
grant execute on function public.ensure_trip_conversation(uuid) to authenticated, service_role;

-- RLS helpers (run as the signed-in user inside policies).
revoke all on function public.was_conversation_member(uuid, uuid) from public, anon;
revoke all on function public.conversation_left_at(uuid, uuid) from public, anon;
grant execute on function public.was_conversation_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.conversation_left_at(uuid, uuid) to authenticated, service_role;

-- Replaced functions: same ACL as live on 2026-09-23.
revoke all on function public.is_user_conversation_member(uuid, uuid) from public, anon;
revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_user_conversation_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_conversation_member(uuid) to authenticated, service_role;
revoke all on function public.is_conv_member_for_current_user(uuid) from public, anon, authenticated;
grant execute on function public.is_conv_member_for_current_user(uuid) to service_role;
revoke all on function public.search_messages(text, uuid, integer, integer) from public, anon;
grant execute on function public.search_messages(text, uuid, integer, integer) to authenticated, service_role;
revoke all on function public.broadcast_message_change() from public, anon, authenticated;
grant execute on function public.broadcast_message_change() to service_role;


-- ---------------------------------------------------------------------------
-- 11. Backfill (req 26)
--
-- Preview on 2026-09-23 (canonical chats of trips that still exist):
--   step 1 (left/removed travelers with a live row):      0 rows
--   step 2 departs (row but not entitled):                1 row
--     -> an 'onboarding' traveler on "Surf fun and love" who has a chat row
--        (test account d64eb3c7). Onboarding = no chat, so it goes read-only.
--   step 2 adds (entitled, no row):                        3 rows, all on
--     "El Salvador 26" (canonical chat 5c88d382, the oldest of its 3):
--        2 active travelers + the accepted co_operator (d64eb3c7).
--     The owner (ecaaa678) already has a row there. The 3rd crew entry is a
--     'listed' tier with no account, so it can never be in the chat.
--   Rows whose conversation_members row was already deleted get nothing back.
--   37 trip conversations whose trip was deleted, and the 2 El Salvador 26
--   duplicates, are not touched.
-- ---------------------------------------------------------------------------

do $backfill$
declare
  v_trip uuid;
begin
  perform set_config('app.trip_chat_sync', 'on', true);

  -- Step 1: operator-trip departures keep their real departure time.
  update public.conversation_members cm
     set left_at = coalesce(p.left_at, now())
    from public.group_trip_participants p
    join public.group_trips t on t.id = p.trip_id
   where p.status in ('left', 'removed')
     and cm.conversation_id = public.trip_conversation_id(t.id)
     and cm.user_id = p.user_id
     and cm.left_at is null
     and not public.trip_chat_entitled(t.id, p.user_id);

  -- Step 2: everything else, per trip. Adds missing hosts / travelers / chat
  -- staff, and sets left_at = now() on rows nobody is entitled to any more.
  for v_trip in
    select t.id from public.group_trips t
    where public.trip_conversation_id(t.id) is not null
  loop
    perform public.sync_trip_chat_members(v_trip);
  end loop;

  perform set_config('app.trip_chat_sync', 'off', true);
end
$backfill$;


-- ---------------------------------------------------------------------------
-- Checks to run AFTER apply (read-only)
-- ---------------------------------------------------------------------------
--
-- ACL: expect authenticated on the RPC + RLS helpers, and NO anon / PUBLIC
-- ("=X/" with an empty grantee) anywhere:
--   select p.proname, pg_get_function_identity_arguments(p.oid), p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in (
--     'ensure_trip_conversation','was_conversation_member','conversation_left_at',
--     'is_user_conversation_member','is_conversation_member','is_conv_member_for_current_user',
--     'search_messages','broadcast_message_change','_trip_chat_sync_on','trip_conversation_id',
--     'trip_chat_entitled','recompute_trip_chat_member','sync_trip_chat_members',
--     'tg_sync_trip_chat_from_participant','tg_sync_trip_chat_from_staff',
--     'tg_sync_trip_chat_from_staff_role','tg_sync_trip_chat_from_trip_host',
--     'tg_sync_trip_chat_on_create','guard_conversation_member_write',
--     'broadcast_member_left_at_change')
--   order by 1;
--
-- search_path pinned on every new/replaced function (proconfig not null):
--   select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like any (array['%trip_chat%','%conversation_member%',
--     'ensure_trip_conversation','conversation_left_at','trip_conversation_id','broadcast_member_left_at_change'])
--   and p.proconfig is null;   -- expect 0 rows
--
-- Policies now mention left_at / the new helpers:
--   select schemaname, tablename, policyname, qual, with_check from pg_policies
--   where policyname in ('conversations_select_members','conversations_update_admin_or_creator',
--     'conversation_members_select','messages_select_departed','messages_insert_members',
--     'messages_update_sender','messages_delete_sender','reactions_select','reactions_select_user',
--     'reactions_insert','reactions_insert_user','reactions_update','reactions_delete',
--     'reactions_delete_user','messaging: read conversation topic','messaging: write conversation topic',
--     'reactions: read conversation topic','Users can upload message images',
--     'Users can view conversation member activity');
--
-- El Salvador 26: every host, active traveler and chat staff is active in the
-- canonical chat (expect 0 rows):
--   select u.user_id from (
--     select host_id user_id, id trip_id from public.group_trips where title = 'El Salvador 26'
--     union select p.user_id, p.trip_id from public.group_trip_participants p
--       join public.group_trips t on t.id = p.trip_id and t.title = 'El Salvador 26'
--     union select s.user_id, s.trip_id from public.organized_trip_staff s
--       join public.group_trips t on t.id = s.trip_id and t.title = 'El Salvador 26'
--       where s.user_id is not null) u
--   where public.trip_chat_entitled(u.trip_id, u.user_id)
--     and not exists (select 1 from public.conversation_members cm
--       where cm.conversation_id = public.trip_conversation_id(u.trip_id)
--         and cm.user_id = u.user_id and cm.left_at is null);
--
-- Drift across all trips (expect 0 rows): entitled but not active, or active
-- but not entitled, in each canonical chat.
--   with tc as (select t.id trip_id, public.trip_conversation_id(t.id) conv from public.group_trips t)
--   select tc.trip_id, cm.user_id from tc join public.conversation_members cm on cm.conversation_id = tc.conv
--   where (cm.left_at is null) <> public.trip_chat_entitled(tc.trip_id, cm.user_id);
