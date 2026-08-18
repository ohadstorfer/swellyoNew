-- Offline trips get a full-payment deadline of their own.
--
-- On a managed trip the deadline already lives on the `balance` requirement
-- row (`deadline_days_before`, resolved against start_date by
-- group_trip_requirements_resolved). An offline trip cannot use that row:
-- trg_pay_requires_managed_trip refuses pay rows unless the trip collects
-- money in Swellyo — deliberately, so a "Pay" button can never appear on a
-- trip Swellyo is not collecting for.
--
-- So the offline deadline is a trip column. Same philosophy as requirement
-- deadlines: stored relative to departure, resolved to a date only when read,
-- so moving the trip's dates keeps it correct with no backfill.
--
-- It is INFORMATIONAL. Nothing charges against it and nothing derives an
-- overdue state from it — travelers pay the operator outside the app, and the
-- app's whole job here is to say "the full amount, to the operator, by then".
--
-- NOT coupled to payment_mode by a CHECK: a managed trip that flips to
-- offline keeps whatever value was set, and the readers only look at the
-- column when payment_mode = 'offline'. A stale value on a managed trip is
-- unread, not wrong.

alter table public.group_trips
  add column if not exists offline_payment_due_days_before integer;

alter table public.group_trips
  drop constraint if exists group_trips_offline_due_non_negative;
alter table public.group_trips
  add constraint group_trips_offline_due_non_negative
  check (
    offline_payment_due_days_before is null
    or offline_payment_due_days_before >= 0
  );
