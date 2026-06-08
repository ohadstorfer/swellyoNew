-- ============================================================================
-- FIX B1: notification snapshots missing `trip_title`
-- ----------------------------------------------------------------------------
-- Several notification trigger functions built their `data` jsonb snapshot
-- WITHOUT `trip_title`. The client renderer
-- (src/services/notifications/notificationsService.ts → renderNotification)
-- falls back to the generic "the trip" whenever `data.trip_title` is absent, so
-- users never saw the real trip name for those notification types.
--
-- This migration redefines ONLY the affected trigger functions via
-- CREATE OR REPLACE FUNCTION, preserving every other line of their existing
-- logic exactly (recipient fan-out, audience, exclusions, return value). The
-- ONLY behavioral change is adding `trip_title` to each `jsonb_build_object`,
-- sourced from public.group_trips.title via the trip-id variable already in
-- scope in each function.
--
-- ⚠️ Migrations are applied MANUALLY via the Supabase SQL editor. The original
--    migration (20260601010000_notification_center.sql) is ALREADY APPLIED to
--    prod and must NOT be edited in place. Apply THIS file manually in the SQL
--    editor to push the fix.
-- ============================================================================

-- 5.6  join_request_received  — admin gets a join request (Approve / Deny / View profile)
create or replace function public.tg_notify_join_request_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.requester_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'join_request_received', 'admin', new.requester_id, 'join_request', new.id,
         jsonb_build_object('actor_name', v_name, 'note', new.request_note,
                            'trip_title', (select title from public.group_trips where id = new.trip_id))
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.requester_id;
  return new;
end $$;

-- 5.6b  join_request_decided  — requester is told approved/declined.
create or replace function public.tg_notify_join_request_decided()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.requester_id, new.trip_id, 'join_request_decided', 'user', new.reviewed_by, 'join_request', new.id,
            jsonb_build_object('decision', new.status,
                               'trip_title', (select title from public.group_trips where id = new.trip_id)));
  end if;
  return new;
end $$;

-- 5.7  gear_request_received  — admin gets a gear request (View / set qty / Approve / Deny)
create or replace function public.tg_notify_gear_request_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.requester_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'gear_request_received', 'admin', new.requester_id, 'gear_request', new.id,
         jsonb_build_object('actor_name', v_name, 'item_name', new.item_name, 'note', new.note,
                            'trip_title', (select title from public.group_trips where id = new.trip_id))
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.requester_id;
  return new;
end $$;

-- 5.9  commitment_request_received  — admin gets a commitment request (Open chat)
create or replace function public.tg_notify_commitment_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'commitment_request_received', 'admin', new.user_id, 'commitment_request', new.id,
         jsonb_build_object('actor_name', v_name,
                            'trip_title', (select title from public.group_trips where id = new.trip_id))
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.user_id;
  return new;
end $$;

-- ============================================================================
-- End B1 fix
-- ============================================================================
