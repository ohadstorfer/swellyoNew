-- Realtime coverage for surftrip group chats + server-owned system banners.
--
-- Context:
--   "X joined / X left the group" banners were posted from the actor's
--   client right after the membership mutation. When the actor lost network
--   or backgrounded the app between the mutation and the message insert,
--   the banner silently never landed. Other surftrip state (group metadata,
--   pending join requests, role changes) also wasn't published to realtime,
--   so members had to remount the detail screen to see changes.
--
--   This migration:
--     1) Publishes surftrip_groups, surftrip_group_members and
--        surftrip_join_requests on the supabase_realtime publication.
--     2) Moves the "X joined / X left" banner emission to AFTER triggers on
--        surftrip_group_members so the banner is atomic with the membership
--        change and immune to actor-client drop-offs.
--
-- Safety: idempotent — table-publish blocks are guarded with
--   pg_publication_tables, trigger creation uses `drop trigger if exists`.
--
-- Deployment: per project convention, run this in the Supabase dashboard SQL
--   editor. After it lands, the client-side postSystemMessage calls in
--   surftripsService.ts can be removed (separate change).

-- ============================================================================
-- 1) Realtime publication
-- ============================================================================
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'surftrip_groups'
  ) then
    raise notice 'Realtime already enabled for surftrip_groups';
  else
    alter publication supabase_realtime add table public.surftrip_groups;
    raise notice 'Realtime enabled for surftrip_groups';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'surftrip_group_members'
  ) then
    raise notice 'Realtime already enabled for surftrip_group_members';
  else
    alter publication supabase_realtime add table public.surftrip_group_members;
    raise notice 'Realtime enabled for surftrip_group_members';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'surftrip_join_requests'
  ) then
    raise notice 'Realtime already enabled for surftrip_join_requests';
  else
    alter publication supabase_realtime add table public.surftrip_join_requests;
    raise notice 'Realtime enabled for surftrip_join_requests';
  end if;
end $$;

-- Make sure REPLICA IDENTITY is FULL so UPDATE / DELETE payloads include the
-- old row — needed for role-change detection and to surface the leaving
-- user's id on a DELETE.
alter table public.surftrip_group_members replica identity full;
alter table public.surftrip_join_requests  replica identity full;
alter table public.surftrip_groups         replica identity full;

-- ============================================================================
-- 2) Server-owned "joined" / "left" system banners
-- ============================================================================
-- Insert into messages with is_system=true and sender_id set to the joining /
-- leaving user. SECURITY DEFINER lets the trigger bypass the messages INSERT
-- RLS check (which would otherwise require sender_id = auth.uid()).
--
-- Skip the banner when:
--   - The inserted row is the host on group creation (role = 'host'). The
--     host is only ever inserted with role='host' by create_surftrip_group,
--     never by a join flow, so this cleanly filters group-creation noise.
--   - The user's surfer profile is missing — we don't want "User joined the
--     group" as a fallback; without a real name, just emit nothing.
--   - The linked surftrip_group or conversation no longer exists, which
--     covers the case where the group itself is being deleted and the
--     member rows are cascading away.

create or replace function public.handle_surftrip_member_joined_banner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_name text;
begin
  if new.role = 'host' then
    return new;
  end if;

  select conversation_id into v_conversation_id
    from public.surftrip_groups
    where id = new.group_id;

  if v_conversation_id is null then
    return new;
  end if;

  select trim(name) into v_name
    from public.surfers
    where user_id = new.user_id;

  if v_name is null or length(v_name) = 0 then
    return new;
  end if;

  insert into public.messages (
    conversation_id, sender_id, body, type, is_system, attachments
  ) values (
    v_conversation_id, new.user_id, v_name || ' joined the group', 'text', true, '[]'::jsonb
  );

  update public.conversations
    set updated_at = now()
    where id = v_conversation_id;

  return new;
end;
$$;

create or replace function public.handle_surftrip_member_left_banner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_name text;
begin
  select conversation_id into v_conversation_id
    from public.surftrip_groups
    where id = old.group_id;

  if v_conversation_id is null then
    -- Group is being deleted: skip per-member banner storm.
    return old;
  end if;

  select trim(name) into v_name
    from public.surfers
    where user_id = old.user_id;

  if v_name is null or length(v_name) = 0 then
    return old;
  end if;

  insert into public.messages (
    conversation_id, sender_id, body, type, is_system, attachments
  ) values (
    v_conversation_id, old.user_id, v_name || ' left the group', 'text', true, '[]'::jsonb
  );

  update public.conversations
    set updated_at = now()
    where id = v_conversation_id;

  return old;
end;
$$;

drop trigger if exists trg_surftrip_member_joined_banner on public.surftrip_group_members;
create trigger trg_surftrip_member_joined_banner
  after insert on public.surftrip_group_members
  for each row execute function public.handle_surftrip_member_joined_banner();

drop trigger if exists trg_surftrip_member_left_banner on public.surftrip_group_members;
create trigger trg_surftrip_member_left_banner
  after delete on public.surftrip_group_members
  for each row execute function public.handle_surftrip_member_left_banner();

-- ============================================================================
-- Verify
-- ============================================================================
select schemaname, tablename
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename in ('surftrip_groups', 'surftrip_group_members', 'surftrip_join_requests')
  order by tablename;
