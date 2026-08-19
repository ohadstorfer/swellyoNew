-- Who cancelled this trip, when, and why.
--
-- Cancelling has been a single column write (`status = 'cancelled'`) since
-- 20260430000000. That is enough to hide the trip and fire the notification
-- trigger, but it leaves no answer to the only three questions anyone asks
-- afterwards — and they are always asked after money has already moved.
--
-- ⚠️ NAMING. The `cancellation_*` columns already on this table
-- (`cancellation_preset` / `_rules` / `_notes`, added 20260811000100) are the
-- refund POLICY — the terms a traveler agreed to at checkout. These new columns
-- use a `cancelled_*` prefix instead, and mean the cancellation EVENT. Two
-- different things one letter apart, so the prefix is the whole distinction:
--
--   cancellation_*  → the terms      (set at publish, frozen, shown to travelers)
--   cancelled_*     → what happened  (set once, when the operator pulls the trip)
--
-- Do not add `cancellation_reason`. It would sit next to `cancellation_notes`,
-- which is policy prose, and the two would be indistinguishable at a call site.

alter table public.group_trips
  add column if not exists cancelled_at timestamptz,
  -- `set null`, not `cascade`: a deleted operator account must not delete the
  -- trips they cancelled. The audit trail outlives the actor.
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_reason text;

comment on column public.group_trips.cancelled_at is
  'When the trip was cancelled. NULL for every trip that is not cancelled, and also for trips cancelled before 2026-08-19 — this was never recorded until then, so it is not backfillable.';
comment on column public.group_trips.cancelled_by is
  'Who pressed cancel. Only the operator of record can (trip.cancel capability, enforced by trg_guard_trip_money_and_cancel), so this is the operator on every row today — but it is recorded rather than inferred, because staff tiers are data and that may not stay true.';
comment on column public.group_trips.cancelled_reason is
  'Free text the operator typed when cancelling. NOT the cancellation policy — see cancellation_notes for that.';

-- Only 'cancelled' rows may carry the stamp, and a cancelled row written by the
-- new flow must carry it. Deliberately NOT `cancelled_at is not null` for every
-- cancelled trip: rows cancelled before this migration have no timestamp and
-- never will, and a constraint that makes historical rows unupdatable would
-- break the next edit anyone makes to one.
alter table public.group_trips
  drop constraint if exists group_trips_cancelled_stamp_matches_status;
alter table public.group_trips
  add constraint group_trips_cancelled_stamp_matches_status
  check (
    status = 'cancelled'
    or (cancelled_at is null and cancelled_by is null and cancelled_reason is null)
  );

-- The refund batch in `trip-cancel` resumes by re-reading its own trip row, so
-- the only lookup that needs to be fast is by id, which is the primary key.
-- No index is added on purpose.
