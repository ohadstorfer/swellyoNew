-- Bug: when a user leaves a group trip (or the host removes them), their row in
-- public.group_trip_participants is hard-deleted — but their gear claims in
-- public.group_trip_gear_claims and their still-pending rows in
-- public.group_trip_gear_requests were left behind as orphans.
--
-- Consequence: the quantity those claims reserved on each gear item stayed
-- "taken" forever, so the freed quantity never became claimable again by the
-- remaining participants. Pending gear requests from the departed user also
-- lingered in the host's review queue.
--
-- Fix: an AFTER DELETE trigger on group_trip_participants that, for the deleted
-- participant + trip, removes that user's claims (scoped to gear items of that
-- trip) and deletes their pending gear requests for that trip.
--
-- Why SECURITY DEFINER: the cleanup must delete rows owned by the *departing*
-- user, but the actor firing the DELETE is often someone else (the host
-- removing a participant). Under self-only RLS on group_trip_gear_claims /
-- group_trip_gear_requests, the host cannot delete another user's rows, so the
-- cleanup would be silently narrowed to nothing. Even the leaving user's own
-- delete path is fragile (depends on the exact RLS predicate and on the FE
-- issuing the right deletes). Running as SECURITY DEFINER with a pinned
-- search_path = public makes the function execute as its owner and bypass RLS,
-- guaranteeing the orphans are always cleaned up regardless of who triggered
-- the leave/remove. (search_path is pinned per the signup-trigger hardening
-- lesson, required for all SECURITY DEFINER functions.)

create or replace function public.cleanup_gear_claims_on_participant_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Drop the departing user's gear claims for items belonging to this trip,
  -- freeing the reserved quantity so it becomes claimable again.
  delete from group_trip_gear_claims c
   where c.user_id = old.user_id
     and c.item_id in (
       select id
         from group_trip_gear_items
        where trip_id = old.trip_id
     );

  -- Clean up the departing user's still-pending gear requests for this trip.
  delete from group_trip_gear_requests
   where requester_id = old.user_id
     and trip_id = old.trip_id
     and status = 'pending';

  return old;
end;
$$;

drop trigger if exists trg_cleanup_gear_claims_on_participant_delete
  on public.group_trip_participants;

create trigger trg_cleanup_gear_claims_on_participant_delete
  after delete on public.group_trip_participants
  for each row
  execute function public.cleanup_gear_claims_on_participant_delete();
