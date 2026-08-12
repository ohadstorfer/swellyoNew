-- Refunds: our own intent + audit record.
--
-- Phase 2a of docs/specs/operator-trips/refunds-and-merchant-of-record.md.
--
-- WHY A SEPARATE TABLE FROM organized_trip_payment_events.
-- That table is a MIRROR OF STRIPE — one row per webhook event, written only by
-- `stripe-webhook`, describing something that already happened. This table is
-- the opposite: it records what WE decided, before Stripe is called at all.
-- Overloading the mirror would lose exactly the rows that matter most in a
-- dispute — the attempts that never became a Stripe object:
--   • a refund blocked by the balance guardrail (the operator TRIED),
--   • a refund that failed at Stripe,
--   • who pressed the button, and what the policy said at that moment.
--
-- The two are linked by `payment_event_id`. A successful refund therefore ends
-- up recorded TWICE and that is intentional: our row (intent, actor, reason)
-- and Stripe's row (money moved). They answer different questions.
--
-- ⚠️ NO 'refunded' ROW IS WRITTEN HERE. `stripe-webhook` already handles
-- `charge.refunded` with cumulative-delta maths (amount_refunded is cumulative
-- across every refund on a charge, so a second partial refund double-counts if
-- you do not diff). Writing one here too would double-count the money.

create table if not exists public.organized_trip_refunds (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.group_trips(id)   on delete cascade,
  -- The traveler being refunded.
  user_id             uuid not null references auth.users(id)           on delete cascade,
  -- Who pressed the button. NOT the same person, and the whole point of the
  -- column: `money.manage` can belong to an operator OR to staff they added.
  requested_by        uuid not null references auth.users(id)           on delete restrict,
  -- The 'paid' row being reversed. `on delete set null` and nullable so that
  -- pruning payment events can never erase the record that a refund happened.
  payment_event_id    uuid references public.organized_trip_payment_events(id) on delete set null,
  -- Stripe's PaymentIntent id. Kept independently of payment_event_id for the
  -- same reason.
  provider_object_id  text not null,
  amount_usd          numeric not null check (amount_usd > 0),
  reason              text,
  -- The trip's frozen cancellation policy AS IT READ AT REFUND TIME. Copied,
  -- not referenced: this is the evidence for "these were the terms we applied",
  -- and a reference would let a later edit rewrite history.
  policy_snapshot     jsonb,
  status              text not null default 'pending'
                      check (status in ('pending', 'succeeded', 'failed',
                                        'blocked_insufficient_balance')),
  -- Why it failed / was blocked. Shown to the operator, so keep it readable.
  failure_reason      text,
  stripe_refund_id    text,
  -- Mirrors organized_trip_payment_events.is_livemode. Test-mode refunds must
  -- never be counted as real money moving.
  is_livemode         boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_trip_refunds_trip on public.organized_trip_refunds (trip_id);
create index if not exists idx_trip_refunds_user on public.organized_trip_refunds (user_id);
-- Answers "how much of this charge is already refunded?" without a table scan.
create index if not exists idx_trip_refunds_object
  on public.organized_trip_refunds (provider_object_id);

-- One Stripe refund can only ever be recorded once.
create unique index if not exists uq_trip_refunds_stripe_id
  on public.organized_trip_refunds (stripe_refund_id)
  where stripe_refund_id is not null;

create or replace function public.touch_organized_trip_refunds()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_organized_trip_refunds on public.organized_trip_refunds;
create trigger trg_touch_organized_trip_refunds
  before update on public.organized_trip_refunds
  for each row execute function public.touch_organized_trip_refunds();

-- ══════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════
alter table public.organized_trip_refunds enable row level security;
revoke all on public.organized_trip_refunds from anon, authenticated;

-- READ ONLY for clients. Every write goes through the `payments-refund` edge
-- function on the service role, because a refund is only legitimate if the
-- balance guardrail ran first — and a client-side INSERT would skip it.
grant select on public.organized_trip_refunds to authenticated;

-- The traveler sees refunds issued to them.
drop policy if exists trip_refunds_select_own on public.organized_trip_refunds;
create policy trip_refunds_select_own on public.organized_trip_refunds
for select to authenticated
using (user_id = auth.uid());

-- The operator and any staff who can see payment status see all of the trip's
-- refunds. `payments.view_status`, NOT `money.manage`: a Manager may reconcile
-- the books without being allowed to move money.
drop policy if exists trip_refunds_select_staff on public.organized_trip_refunds;
create policy trip_refunds_select_staff on public.organized_trip_refunds
for select to authenticated
using (public.trip_staff_can(trip_id, 'payments.view_status'));

comment on table public.organized_trip_refunds is
  'Refund intent + audit trail, written only by the payments-refund edge function. '
  'Includes attempts that never reached Stripe (blocked by the balance guardrail, or failed). '
  'The money itself is recorded by stripe-webhook in organized_trip_payment_events.';
