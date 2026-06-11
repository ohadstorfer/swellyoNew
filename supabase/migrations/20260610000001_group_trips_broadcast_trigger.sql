-- Group trips realtime: Broadcast from the database (postgres_changes -> Broadcast,
-- same pattern as 20260605 messaging / 20260606 reactions triggers).
--
-- SUPERSEDES the postgres_changes approach applied earlier the same day
-- (group_trips_realtime_publication.sql + gear_claims_trip_id_realtime.sql):
-- those publication entries are removed again below. The gear_claims.trip_id
-- column + autofill trigger from that work REMAIN — this trigger relies on it.
--
-- One AFTER trigger on all 8 group_trip tables broadcasts to PRIVATE topics:
--   1. trip:{trip_id}        -> {op, table}, for whoever has that trip's page open
--   2. trips-list            -> {op, table}, for whoever is on the Trips screen
--                               (only trips + participants changes feed it)
--   3. user-trips:{requester}-> full join-request row, for the requester's
--                               join-decision overlay (replaces the per-user
--                               postgres_changes listener every client held open)
--
-- Payloads are invalidation pings — clients refetch through normal RLS-filtered
-- queries, so no privileged data rides the broadcast. Topic authorization is
-- evaluated ONCE per subscription, not per event per subscriber: that is the
-- scale win over postgres_changes.
--
-- INERT until clients subscribe. SAFETY: SECURITY DEFINER with PINNED
-- search_path + fully-qualified tables (per the signup-trigger incident); every
-- realtime.send wrapped so a broadcast failure can NEVER abort the write.

create or replace function public.broadcast_trip_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  v_trip_id uuid;
  v_requester uuid;
  v_payload jsonb;
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

  -- 1) Per-trip topic: open TripDetailScreens invalidate the matching queries.
  begin
    perform realtime.send(
      v_payload,
      'trip_changed',
      'trip:' || v_trip_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_trip_change trip topic failed for %: %', v_trip_id, sqlerrm;
  end;

  -- 2) List topic: only changes that alter what the Explore / My Trips cards
  --    show (trip fields, member counts).
  if TG_TABLE_NAME in ('group_trips', 'group_trip_participants') then
    begin
      perform realtime.send(
        v_payload,
        'trips_list_changed',
        'trips-list',
        true   -- private channel
      );
    exception when others then
      raise warning 'broadcast_trip_change list topic failed for %: %', v_trip_id, sqlerrm;
    end;
  end if;

  -- 3) Requester topic: the join-decision overlay needs the row itself
  --    (status, seen_decision_at, reviewed_at), sent only to the requester —
  --    it is their own request.
  if TG_TABLE_NAME = 'group_trip_join_requests' then
    v_requester := coalesce(NEW.requester_id, OLD.requester_id);
    if v_requester is not null then
      begin
        perform realtime.send(
          jsonb_build_object(
            'op', TG_OP,
            'request', case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end
          ),
          'join_request_changed',
          'user-trips:' || v_requester::text,
          true   -- private channel
        );
      exception when others then
        raise warning 'broadcast_trip_change requester topic failed for %: %', v_requester, sqlerrm;
      end;
    end if;
  end if;

  return null; -- AFTER trigger: return value ignored
end;
$$;

-- Trigger-only function: not callable via PostgREST (/rest/v1/rpc/...).
revoke execute on function public.broadcast_trip_change() from public, anon, authenticated;

drop trigger if exists trg_broadcast_trip_change on public.group_trips;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trips
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_participants;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_participants
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_join_requests;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_join_requests
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_admin_updates;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_admin_updates
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_commitment_requests;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_commitment_requests
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_gear_items;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_gear_items
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_gear_claims;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_gear_claims
for each row execute function public.broadcast_trip_change();

drop trigger if exists trg_broadcast_trip_change on public.group_trip_gear_requests;
create trigger trg_broadcast_trip_change
after insert or update or delete on public.group_trip_gear_requests
for each row execute function public.broadcast_trip_change();

-- ---------------------------------------------------------------------------
-- Realtime Authorization: who may SUBSCRIBE to these private topics.
-- All group trips are browsable by any authenticated user (same as the tables'
-- SELECT policies), so trip:% and trips-list are open to authenticated;
-- user-trips:{id} only to its owner.
-- ---------------------------------------------------------------------------

alter table realtime.messages enable row level security;

drop policy if exists "trips: read trip topics" on realtime.messages;
create policy "trips: read trip topics"
on realtime.messages for select to authenticated
using (
  realtime.topic() = 'trips-list'
  or realtime.topic() like 'trip:%'
  or realtime.topic() = 'user-trips:' || auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- Undo the postgres_changes plumbing from earlier today, now superseded.
-- group_trip_join_requests STAYS published: the join-decisions
-- postgres_changes listener on main is live on prod (web + shipped mobile
-- builds) and needs it until the broadcast client is deployed everywhere.
-- Drop it then (tracked as post-ship cleanup).
-- ---------------------------------------------------------------------------

alter publication supabase_realtime drop table
  public.group_trips,
  public.group_trip_participants,
  public.group_trip_admin_updates,
  public.group_trip_commitment_requests,
  public.group_trip_gear_items,
  public.group_trip_gear_claims,
  public.group_trip_gear_requests;

-- Broadcast triggers see the full OLD row natively; FULL only bloated the WAL.
alter table public.group_trip_participants replica identity default;
alter table public.group_trip_admin_updates replica identity default;
alter table public.group_trip_gear_items replica identity default;
alter table public.group_trip_gear_claims replica identity default;
alter table public.group_trip_gear_requests replica identity default;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run if you need to fully remove this):
--   drop trigger if exists trg_broadcast_trip_change on public.group_trips;
--   ... (repeat for the other 7 tables)
--   drop function if exists public.broadcast_trip_change();
--   drop policy if exists "trips: read trip topics" on realtime.messages;
--   -- and re-add the tables to the publication if reverting to postgres_changes.
-- ---------------------------------------------------------------------------
