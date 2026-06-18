-- WS2 — split the single 'trips-list' realtime firehose into scoped topics.
-- APPLIED TO PROD 2026-06-17 via MCP apply_migration (reconciled from the LIVE
-- broadcast_trip_change definition, not the repo base, to avoid drift). This file is the
-- canonical record of that change; it fully replaces the function, so it is correct to apply
-- on top of any base.
--
-- Changes vs the prior live trigger:
--   1) 'trips-list' (Explore feed) now fires ONLY on catalogue-altering group_trips events
--      (INSERT / DELETE / status change) — no longer on every participant join/leave, which
--      was the "refresh every viewer on any action" firehose.
--   2) NEW per-member fan-out to private 'trips-mine:{user_id}' topics for trip + participant
--      changes, so a member's My Trips list refreshes without pinging everyone on the app.
--      (Decision 2026-06-17: gear/commitment changes intentionally do NOT fan out to trips-mine —
--       they still live-update the open trip detail screen via the per-trip topic.)
-- Everything else (trip:{id}, user-trips:{requester}) preserved verbatim.
-- Group trips are dev-only on prod, so this only affects dev experience until the client ships.

BEGIN;

CREATE OR REPLACE FUNCTION public.broadcast_trip_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime', 'pg_temp'
AS $function$
declare
  v_trip_id uuid;
  v_requester uuid;
  v_payload jsonb;
  v_member record;
begin
  if TG_TABLE_NAME = 'group_trips' then
    v_trip_id := coalesce(NEW.id, OLD.id);
  else
    v_trip_id := coalesce(NEW.trip_id, OLD.trip_id);
  end if;
  if v_trip_id is null then
    return null;
  end if;

  v_payload := jsonb_build_object('op', TG_OP, 'table', TG_TABLE_NAME);

  -- Per-trip topic (open trip detail screens) — unchanged.
  begin
    perform realtime.send(v_payload, 'trip_changed', 'trip:' || v_trip_id::text, true);
  exception when others then
    raise warning 'broadcast_trip_change trip topic failed for %: %', v_trip_id, sqlerrm;
  end;

  -- Explore list topic: ONLY catalogue-altering group_trips events, not participant churn.
  if TG_TABLE_NAME = 'group_trips'
     and (TG_OP = 'INSERT'
          or TG_OP = 'DELETE'
          or (TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status)) then
    begin
      perform realtime.send(v_payload, 'trips_list_changed', 'trips-list', true);
    exception when others then
      raise warning 'broadcast_trip_change list topic failed for %: %', v_trip_id, sqlerrm;
    end;
  end if;

  -- Per-member "your trips changed" fan-out → each member's private trips-mine topic.
  if TG_TABLE_NAME in ('group_trips', 'group_trip_participants') then
    begin
      for v_member in
        select user_id from public.group_trip_participants where trip_id = v_trip_id
      loop
        perform realtime.send(
          v_payload,
          'trips_mine_changed',
          'trips-mine:' || v_member.user_id::text,
          true
        );
      end loop;
    exception when others then
      raise warning 'broadcast_trip_change mine fan-out failed for %: %', v_trip_id, sqlerrm;
    end;
  end if;

  -- Join-request topic — unchanged.
  if TG_TABLE_NAME = 'group_trip_join_requests' then
    v_requester := coalesce(NEW.requester_id, OLD.requester_id);
    if v_requester is not null then
      begin
        perform realtime.send(
          jsonb_build_object('op', TG_OP, 'request',
            case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end),
          'join_request_changed',
          'user-trips:' || v_requester::text,
          true
        );
      exception when others then
        raise warning 'broadcast_trip_change requester topic failed for %: %', v_requester, sqlerrm;
      end;
    end if;
  end if;

  return null;
end;
$function$;

-- Allow each user to subscribe to their own trips-mine topic (owner-only). Additive clause.
ALTER POLICY "trips: read trip topics" ON realtime.messages
USING (
  (realtime.topic() = 'trips-list'::text)
  OR (realtime.topic() ~~ 'trip:%'::text)
  OR (realtime.topic() = ('user-trips:'::text || (auth.uid())::text))
  OR (realtime.topic() = ('trips-mine:'::text || (auth.uid())::text))
);

COMMIT;
