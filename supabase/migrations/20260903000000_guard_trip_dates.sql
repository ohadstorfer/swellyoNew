-- The trip's dates live on a row anyone with `trip.edit` can write.
--
-- Product Specs §5c, decided 23 August 2026: a Manager may edit anything on an
-- operator trip "besides dates & destinations". Since then the app has said so
-- — OperatorTripEditScreen shows "Where" and "When" greyed out with the value
-- "Operator only" — but only the app said so. The comment on that gate called
-- itself "a fence, not a wall", and it was right about one half.
--
-- ── What was already a wall ────────────────────────────────────────────────
-- WHERE. The destination is not a column on group_trips; it is a row in
-- group_trip_destinations, whose INSERT / UPDATE / DELETE policies are all
-- literal `auth.uid() = host_id`. A Manager could never move a trip in space,
-- with or without this migration. Nothing here touches that table.
--
-- ── What was not ───────────────────────────────────────────────────────────
-- WHEN. `start_date` and `end_date` are columns on group_trips, whose UPDATE
-- policy is `trip_staff_can(id, 'trip.edit')` — which a Manager holds, and
-- correctly, because editing the trip is their job. RLS cannot say "this row,
-- except those two columns". So a signed-in Manager calling PostgREST directly
-- could move a trip travellers had booked flights around, and
-- trg_notify_trip_dates_changed would then mail all of them about it in the
-- Manager's name. Same shape as the price hole found on 13 August
-- (20260813200000_guard_trip_money_and_cancel), same fix.
--
-- ── Why host_id here, and not a capability ─────────────────────────────────
-- The money guard argues for asking `trip_staff_can()` rather than comparing
-- to host_id, because the permission sets are DATA and a host_id guard would
-- one day refuse someone the matrix had just allowed. That argument is right,
-- and it does not apply yet: there is no `trip.reschedule` capability, and
-- inventing one whose only holder is the person the OTHER half of this rule
-- (the destination policies) already hardcodes would leave the two halves of
-- "dates & destinations" answering to different authorities. So this matches
-- what group_trip_destinations already does — the creator, and nobody else —
-- and the app's existing `isOwner` gate needs no change.
--
-- If moving the dates ever becomes something a co-operator should do, the
-- honest change is a capability on BOTH halves: add the key, grant it, and
-- swap the two comparisons below and the four policies on
-- group_trip_destinations together. Not one of them alone.

create or replace function public.guard_operator_trip_dates()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  -- Peer trips have no operator of record and DO have flat multi-host: several
  -- people with role = 'host', every one of whom may move the dates today.
  -- Guarding them would be a behaviour change nobody asked for, on trips this
  -- permission model does not describe.
  if new.hosting_style is distinct from 'C' then
    return new;
  end if;

  -- No JWT: the service role, a cron job, or a migration. Nothing writes dates
  -- that way today, and if something ever does it is not the threat this
  -- guards against — it never carries a user's token in the first place.
  if auth.uid() is null then
    return new;
  end if;

  -- `is distinct from`, not a column list on the trigger: an editor that
  -- PATCHes the whole row sends every column on every save, so a column-list
  -- trigger would fire on a title change and refuse it. Only a real change is
  -- a change. (The dates sheet sends the two dates alone, but the guard should
  -- not depend on that staying true.)
  if (new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date)
     and auth.uid() is distinct from old.host_id then
    raise exception 'Only the operator of this trip can change its dates'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.guard_operator_trip_dates() is
  'Column-level permission RLS cannot express: only group_trips.host_id may '
  'move start_date / end_date on an operator trip. group_trips UPDATE is '
  'trip.edit, which a Manager holds. The other half of the same rule — the '
  'destination — is already host_id in the group_trip_destinations policies.';

-- A trigger function is not callable over PostgREST, but the house rule is that
-- nothing new is left executable by anon/authenticated — get_advisors flags it,
-- and guard_primary_trip_host is already revoked this way. (guard_operator_trip_money
-- from 20260813200000 was missed and is still open; harmless, but worth tidying.)
revoke execute on function public.guard_operator_trip_dates() from public, anon, authenticated;

drop trigger if exists trg_guard_operator_trip_dates on public.group_trips;
create trigger trg_guard_operator_trip_dates
  before update on public.group_trips
  for each row execute function public.guard_operator_trip_dates();

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select tgname from pg_trigger where tgname = 'trg_guard_operator_trip_dates';
--
-- Inside `begin; … rollback;`, with a Manager's claims set on the session:
--   set_config('request.jwt.claims', '{"sub":"<manager>","role":"authenticated"}', true)
-- against a hosting_style='C' trip — this must raise 42501:
--   update group_trips set start_date = start_date + 1 where id = '<trip>';
-- and these must both still succeed:
--   update group_trips set title = title where id = '<trip>';          -- no-op dates
--   update group_trips set description = description || '' where id = '<trip>';
-- As the operator of record, the first one must succeed too.
