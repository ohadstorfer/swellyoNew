-- Fix: deleting (or inserting/updating) rows in trip child tables that have NO
-- `status` column — e.g. group_trip_gear_items — failed with:
--     record "new" has no field "status"
--
-- Cause: broadcast_trip_change() is shared across 8 trip tables. Its Explore-list
-- block referenced NEW.status / OLD.status in the SAME boolean expression as the
-- `TG_TABLE_NAME = 'group_trips'` guard:
--
--     if TG_TABLE_NAME = 'group_trips'
--        and (... NEW.status is distinct from OLD.status) then
--
-- PL/pgSQL must resolve NEW.status against the firing table's rowtype when it
-- parses that expression. For tables without a `status` column (gear_items,
-- participants, gear_claims, join_requests, …) the reference is invalid and the
-- whole DML aborts.
--
-- Fix: NEST the status check inside the `TG_TABLE_NAME = 'group_trips'` guard, so
-- the inner expression (the only place NEW.status appears) is parsed/evaluated
-- ONLY for group_trips, where the column exists. Everything else is a faithful
-- copy of the live function (downloaded 2026-06-17).

create or replace function public.broadcast_trip_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'realtime', 'pg_temp'
as $function$
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
  -- NOTE: the NEW.status / OLD.status reference MUST stay nested inside this
  -- TG_TABLE_NAME = 'group_trips' guard. PL/pgSQL only parses the inner expression
  -- when this block is entered, so the status-less child tables never resolve
  -- NEW.status. A flat "TG_TABLE_NAME='group_trips' AND (... NEW.status ...)"
  -- condition fails on them with: record "new" has no field "status".
  if TG_TABLE_NAME = 'group_trips' then
    if TG_OP = 'INSERT'
       or TG_OP = 'DELETE'
       or (TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status) then
      begin
        perform realtime.send(v_payload, 'trips_list_changed', 'trips-list', true);
      exception when others then
        raise warning 'broadcast_trip_change list topic failed for %: %', v_trip_id, sqlerrm;
      end;
    end if;
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

-- VERIFY (after applying): deleting a group_trip_gear_items row should succeed.
-- ROLLBACK is just re-applying the previous (flat-condition) definition.
