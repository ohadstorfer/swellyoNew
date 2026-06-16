-- ============================================================================
-- Member-only broadcasts for "someone joined" (#11) and "someone committed" (#12)
--
-- The notifications spec colour-codes these two as MEMBER-ONLY (blue): the admin
-- already approved the join / commit (they got the action notification + the
-- decision), so re-broadcasting "X joined" / "X committed" to the admin is
-- redundant. The HTML plan agrees — 2.8 sends "commit approved" to
-- "the member + all OTHER members", not the host.
--
-- These two triggers previously fanned out to EVERY participant except the actor
-- (tagging each row admin/user by role), which delivered the broadcast to the
-- host/admins too. This migration redefines both so the broadcast reaches
-- members only (host + role='admin' excluded). All rows are audience='user'.
--
-- Idempotent CREATE OR REPLACE — apply by hand in the SQL editor (no db push).
-- Supersedes the bodies in 20260601010000_notification_center.sql (5.1, 5.10).
-- ============================================================================

-- 5.1  member_joined — someone joins; notify MEMBERS only (skip the host's own
--      seed row, the joiner, and every admin/host recipient).
create or replace function public.tg_notify_member_joined()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_title text; v_name text;
begin
  select host_id, title into v_host, v_title from public.group_trips where id = new.trip_id;
  if new.user_id = v_host or new.role = 'host' then
    return new;  -- host creating the trip is not a "joined" event
  end if;
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'member_joined', 'user',
         new.user_id, 'participant', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
  from public.group_trip_participants p
  where p.trip_id = new.trip_id
    and p.user_id <> new.user_id          -- not the joiner
    and p.user_id <> v_host               -- not the host
    and coalesce(p.role, 'member') = 'member';  -- members only (no admins)
  return new;
end $$;

-- 5.10  commitment_decided (+ member_committed broadcast on approval).
--       The requester still gets commitment_decided (unchanged); the
--       "Johnny committed" broadcast now reaches MEMBERS only.
create or replace function public.tg_notify_commitment_decided()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_host uuid; v_name text; v_approved boolean;
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then

    -- tell the requester the outcome (unchanged)
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.user_id, new.trip_id, 'commitment_decided', 'user', new.decided_by, 'commitment_request', new.id,
            jsonb_build_object('decision', new.status));

    v_approved := new.status = 'approved';
    if v_approved then
      select title, host_id into v_title, v_host from public.group_trips where id = new.trip_id;
      v_name := public.user_display_name(new.user_id);
      -- broadcast "Johnny committed" to MEMBERS only (host + admins excluded —
      -- the host approved it and already knows).
      insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select p.user_id, new.trip_id, 'member_committed', 'user',
             new.user_id, 'commitment_request', new.id,
             jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
      from public.group_trip_participants p
      where p.trip_id = new.trip_id
        and p.user_id <> new.user_id        -- not the committer
        and p.user_id <> v_host             -- not the host
        and coalesce(p.role, 'member') = 'member';  -- members only (no admins)
    end if;
  end if;
  return new;
end $$;

-- Triggers themselves are unchanged (still bound to the same tables/events);
-- CREATE OR REPLACE on the functions is enough.
