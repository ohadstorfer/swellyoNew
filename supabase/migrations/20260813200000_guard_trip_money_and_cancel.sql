-- The price and the cancel switch live on a row anyone with `trip.edit` can
-- write.
--
-- Spec: docs/specs/operator-trips/staff-and-permissions.md — the matrix says
--       `money.manage` and `trip.cancel` are Operator-only.
--
-- ── The gap ────────────────────────────────────────────────────────────────
-- group_trips' UPDATE policy is `trip_staff_can(id, 'trip.edit')`, and a
-- Manager has trip.edit — correctly, because editing the trip is their job.
-- But `cost_per_person`, `deposit_amount`, `payment_mode`, the cancellation
-- terms and `status` are columns on that same row. RLS cannot say "this row,
-- except those columns", so every one of them was reachable by anyone who
-- could edit anything.
--
-- Nothing in the app or the dashboard does it — the price RPCs check host_id
-- and the buttons are hidden — but a signed-in Manager calling PostgREST
-- directly could set a trip's price to zero, flip it to offline payment,
-- rewrite the refund terms, or cancel the trip and fire the cancellation
-- notification to every traveler. The database is the boundary, so it has to
-- be the one that says no.
--
-- Found on 13 August while widening the operator dashboard to Managers. It is
-- older than that change and equally reachable from mobile.
--
-- ── Why a capability and not host_id ───────────────────────────────────────
-- The obvious guard is `auth.uid() = host_id`. It would work today and be
-- wrong tomorrow: the whole point of `organized_trip_staff_roles` is that the
-- sets are DATA, editable with an UPDATE. If money.manage is ever granted to a
-- tier, a host_id guard would refuse the person the matrix just allowed, and
-- the refusal would come from a trigger nobody remembered.
--
-- So it asks the same question every other gate asks. The operator of record
-- always passes: trip_staff_can() returns the full set for host_id from the
-- function itself, not from a row (invariant I1) — no config mistake can lock
-- an owner out of their own trip.

create or replace function public.guard_operator_trip_money()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_money_changed boolean;
begin
  -- Peer trips have no operator of record and no staff rows, and they DO have
  -- flat multi-host — several people with role = 'host', all of whom may edit
  -- everything today. Guarding them would be a behaviour change nobody asked
  -- for, on trips this permission model does not describe.
  if new.hosting_style is distinct from 'C' then
    return new;
  end if;

  -- No JWT: the service role, a cron job, or a migration. The Stripe webhook
  -- and the payments functions write here, and they are not the threat this
  -- guards against — they never carry a user's token in the first place.
  if auth.uid() is null then
    return new;
  end if;

  v_money_changed :=
       new.cost_per_person                  is distinct from old.cost_per_person
    or new.deposit_amount                   is distinct from old.deposit_amount
    or new.payment_mode                     is distinct from old.payment_mode
    or new.offline_payment_due_days_before  is distinct from old.offline_payment_due_days_before
    -- The refund terms are money: they decide what a traveler gets back after
    -- they have already paid, and they are frozen on the trip precisely so
    -- nobody can move them afterwards.
    or new.cancellation_preset              is distinct from old.cancellation_preset
    or new.cancellation_rules               is distinct from old.cancellation_rules
    or new.cancellation_notes               is distinct from old.cancellation_notes;

  -- `is distinct from`, not a column list on the trigger: an editor that PATCHes
  -- the whole row sends every column on every save, so a column-list trigger
  -- would fire on a title change and refuse it. Only a real change is a change.
  if v_money_changed and not public.trip_staff_can(old.id, 'money.manage') then
    raise exception
      'Only the operator of this trip can change its price, payment or cancellation terms'
      using errcode = '42501';
  end if;

  -- Cancellation only. Other status moves — published, completed — are not in
  -- the capability list and stay exactly as permissive as they are today;
  -- widening this trigger to cover them would be inventing a rule the matrix
  -- does not have. Cancelling is singled out because it is the one that
  -- notifies every traveler and cannot be taken back.
  if new.status is distinct from old.status
     and new.status = 'cancelled'
     and not public.trip_staff_can(old.id, 'trip.cancel') then
    raise exception 'Only the operator of this trip can cancel it'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.guard_operator_trip_money() is
  'Column-level permissions RLS cannot express: money.manage for price, payment '
  'and cancellation terms; trip.cancel for cancelling. group_trips UPDATE is '
  'trip.edit, which a Manager holds.';

drop trigger if exists trg_guard_operator_trip_money on public.group_trips;
create trigger trg_guard_operator_trip_money
  before update on public.group_trips
  for each row execute function public.guard_operator_trip_money();

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select tgname from pg_trigger where tgname = 'trg_guard_operator_trip_money';
--
-- As a Manager's JWT, against a 'C' trip — both must raise 42501:
--   update group_trips set cost_per_person = 1 where id = '<trip>';
--   update group_trips set status = 'cancelled' where id = '<trip>';
-- And this must still succeed:
--   update group_trips set title = title || '' where id = '<trip>';
