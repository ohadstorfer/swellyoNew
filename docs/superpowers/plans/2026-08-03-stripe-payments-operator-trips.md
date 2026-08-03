# Stripe Payments for Operator Trips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators running `hosting_style = 'C'` trips collect a deposit and a final balance by card inside Swellyo, with per-traveler prices, or opt out entirely and keep the app exactly as it is today.

**Architecture:** Payment steps are ordinary `organized_trip_requirements` rows with `req_type = 'pay'` — a socket the schema already has and a stub function already waiting to be filled. Amounts live per-traveler on `group_trip_participants` (the order-line pattern), not on the shared requirement row. An append-only ledger table records every payment event, and all payment state is *derived* from it, never stored as a flag.

**Tech Stack:** Supabase Postgres + RLS, Supabase Edge Functions (Deno), Stripe Connect Express with destination charges, Stripe Checkout (hosted page) opened via `expo-web-browser`, React Native 0.81 / Expo 54, TanStack Query v5, Jest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-08-03-stripe-payments-operator-trips-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **NEVER `supabase db push`.** Migrations are applied by hand with `supabase db query --linked -f <file>`, which runs the file as one transaction. There are ~168 unregistered local migration files; `db push` would replay them.
- **NEVER commit.** Ohad reviews and commits manually, and edits other files in parallel. Each task ends by staging **explicit paths only** — never `git add -A`, never `git commit -a`, never `git reset --hard`.
- **No simulator or Maestro testing.** Verify with `npx tsc --noEmit` and Jest. Device testing is Ohad's.
- **`npx tsc --noEmit` has a pre-existing error baseline.** Record the count before starting; a task passes if it adds **zero** new errors. Do not attempt to fix pre-existing ones.
- **No native modules.** Ohad tests in Expo Go. Card entry is Stripe Checkout in a browser sheet via `expo-web-browser` (already a dependency, `~15.0.9`). Do not add `@stripe/stripe-react-native`.
- **Money in the database is `numeric` canonical USD.** Stripe's API wants integer cents. Convert only at the Stripe boundary, never store cents.
- **Never log** a Stripe secret key, a webhook signing secret, a card detail, a signed storage URL, or a passport number.
- **Currency display** follows the existing convention: canonical USD stored, shown through `budget_currency` + the frozen `budget_fx_rate`. There is no separate deposit currency.
- **Commission** is `users.commission_bps`, default `1200` (= 12%).
- **A `SECURITY DEFINER` function keeps the default PUBLIC execute grant.** Every new one must be followed by `revoke execute ... from public, anon`, or `anon` can call it over `/rest/v1/rpc/`.
- **New views in `public` are granted to `anon` by Supabase defaults.** A table-level revoke does not cover a view created later. This plan creates no views; if you add one, revoke it explicitly.
- Edge functions deploy via CLI: `supabase functions deploy <name> --use-api`. **Always diff against the live version before deploying** — several live functions are ahead of the repo.

---

## File Structure

**New**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260803000000_operator_trip_payments.sql` | Every schema change, in one transaction |
| `src/services/trips/tripPaymentsService.ts` | Amount math (pure) + the two client calls |
| `supabase/functions/stripe-connect-onboard/index.ts` | Operator's Express account + onboarding link |
| `supabase/functions/payments-checkout/index.ts` | Creates a Checkout Session for one pay row |
| `supabase/functions/stripe-webhook/index.ts` | Verifies Stripe signature, appends ledger rows |
| `src/components/trips/TravelerPriceSheet.tsx` | Operator edits one traveler's price |
| `src/services/trips/__tests__/tripPaymentsService.test.ts` | Tests for the amount math |

**Modified**

| File | Change |
|---|---|
| `src/services/trips/tripDocumentsService.ts` | `'deposit'`/`'balance'` in `RequirementKind`, `REQUIREMENT_CATALOG`, `REQUIREMENT_ORDER`, `DEFAULT_TIMING`; stop filtering `pay` out of `fetchTripReview` |
| `src/screens/trips/CreateTripFlowA.tsx` | Payment mode + deposit in the budget step |
| `src/components/trips/plan/PlanSections.tsx` | Render pay rows with an amount and a Pay button |
| `src/components/trips/ManageRequirementsSheet.tsx` | Show the two pay rows with timing controls |
| `src/hooks/trips/useTripQueries.ts` | Query key for payment state |
| `supabase/config.toml` | `verify_jwt` per new function |

---

### Task 1: Migration — schema, ledger, and derived pay state

Everything the database needs, in one file. `db query -f` runs it as one transaction, so a failure anywhere rolls the whole thing back.

**Files:**
- Create: `supabase/migrations/20260803000000_operator_trip_payments.sql`

**Interfaces:**
- Consumes: existing `public.is_trip_host(uuid)`, `public.group_trips`, `public.group_trip_participants`, `public.organized_trip_requirements`
- Produces:
  - `public.operator_traveler_amount_due(p_trip_id uuid, p_user_id uuid, p_kind text) returns numeric`
  - `public.operator_requirement_pay_state(p_trip_id uuid, p_user_id uuid, p_requirement_id uuid) returns text` — **signature unchanged**, body replaced
  - table `public.organized_trip_payment_events`
  - columns `users.stripe_account_id`, `users.stripe_charges_enabled`, `users.commission_bps`
  - columns `group_trips.payment_mode`, `group_trips.deposit_amount`
  - columns `group_trip_participants.price_total_usd`, `group_trip_participants.deposit_usd`

- [ ] **Step 1: Write the migration file**

```sql
-- Stripe payments for operator trips.
-- Spec: docs/superpowers/specs/2026-08-03-stripe-payments-operator-trips-design.md
--
-- Nothing here modifies an existing column or policy. Every A and B trip, and
-- every existing C trip, behaves exactly as before until an operator opts in.

-- ══════════════════════════════════════════════════════════════════
-- 1. Operator payout identity
-- ══════════════════════════════════════════════════════════════════
alter table public.users
  add column if not exists stripe_account_id      text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists commission_bps         integer not null default 1200;

-- Basis points, so 1200 = 12%. An integer avoids the float-rounding argument
-- entirely when the fee is computed in cents.
alter table public.users
  drop constraint if exists users_commission_bps_range;
alter table public.users
  add constraint users_commission_bps_range
  check (commission_bps between 0 and 10000);

-- ══════════════════════════════════════════════════════════════════
-- 2. Trip-level payment config
-- ══════════════════════════════════════════════════════════════════
-- text, not boolean: an Israeli gateway becomes a third value, not a migration.
alter table public.group_trips
  add column if not exists payment_mode   text not null default 'offline',
  add column if not exists deposit_amount numeric;

alter table public.group_trips
  drop constraint if exists group_trips_payment_mode_check;
alter table public.group_trips
  add constraint group_trips_payment_mode_check
  check (payment_mode in ('offline', 'managed'));

-- Collecting money is an operator-trip feature. Enforced here so no client bug
-- can turn it on for a peer trip.
alter table public.group_trips
  drop constraint if exists group_trips_managed_is_operator;
alter table public.group_trips
  add constraint group_trips_managed_is_operator
  check (payment_mode = 'offline' or hosting_style = 'C');

alter table public.group_trips
  drop constraint if exists group_trips_deposit_non_negative;
alter table public.group_trips
  add constraint group_trips_deposit_non_negative
  check (deposit_amount is null or deposit_amount >= 0);

-- ══════════════════════════════════════════════════════════════════
-- 3. Per-traveler price — the order line
-- ══════════════════════════════════════════════════════════════════
-- The trip price is only the default. These columns are what the traveler
-- actually owes, frozen when they join, so a later price edit cannot rewrite
-- an existing traveler's deal.
--
-- Nullable on purpose: rows that existed before this feature stay null and
-- fall back to the trip price. No backfill needed.
alter table public.group_trip_participants
  add column if not exists price_total_usd numeric,
  add column if not exists deposit_usd     numeric;

alter table public.group_trip_participants
  drop constraint if exists gtp_price_non_negative;
alter table public.group_trip_participants
  add constraint gtp_price_non_negative
  check ((price_total_usd is null or price_total_usd >= 0)
     and (deposit_usd     is null or deposit_usd     >= 0));

alter table public.group_trip_participants
  drop constraint if exists gtp_deposit_not_over_total;
alter table public.group_trip_participants
  add constraint gtp_deposit_not_over_total
  check (price_total_usd is null
      or deposit_usd is null
      or deposit_usd <= price_total_usd);

-- ══════════════════════════════════════════════════════════════════
-- 4. Two new requirement kinds
-- ══════════════════════════════════════════════════════════════════
-- The requirement row is the SCHEDULE only — which step, and when it is due.
-- It carries no amount; amounts are per-traveler (section 3).
alter table public.organized_trip_requirements
  drop constraint if exists organized_trip_requirements_kind_check;
alter table public.organized_trip_requirements
  add constraint organized_trip_requirements_kind_check
  check (kind in ('passport', 'waiver', 'medical', 'insurance',
                  'visa', 'flights', 'custom', 'deposit', 'balance'));

-- A pay row may only exist on an operator trip that is actually collecting.
-- Mirrors trg_passport_requires_operator_trip. A CHECK cannot do this because
-- it may not read another table.
create or replace function public.enforce_pay_requires_managed_trip()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_style text; v_mode text;
begin
  if new.req_type <> 'pay' then
    return new;
  end if;

  select hosting_style, payment_mode into v_style, v_mode
    from public.group_trips
   where id = new.trip_id;

  if v_style is distinct from 'C' or v_mode is distinct from 'managed' then
    raise exception
      'a pay requirement needs an operator trip with payment_mode = ''managed''';
  end if;

  return new;
end $$;

-- SECURITY DEFINER keeps the default PUBLIC execute grant. Without this,
-- anon can call it over /rest/v1/rpc/.
revoke execute on function public.enforce_pay_requires_managed_trip() from public, anon;

drop trigger if exists trg_pay_requires_managed_trip on public.organized_trip_requirements;
create trigger trg_pay_requires_managed_trip
  before insert or update of req_type, trip_id
  on public.organized_trip_requirements
  for each row execute function public.enforce_pay_requires_managed_trip();

-- ══════════════════════════════════════════════════════════════════
-- 5. The ledger — append only
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.organized_trip_payment_events (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.group_trips(id) on delete cascade,
  user_id             uuid not null references auth.users(id)          on delete cascade,
  -- SET NULL, not cascade. Every other child of requirements cascades; this one
  -- must not. Deleting a requirement cannot erase the record that someone paid.
  requirement_id      uuid references public.organized_trip_requirements(id) on delete set null,
  provider            text not null default 'stripe',
  provider_event_id   text not null,
  provider_object_id  text,
  event_type          text not null check (event_type in ('paid', 'refunded', 'failed')),
  -- Signed: a refund is negative, so the balance is always a plain sum().
  amount_usd          numeric not null,
  amount_charged      numeric,
  currency_charged    text,
  application_fee_usd numeric,
  created_at          timestamptz not null default now()
);

-- What makes the webhook safe to retry. Stripe redelivers events; the second
-- insert fails on this index and the handler swallows it.
create unique index if not exists uq_otpe_provider_event
  on public.organized_trip_payment_events (provider, provider_event_id);

create index if not exists idx_otpe_lookup
  on public.organized_trip_payment_events (trip_id, user_id, requirement_id);

alter table public.organized_trip_payment_events enable row level security;

revoke all    on public.organized_trip_payment_events from anon, public;
grant  select on public.organized_trip_payment_events to   authenticated;

-- Read only. There is deliberately NO insert/update/delete policy: only the
-- service role (the webhook) writes. Nothing sent from a phone can invent a
-- payment.
drop policy if exists otpe_read_own on public.organized_trip_payment_events;
create policy otpe_read_own on public.organized_trip_payment_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

-- ══════════════════════════════════════════════════════════════════
-- 6. What one traveler owes for one step
-- ══════════════════════════════════════════════════════════════════
-- The single server-side home for this arithmetic. tripPaymentsService.ts
-- mirrors it on the client; the two must agree.
create or replace function public.operator_traveler_amount_due(
  p_trip_id uuid, p_user_id uuid, p_kind text
) returns numeric
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case p_kind
    when 'deposit' then coalesce(p.deposit_usd, t.deposit_amount)
    when 'balance' then coalesce(p.price_total_usd, t.cost_per_person)
                      - coalesce(p.deposit_usd, t.deposit_amount, 0)
    else null
  end
  from public.group_trips t
  left join public.group_trip_participants p
    on p.trip_id = t.id and p.user_id = p_user_id
  where t.id = p_trip_id;
$$;

revoke execute on function public.operator_traveler_amount_due(uuid, uuid, text) from public, anon;
grant  execute on function public.operator_traveler_amount_due(uuid, uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 7. Pay state — replaces the v1 stub
-- ══════════════════════════════════════════════════════════════════
-- The stub's comment promised: "the payments spec replaces the body with a read
-- of the ledger. The signature never changes." This is that. Every caller of
-- operator_trip_my_requirements keeps working untouched.
create or replace function public.operator_requirement_pay_state(
  p_trip_id uuid, p_user_id uuid, p_requirement_id uuid
) returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with due as (
    select public.operator_traveler_amount_due(
             p_trip_id, p_user_id,
             (select kind from public.organized_trip_requirements where id = p_requirement_id)
           ) as amount
  ),
  paid as (
    select coalesce(sum(amount_usd), 0) as total
      from public.organized_trip_payment_events
     where trip_id        = p_trip_id
       and user_id        = p_user_id
       and requirement_id = p_requirement_id
  )
  select case
    -- No price set for this traveler yet: nothing can be owed, so nothing is due.
    when (select amount from due) is null then 'not_started'
    when (select total from paid) >= (select amount from due) then 'approved'
    else 'not_started'
  end;
$$;

revoke execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) from public, anon;
grant  execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 8. Freeze the price when a traveler joins
-- ══════════════════════════════════════════════════════════════════
-- Copying the trip price onto the participant row at join time is what makes a
-- later price edit harmless to people already on the trip — the same reason an
-- order line stores its own amount instead of pointing at the product.
create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  -- An explicit price passed in wins; never overwrite a deliberate value.
  if new.price_total_usd is not null then
    return new;
  end if;

  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_dep
    from public.group_trips
   where id = new.trip_id;

  -- Offline trips carry no prices at all, so there is nothing to freeze.
  if v_mode is distinct from 'managed' then
    return new;
  end if;

  new.price_total_usd := v_price;
  new.deposit_usd     := v_dep;
  return new;
end $$;

revoke execute on function public.freeze_traveler_price() from public, anon;

drop trigger if exists trg_freeze_traveler_price on public.group_trip_participants;
create trigger trg_freeze_traveler_price
  before insert on public.group_trip_participants
  for each row execute function public.freeze_traveler_price();

-- ══════════════════════════════════════════════════════════════════
-- 9. Turning collection OFF must not destroy money history
-- ══════════════════════════════════════════════════════════════════
-- Switching a live trip back to 'offline' hides the pay rows. It deactivates
-- them; it never deletes them. A deleted requirement would leave ledger rows
-- pointing at nothing (requirement_id goes SET NULL), and the trip's payment
-- history would become unreadable.
create or replace function public.deactivate_pay_rows_when_offline()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.payment_mode = 'offline' and old.payment_mode is distinct from 'offline' then
    update public.organized_trip_requirements
       set is_active = false
     where trip_id = new.id
       and req_type = 'pay';
  end if;
  return new;
end $$;

revoke execute on function public.deactivate_pay_rows_when_offline() from public, anon;

drop trigger if exists trg_deactivate_pay_rows_when_offline on public.group_trips;
create trigger trg_deactivate_pay_rows_when_offline
  after update of payment_mode on public.group_trips
  for each row execute function public.deactivate_pay_rows_when_offline();
```

- [ ] **Step 2: Verify it end-to-end against prod without persisting anything**

Write this to `/tmp/verify_payments.sql` and run it. The final `raise exception` forces a rollback, so **nothing is written**. This is the same technique used to verify the operator-trips migrations on 2026-07-24.

```sql
do $$
declare
  v_trip uuid; v_user uuid; v_req uuid; v_state text; v_due numeric;
begin
  select id into v_trip from public.group_trips where hosting_style = 'C' limit 1;
  select id into v_user from auth.users limit 1;

  update public.group_trips
     set payment_mode = 'managed', cost_per_person = 2000, deposit_amount = 500
   where id = v_trip;

  insert into public.organized_trip_requirements
    (trip_id, kind, req_type, title, skip_at_onboarding, is_active)
  values (v_trip, 'deposit', 'pay', 'Deposit', 'must_have', true)
  returning id into v_req;

  insert into public.group_trip_participants (trip_id, user_id, role)
  values (v_trip, v_user, 'member')
  on conflict do nothing;

  -- Freeze trigger should have copied 2000 / 500.
  select public.operator_traveler_amount_due(v_trip, v_user, 'deposit') into v_due;
  raise notice 'deposit due (expect 500): %', v_due;

  select public.operator_traveler_amount_due(v_trip, v_user, 'balance') into v_due;
  raise notice 'balance due (expect 1500): %', v_due;

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  raise notice 'state before paying (expect not_started): %', v_state;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_1', 'paid', 500);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  raise notice 'state after paying (expect approved): %', v_state;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_2', 'refunded', -500);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  raise notice 'state after refund (expect not_started): %', v_state;

  raise exception 'ROLLBACK: verification only, nothing persisted';
end $$;
```

Run: `supabase db query --linked -f /tmp/verify_payments.sql`

Expected notices, in order: `500`, `1500`, `not_started`, `approved`, `not_started`, then the rollback exception.

- [ ] **Step 3: Verify the guard rails actually refuse bad rows**

Append a second DO block to the same file (before the final `raise exception`) and re-run:

```sql
  -- A pay row on an offline trip must be refused.
  begin
    update public.group_trips set payment_mode = 'offline' where id = v_trip;
    insert into public.organized_trip_requirements
      (trip_id, kind, req_type, title, skip_at_onboarding, is_active)
    values (v_trip, 'balance', 'pay', 'Balance', 'must_have', true);
    raise exception 'FAIL: a pay row was allowed on an offline trip';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: pay row refused on offline trip';
  end;

  -- managed mode must be refused on a peer trip.
  begin
    update public.group_trips
       set payment_mode = 'managed'
     where id = (select id from public.group_trips where hosting_style <> 'C' limit 1);
    raise exception 'FAIL: managed mode was allowed on a peer trip';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: managed mode refused on a peer trip';
  end;
```

Expected: both `OK:` notices.

- [ ] **Step 4: Apply to prod**

Run: `supabase db query --linked -f supabase/migrations/20260803000000_operator_trip_payments.sql`

Then confirm no new security advisories:

Run: `supabase db advisors --linked --type security`
Expected: no new findings mentioning `organized_trip_payment_events`, `enforce_pay_requires_managed_trip`, `freeze_traveler_price`, or `operator_traveler_amount_due`.

- [ ] **Step 5: Stage**

```bash
git add supabase/migrations/20260803000000_operator_trip_payments.sql
```

Do not commit. Tell Ohad the migration is applied and staged.

---

### Task 2: Amount math (pure functions, TDD)

The one piece of this feature where a wrong answer means wrong money, and the one piece that is fully testable with no database. Written test-first.

**Files:**
- Create: `src/services/trips/tripPaymentsService.ts`
- Test: `src/services/trips/__tests__/tripPaymentsService.test.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `type PayStep = 'deposit' | 'balance'`
  - `type TravelerPrices = { totalUsd: number | null; depositUsd: number | null }`
  - `amountDue(step: PayStep, p: TravelerPrices): number | null`
  - `amountOutstanding(step: PayStep, p: TravelerPrices, paidUsd: number): number`
  - `usdToStripeCents(usd: number): number`
  - `commissionCents(totalCents: number, bps: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// Mock the supabase client so importing the service doesn't init a real client
// (mirrors src/services/trips/__tests__/exploreSelect.test.ts).
jest.mock('../../../config/supabase', () => ({ supabase: {} }));

import {
  amountDue,
  amountOutstanding,
  usdToStripeCents,
  commissionCents,
} from '../tripPaymentsService';

describe('amountDue', () => {
  it('gives the deposit for the deposit step', () => {
    expect(amountDue('deposit', { totalUsd: 2000, depositUsd: 500 })).toBe(500);
  });

  it('gives total minus deposit for the balance step', () => {
    expect(amountDue('balance', { totalUsd: 2000, depositUsd: 500 })).toBe(1500);
  });

  // A trip with no deposit has no deposit ROW at all, but the math must still
  // be safe if it is asked.
  it('returns null for a deposit step when no deposit is set', () => {
    expect(amountDue('deposit', { totalUsd: 2000, depositUsd: null })).toBeNull();
  });

  it('charges the full price as the balance when there is no deposit', () => {
    expect(amountDue('balance', { totalUsd: 2000, depositUsd: null })).toBe(2000);
  });

  // A traveler who joined before the operator turned payments on has no frozen
  // price. Nothing is owed until the operator gives them one.
  it('returns null when the traveler has no price at all', () => {
    expect(amountDue('balance', { totalUsd: null, depositUsd: null })).toBeNull();
    expect(amountDue('deposit', { totalUsd: null, depositUsd: 500 })).toBeNull();
  });
});

describe('amountOutstanding', () => {
  it('subtracts what was already paid', () => {
    expect(amountOutstanding('balance', { totalUsd: 2000, depositUsd: 500 }, 400)).toBe(1100);
  });

  // Overpaid, or refunded down to a negative sum. Never ask for a negative
  // amount — Stripe would reject it and the row should simply read as done.
  it('never goes below zero', () => {
    expect(amountOutstanding('deposit', { totalUsd: 2000, depositUsd: 500 }, 900)).toBe(0);
  });

  it('is zero when nothing is due', () => {
    expect(amountOutstanding('deposit', { totalUsd: 2000, depositUsd: null }, 0)).toBe(0);
  });

  // The operator raised this traveler's price after they paid. Their balance
  // reopens for the difference — the behaviour Ohad asked for.
  it('reopens when the price is raised after payment', () => {
    expect(amountOutstanding('balance', { totalUsd: 2400, depositUsd: 500 }, 1500)).toBe(400);
  });
});

describe('usdToStripeCents', () => {
  it('converts whole dollars', () => {
    expect(usdToStripeCents(1500)).toBe(150000);
  });

  // Floats. 19.99 * 100 is 1998.9999999999998 in IEEE 754, so a bare
  // Math.trunc would charge a cent less on a large share of prices.
  it('rounds rather than truncates', () => {
    expect(usdToStripeCents(19.99)).toBe(1999);
    expect(usdToStripeCents(0.1 + 0.2)).toBe(30);
  });
});

describe('commissionCents', () => {
  it('takes 12% at the default rate', () => {
    expect(commissionCents(150000, 1200)).toBe(18000);
  });

  it('takes nothing at zero', () => {
    expect(commissionCents(150000, 0)).toBe(0);
  });

  // Must never exceed the charge, or Stripe rejects the whole session.
  it('never exceeds the charge', () => {
    expect(commissionCents(100, 10000)).toBe(100);
  });

  it('rounds to a whole cent', () => {
    expect(commissionCents(999, 1200)).toBe(120);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/services/trips/__tests__/tripPaymentsService.test.ts`
Expected: FAIL — `Cannot find module '../tripPaymentsService'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Payment amounts for operator trips.
 *
 * The trip price is only a DEFAULT. What a traveler owes lives on their own
 * participant row (`price_total_usd` / `deposit_usd`), frozen when they joined.
 * That is why changing a trip's price never rewrites an existing traveler's
 * deal — the same reason an order line stores its own amount rather than
 * pointing at the product.
 *
 * ⚠️ These functions mirror `operator_traveler_amount_due()` in
 * `20260803000000_operator_trip_payments.sql`. If one changes, the other must.
 * The SQL is authoritative — the client copy exists so the Plan tab can show an
 * amount without a round trip.
 */

export type PayStep = 'deposit' | 'balance';

export type TravelerPrices = {
  /** This traveler's total, frozen on their participant row. Null = no price
   *  set (they joined before payments were turned on). */
  totalUsd: number | null;
  /** Their deposit. Null = this trip takes one single payment. */
  depositUsd: number | null;
};

/** What this step costs, or null when nothing is owed for it. */
export function amountDue(step: PayStep, p: TravelerPrices): number | null {
  if (p.totalUsd == null) return null;
  if (step === 'deposit') return p.depositUsd;
  return p.totalUsd - (p.depositUsd ?? 0);
}

/** What is still owed after everything already paid against this step. */
export function amountOutstanding(
  step: PayStep,
  p: TravelerPrices,
  paidUsd: number,
): number {
  const due = amountDue(step, p);
  if (due == null) return 0;
  return Math.max(0, due - paidUsd);
}

/** Stripe works in integer cents. Round, never truncate: 19.99 * 100 is
 *  1998.9999999999998 in floating point, and truncating undercharges. */
export function usdToStripeCents(usd: number): number {
  return Math.round(usd * 100);
}

/** Swellyo's cut, in cents. Capped at the charge itself — an application fee
 *  larger than the amount makes Stripe reject the whole session. */
export function commissionCents(totalCents: number, bps: number): number {
  return Math.min(totalCents, Math.round((totalCents * bps) / 10000));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/services/trips/__tests__/tripPaymentsService.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: the same count recorded at the start. No new errors.

- [ ] **Step 6: Stage**

```bash
git add src/services/trips/tripPaymentsService.ts src/services/trips/__tests__/tripPaymentsService.test.ts
```

---

### Task 3: Teach the requirement catalog about deposit and balance

`REQUIREMENT_CATALOG` is the one place the operator wizard and the traveler's plan card agree on what a kind means. Adding the two pay kinds here is what makes them render everywhere without touching either screen's logic.

**Files:**
- Modify: `src/services/trips/tripDocumentsService.ts` — `RequirementKind` (line ~44), `RequirementAction` (line ~53), `REQUIREMENT_CATALOG` (line ~72), `REQUIREMENT_ORDER` (line ~147), `DEFAULT_TIMING` (line ~665), `fetchTripReview` (line ~1025)
- Test: `src/services/trips/__tests__/tripPaymentsService.test.ts` (append)

**Interfaces:**
- Consumes: `PayStep` from Task 2
- Produces: `RequirementKind` now includes `'deposit' | 'balance'`; `RequirementAction` now includes `'pay'`

- [ ] **Step 1: Write the failing test**

Append to `src/services/trips/__tests__/tripPaymentsService.test.ts`:

```ts
import {
  REQUIREMENT_CATALOG,
  REQUIREMENT_ORDER,
  DEFAULT_TIMING,
} from '../tripDocumentsService';

describe('pay requirement kinds', () => {
  it('has both pay kinds in the catalog', () => {
    expect(REQUIREMENT_CATALOG.deposit).toBeDefined();
    expect(REQUIREMENT_CATALOG.balance).toBeDefined();
  });

  // The req_type is what routes state resolution to the ledger. Get this wrong
  // and the row waits forever for evidence that never arrives.
  it('routes both through the pay branch', () => {
    expect(REQUIREMENT_CATALOG.deposit.reqType).toBe('pay');
    expect(REQUIREMENT_CATALOG.balance.reqType).toBe('pay');
    expect(REQUIREMENT_CATALOG.deposit.action).toBe('pay');
    expect(REQUIREMENT_CATALOG.balance.action).toBe('pay');
  });

  it('puts the deposit before the balance', () => {
    expect(REQUIREMENT_ORDER.indexOf('deposit')).toBeLessThan(
      REQUIREMENT_ORDER.indexOf('balance'),
    );
  });

  // A deposit is due when you join, so it must be must_have with NO deadline —
  // organized_trip_req_deadline_rule rejects any other combination with a 23514.
  it('defaults the deposit to due on joining', () => {
    expect(DEFAULT_TIMING.deposit.skippable).toBe(false);
  });

  // A balance is due before departure, so it must be skippable WITH a deadline.
  it('defaults the balance to a deadline before departure', () => {
    expect(DEFAULT_TIMING.balance.skippable).toBe(true);
    expect(DEFAULT_TIMING.balance.daysBefore).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/services/trips/__tests__/tripPaymentsService.test.ts -t "pay requirement kinds"`
Expected: FAIL — `REQUIREMENT_CATALOG.deposit` is undefined.

- [ ] **Step 3: Extend the types**

In `src/services/trips/tripDocumentsService.ts`, replace the `RequirementKind` union (line ~44):

```ts
export type RequirementKind =
  | 'passport'
  | 'waiver'
  | 'medical'
  | 'insurance'
  | 'visa'
  | 'flights'
  | 'deposit'
  | 'balance';
```

And `RequirementAction` (line ~53):

```ts
/** What the traveler actually does. Drives which screen opens. */
export type RequirementAction = 'upload' | 'agree' | 'medical' | 'pay';
```

- [ ] **Step 4: Add the two catalog entries**

Add inside `REQUIREMENT_CATALOG`, after the `medical` entry:

```ts
  deposit: {
    title: 'Deposit',
    helpText: 'Pay your deposit to confirm your place.',
    // 'pay' routes state resolution straight to the ledger — see
    // operator_requirement_pay_state(). No document, no acknowledgement.
    reqType: 'pay',
    action: 'pay',
    allowPdf: false,
    operatorTitle: 'Deposit',
    operatorSub: 'A first payment when they join. Leave the amount blank for one single payment.',
  },
  balance: {
    title: 'Final payment',
    helpText: 'The rest of your trip cost.',
    reqType: 'pay',
    action: 'pay',
    allowPdf: false,
    operatorTitle: 'Final payment',
    operatorSub: 'The rest of the price, due before the trip starts.',
  },
```

- [ ] **Step 5: Add them to the order and the default timing**

`REQUIREMENT_ORDER` (line ~147) — money first, because it is the thing an operator most needs:

```ts
export const REQUIREMENT_ORDER: RequirementKind[] = [
  'deposit',
  'balance',
  'passport',
  'waiver',
  'medical',
  'insurance',
  'visa',
  'flights',
];
```

In `DEFAULT_TIMING` (line ~665), add:

```ts
  // must_have carries NO deadline and skippable MUST carry one —
  // organized_trip_req_deadline_rule raises 23514 on any other pairing.
  deposit: { skippable: false, daysBefore: 0 },
  balance: { skippable: true, daysBefore: 30 },
```

- [ ] **Step 6: Stop hiding pay rows from the host's review screen**

In `fetchTripReview` (line ~1023), delete the filter:

```ts
  const requirements = (reqRes.data ?? [])
    .sort(
      (a: any, b: any) =>
        // Same order the traveler sees: must-haves first, then by deadline.
        Number(a.skip_at_onboarding !== 'must_have') -
          Number(b.skip_at_onboarding !== 'must_have') ||
        String(a.due_date ?? '').localeCompare(String(b.due_date ?? '')) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
```

Then, inside the `requirements.map` callback, add this branch **before** the `req_type === 'acknowledge'` test (line ~1054). The order of these branches mirrors the RPC and is load-bearing:

```ts
      // Pay rows resolve from the ledger, which fetchTripReview does not load.
      // Showing them as never-started would be a lie, so they read as
      // 'not_started' with no review action — the host sees money on the
      // traveler price sheet instead.
      if (r.req_type === 'pay') {
        return {
          ...base,
          state: 'not_started' as RequirementState,
          documentId: null,
          storagePath: null,
          submittedAt: null,
          note: null,
          fileDeleted: false,
        };
      }
```

- [ ] **Step 7: Run the tests**

Run: `npx jest src/services/trips`
Expected: PASS. All suites in that folder green.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase over the baseline. If `RequirementKind` gaining two members broke an exhaustive `Record<RequirementKind, …>` somewhere, fix those call sites — do not widen the type back.

- [ ] **Step 9: Stage**

```bash
git add src/services/trips/tripDocumentsService.ts src/services/trips/__tests__/tripPaymentsService.test.ts
```

---

### Task 4: Edge function — `stripe-connect-onboard`

Creates the operator's Stripe Express account and hands back an onboarding link. Also refreshes whether Stripe will let them take charges yet, which is the gate on managed mode.

**Files:**
- Create: `supabase/functions/stripe-connect-onboard/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `users.stripe_account_id`, `users.stripe_charges_enabled` (Task 1)
- Produces: POST body `{ action: 'status' } | { action: 'onboard', returnUrl: string }`; response `{ chargesEnabled: boolean, accountId: string | null, onboardingUrl?: string }`

- [ ] **Step 1: Write the function**

```ts
// Stripe Connect Express onboarding for operators.
//
// Money never passes through Swellyo's own Stripe account: travelers pay the
// operator's connected account and our commission is split off as an
// application fee. That is what keeps Swellyo out of money transmission —
// Stripe holds the licence, we do not need one.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Stripe's REST API, form-encoded. No SDK: one less dependency to pin in Deno. */
async function stripe(path: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    // Stripe error messages are safe to surface; they never contain our keys.
    throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  }
  return body;
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const userId = userData.user.id;

    const { action, returnUrl } = await req.json();

    const { data: row } = await supabase
      .from('users')
      .select('stripe_account_id, stripe_charges_enabled, email')
      .eq('id', userId)
      .single();

    let accountId: string | null = row?.stripe_account_id ?? null;

    // ── status: re-read Stripe, because onboarding finishes on Stripe's site
    //    and nothing tells us about it except asking.
    if (action === 'status') {
      if (!accountId) return json({ chargesEnabled: false, accountId: null });
      const acct = await stripe(`accounts/${accountId}`);
      const chargesEnabled = !!acct.charges_enabled;
      await supabase
        .from('users')
        .update({ stripe_charges_enabled: chargesEnabled })
        .eq('id', userId);
      return json({ chargesEnabled, accountId });
    }

    if (action !== 'onboard') return json({ error: 'Unknown action' }, 400);
    if (typeof returnUrl !== 'string' || !returnUrl.startsWith('https://')) {
      return json({ error: 'returnUrl must be an https URL' }, 400);
    }

    // ── onboard: create the account once, then always hand back a fresh link.
    //    Account links expire in minutes, so they are never stored.
    if (!accountId) {
      const acct = await stripe('accounts', {
        type: 'express',
        email: row?.email ?? '',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
      });
      accountId = acct.id as string;
      await supabase.from('users').update({ stripe_account_id: accountId }).eq('id', userId);
    }

    const link = await stripe('account_links', {
      account: accountId,
      refresh_url: returnUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return json({ accountId, chargesEnabled: false, onboardingUrl: link.url });
  } catch (e) {
    console.error('[stripe-connect-onboard]', e instanceof Error ? e.message : e);
    return json({ error: 'Could not start Stripe onboarding' }, 500);
  }
});
```

- [ ] **Step 2: Register it in config.toml**

Append to `supabase/config.toml`:

```toml
# Operator connects their Stripe account. Always a logged-in caller.
[functions.stripe-connect-onboard]
verify_jwt = true
```

- [ ] **Step 3: Set the Stripe secret**

Run: `supabase secrets set STRIPE_SECRET_KEY=sk_test_... --linked`

Use the **test** key first. Confirm with `supabase secrets list --linked` that `STRIPE_SECRET_KEY` appears. Never print the value.

- [ ] **Step 4: Deploy and check status on an account that has none**

Run: `supabase functions deploy stripe-connect-onboard --use-api`

Then call it with a real user JWT:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/stripe-connect-onboard" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"action":"status"}'
```

Expected: `{"chargesEnabled":false,"accountId":null}`

- [ ] **Step 5: Stage**

```bash
git add supabase/functions/stripe-connect-onboard/index.ts supabase/config.toml
```

---

### Task 5: Edge function — `payments-checkout`

Creates the Stripe Checkout Session for one pay row. **The amount is always computed on the server** from the ledger and the traveler's frozen price — the client never sends a number.

**Files:**
- Create: `supabase/functions/payments-checkout/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `operator_traveler_amount_due()` (Task 1), `organized_trip_payment_events` (Task 1)
- Produces: POST body `{ requirementId: string, returnUrl: string }`; response `{ url: string }` or `{ error: string }`

- [ ] **Step 1: Write the function**

```ts
// Creates one Stripe Checkout Session for one pay requirement.
//
// Named `payments-checkout`, not `stripe-checkout`, because an Israeli gateway
// (Tranzila) is expected later and becomes a branch inside here rather than a
// second call site on the client.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

// Mirrors usdToStripeCents / commissionCents in tripPaymentsService.ts.
// Round, never truncate: 19.99 * 100 is 1998.9999999999998 in floating point.
const toCents = (usd: number) => Math.round(usd * 100);
const feeCents = (total: number, bps: number) =>
  Math.min(total, Math.round((total * bps) / 10000));

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const userId = userData.user.id;

    const { requirementId, returnUrl } = await req.json();
    if (typeof requirementId !== 'string') return json({ error: 'requirementId required' }, 400);
    if (typeof returnUrl !== 'string' || !returnUrl.startsWith('https://')) {
      return json({ error: 'returnUrl must be an https URL' }, 400);
    }

    // ── 1. The requirement must be a live pay row.
    const { data: req_ } = await supabase
      .from('organized_trip_requirements')
      .select('id, trip_id, kind, req_type, title, is_active')
      .eq('id', requirementId)
      .single();

    if (!req_ || req_.req_type !== 'pay' || !req_.is_active) {
      return json({ error: 'Not a payment step' }, 400);
    }

    // ── 2. The caller must actually be on this trip. Without this check any
    //      signed-in user could open a checkout against someone else's trip.
    const { data: participant } = await supabase
      .from('group_trip_participants')
      .select('user_id')
      .eq('trip_id', req_.trip_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!participant) return json({ error: 'You are not on this trip' }, 403);

    // ── 3. The trip must still be collecting, and the operator must be able to
    //      receive. Re-checked here because the client is not trustworthy.
    const { data: trip } = await supabase
      .from('group_trips')
      .select('id, title, host_id, payment_mode')
      .eq('id', req_.trip_id)
      .single();

    if (!trip || trip.payment_mode !== 'managed') {
      return json({ error: 'This trip is not collecting payments' }, 400);
    }

    const { data: host } = await supabase
      .from('users')
      .select('stripe_account_id, stripe_charges_enabled, commission_bps')
      .eq('id', trip.host_id)
      .single();

    if (!host?.stripe_account_id || !host.stripe_charges_enabled) {
      return json({ error: 'The organiser cannot accept payments yet' }, 400);
    }

    // ── 4. What is still owed. Server-side, always.
    const { data: dueRaw, error: dueErr } = await supabase.rpc(
      'operator_traveler_amount_due',
      { p_trip_id: req_.trip_id, p_user_id: userId, p_kind: req_.kind },
    );
    if (dueErr) throw dueErr;

    const due = Number(dueRaw ?? 0);
    if (!Number.isFinite(due) || due <= 0) {
      return json({ error: 'Nothing to pay' }, 400);
    }

    const { data: events } = await supabase
      .from('organized_trip_payment_events')
      .select('amount_usd')
      .eq('trip_id', req_.trip_id)
      .eq('user_id', userId)
      .eq('requirement_id', requirementId);

    const paid = (events ?? []).reduce((s, e) => s + Number(e.amount_usd), 0);
    const outstanding = Math.max(0, due - paid);
    if (outstanding <= 0) return json({ error: 'Already paid' }, 400);

    const amountCents = toCents(outstanding);
    const commission = feeCents(amountCents, host.commission_bps ?? 1200);

    // ── 5. Destination charge: the operator is paid, our fee is split off.
    const session = await stripe('checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': `${trip.title} — ${req_.title}`,
      'payment_intent_data[application_fee_amount]': String(commission),
      'payment_intent_data[transfer_data][destination]': host.stripe_account_id,
      // The webhook reads these back. They are the only link from a Stripe
      // event to a row in our database.
      'payment_intent_data[metadata][trip_id]': req_.trip_id,
      'payment_intent_data[metadata][user_id]': userId,
      'payment_intent_data[metadata][requirement_id]': requirementId,
      'metadata[trip_id]': req_.trip_id,
      'metadata[user_id]': userId,
      'metadata[requirement_id]': requirementId,
      success_url: returnUrl,
      cancel_url: returnUrl,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('[payments-checkout]', e instanceof Error ? e.message : e);
    return json({ error: 'Could not start the payment' }, 500);
  }
});
```

- [ ] **Step 2: Register it**

Append to `supabase/config.toml`:

```toml
# Traveler starts a payment. Always a logged-in caller.
[functions.payments-checkout]
verify_jwt = true
```

- [ ] **Step 3: Deploy**

Run: `supabase functions deploy payments-checkout --use-api`

- [ ] **Step 4: Verify it refuses a caller who is not on the trip**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/payments-checkout" \
  -H "Authorization: Bearer $OTHER_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"requirementId":"<a real pay requirement id>","returnUrl":"https://swellyo.com/pay/done"}'
```

Expected: HTTP 403, `{"error":"You are not on this trip"}`

This is the check that matters most in this function. Confirm it before moving on.

- [ ] **Step 5: Stage**

```bash
git add supabase/functions/payments-checkout/index.ts supabase/config.toml
```

---

### Task 6: Edge function — `stripe-webhook`

The only thing in the system that writes a payment. Everything the traveler and the operator see is derived from what this function appends.

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `organized_trip_payment_events` (Task 1)
- Produces: nothing the client calls — Stripe calls it

- [ ] **Step 1: Write the function**

```ts
// Stripe → Swellyo. The single writer of payment history.
//
// verify_jwt = false: Stripe cannot present a Supabase JWT. The function gates
// itself on Stripe's own signature instead, which is strictly stronger — a
// forged body fails the HMAC.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

/**
 * Verify Stripe's `t=…,v1=…` signature header.
 *
 * Done by hand rather than with the Stripe SDK because the SDK's verifier needs
 * Node crypto. WebCrypto is available in Deno and does the same HMAC.
 */
async function verify(payload: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=') as [string, string]),
  );
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  // Reject anything older than five minutes, so a captured request cannot be
  // replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare: a length check plus an XOR fold, so a wrong
  // signature never leaks how many leading bytes were right.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path} failed`);
  return res.json();
}

serve(async req => {
  const raw = await req.text();

  if (!(await verify(raw, req.headers.get('stripe-signature')))) {
    console.error('[stripe-webhook] bad signature');
    return new Response('bad signature', { status: 400 });
  }

  const event = JSON.parse(raw);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let row: Record<string, unknown> | null = null;

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      // A session can complete without the money actually arriving.
      if (s.payment_status !== 'paid') return new Response('ok');

      const m = s.metadata ?? {};
      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: s.payment_intent,
        event_type: 'paid',
        amount_usd: Number(s.amount_total) / 100,
        amount_charged: Number(s.amount_total) / 100,
        currency_charged: String(s.currency ?? 'usd').toUpperCase(),
      };
    } else if (event.type === 'charge.refunded') {
      const c = event.data.object;
      // A charge carries no metadata of ours — the PaymentIntent does.
      const pi = await stripeGet(`payment_intents/${c.payment_intent}`);
      const m = pi.metadata ?? {};
      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: c.payment_intent,
        event_type: 'refunded',
        // Negative, so the traveler's balance is always a plain sum().
        amount_usd: -(Number(c.amount_refunded) / 100),
        amount_charged: -(Number(c.amount_refunded) / 100),
        currency_charged: String(c.currency ?? 'usd').toUpperCase(),
      };
    } else {
      // Everything else is acknowledged and ignored, so Stripe stops retrying.
      return new Response('ok');
    }

    if (!row.trip_id || !row.user_id || !row.requirement_id) {
      console.error('[stripe-webhook] event missing metadata', event.id);
      // 200 on purpose: retrying will not add the metadata back.
      return new Response('ok');
    }

    const { error } = await supabase.from('organized_trip_payment_events').insert(row);

    // 23505 = the unique index on (provider, provider_event_id). Stripe
    // redelivers events; a duplicate means we already recorded this one.
    if (error && error.code !== '23505') throw error;

    return new Response('ok');
  } catch (e) {
    console.error('[stripe-webhook]', e instanceof Error ? e.message : e);
    // 500 so Stripe retries — better a duplicate attempt than a lost payment.
    return new Response('error', { status: 500 });
  }
});
```

- [ ] **Step 2: Register it as unauthenticated**

Append to `supabase/config.toml`:

```toml
# Stripe calls this; it cannot present a Supabase JWT. The function gates itself
# on Stripe's signature, which is stronger. Deploy with --no-verify-jwt.
[functions.stripe-webhook]
verify_jwt = false
```

- [ ] **Step 3: Create the endpoint in Stripe and set the secret**

In the Stripe dashboard: Developers → Webhooks → Add endpoint.

- URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `charge.refunded`

Copy the signing secret, then:

Run: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --linked`

- [ ] **Step 4: Deploy**

Run: `supabase functions deploy stripe-webhook --use-api --no-verify-jwt`

The `--no-verify-jwt` flag is required and easy to forget — the same constraint that already applies to `send-push-notification`.

- [ ] **Step 5: Verify an unsigned request is refused**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$SUPABASE_URL/functions/v1/stripe-webhook" \
  -H "Content-Type: application/json" -d '{"type":"checkout.session.completed"}'
```

Expected: `400`. If this returns 200, stop — the function is writing unverified payments.

- [ ] **Step 6: Verify a real signed event lands**

Run: `stripe listen --forward-to https://<project-ref>.supabase.co/functions/v1/stripe-webhook`

In another shell: `stripe trigger checkout.session.completed`

Then check the function logs for no errors. A row will not appear (the triggered event has no Swellyo metadata) — expect the `event missing metadata` log line and a 200. That proves signature verification passes and the handler is reached.

- [ ] **Step 7: Stage**

```bash
git add supabase/functions/stripe-webhook/index.ts supabase/config.toml
```

---

### Task 7: Client calls in `tripPaymentsService`

Wires the two edge functions and the ledger read into the service that already holds the amount math.

**Files:**
- Modify: `src/services/trips/tripPaymentsService.ts` (append)
- Modify: `src/hooks/trips/useTripQueries.ts` — add the query key

**Interfaces:**
- Consumes: `payments-checkout`, `stripe-connect-onboard` (Tasks 4–5)
- Produces:
  - `fetchTravelerPrices(tripId: string, userId: string): Promise<TravelerPrices>`
  - `fetchPaidByRequirement(tripId: string, userId: string): Promise<Record<string, number>>`
  - `startCheckout(requirementId: string): Promise<'paid' | 'cancelled'>`
  - `fetchConnectStatus(): Promise<{ chargesEnabled: boolean; accountId: string | null }>`
  - `startConnectOnboarding(): Promise<void>`
  - `saveTravelerPrice(tripId, userId, totalUsd, depositUsd): Promise<void>`
  - `tripsKeys.payments(tripId, userId)`

- [ ] **Step 1: Add the query key**

In `src/hooks/trips/useTripQueries.ts`, beside `detailRequirements`:

```ts
  payments: (tripId: string, userId: string) =>
    ['trips', 'payments', tripId, userId] as const,
```

- [ ] **Step 2: Append the data calls**

```ts
import { supabase } from '../../config/supabase';
import * as WebBrowser from 'expo-web-browser';

/** Where Stripe sends the browser after Checkout. Stripe rejects custom URL
 *  schemes, so this cannot be `swellyo://`. It is a plain page that tells the
 *  traveler to go back to the app — we never read anything from it. */
const RETURN_URL = 'https://swellyo.com/pay/done';

export async function fetchTravelerPrices(
  tripId: string,
  userId: string,
): Promise<TravelerPrices> {
  const [participant, trip] = await Promise.all([
    supabase
      .from('group_trip_participants')
      .select('price_total_usd, deposit_usd')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('group_trips')
      .select('cost_per_person, deposit_amount')
      .eq('id', tripId)
      .single(),
  ]);

  if (participant.error) throw participant.error;
  if (trip.error) throw trip.error;

  // Null on the participant row means they joined before payments were turned
  // on. Fall back to the trip price, exactly as operator_traveler_amount_due()
  // does in SQL.
  return {
    totalUsd: participant.data?.price_total_usd ?? trip.data?.cost_per_person ?? null,
    depositUsd: participant.data?.deposit_usd ?? trip.data?.deposit_amount ?? null,
  };
}

/** How much has been paid against each pay requirement, keyed by requirement id. */
export async function fetchPaidByRequirement(
  tripId: string,
  userId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('organized_trip_payment_events')
    .select('requirement_id, amount_usd')
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) throw error;

  const out: Record<string, number> = {};
  for (const e of data ?? []) {
    if (!e.requirement_id) continue;
    out[e.requirement_id] = (out[e.requirement_id] ?? 0) + Number(e.amount_usd);
  }
  return out;
}

/**
 * Open Stripe Checkout and wait for the browser sheet to close.
 *
 * ⚠️ The return trip is NOT proof of payment. Stripe rejects custom URL
 * schemes, so there is no reliable deep link back, and a traveler can close the
 * sheet at any moment. The webhook is the only source of truth — the caller
 * must refetch and trust the server, never this return value's optimism.
 */
export async function startCheckout(requirementId: string): Promise<'paid' | 'cancelled'> {
  const { data, error } = await supabase.functions.invoke('payments-checkout', {
    body: { requirementId, returnUrl: RETURN_URL },
  });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error ?? 'Could not start the payment');

  const result = await WebBrowser.openAuthSessionAsync(data.url, RETURN_URL);
  return result.type === 'success' ? 'paid' : 'cancelled';
}

export async function fetchConnectStatus(): Promise<{
  chargesEnabled: boolean;
  accountId: string | null;
}> {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'status' },
  });
  if (error) throw error;
  return {
    chargesEnabled: !!data?.chargesEnabled,
    accountId: data?.accountId ?? null,
  };
}

export async function startConnectOnboarding(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'onboard', returnUrl: RETURN_URL },
  });
  if (error) throw error;
  if (!data?.onboardingUrl) throw new Error(data?.error ?? 'Could not open Stripe');
  await WebBrowser.openAuthSessionAsync(data.onboardingUrl, RETURN_URL);
}

/** Operator sets one traveler's own price. Guarded by the existing
 *  `is_trip_host` RLS on group_trip_participants — a member calling this
 *  updates nothing. */
export async function saveTravelerPrice(
  tripId: string,
  userId: string,
  totalUsd: number,
  depositUsd: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_participants')
    .update({ price_total_usd: totalUsd, deposit_usd: depositUsd })
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  if (error) throw error;
}
```

- [ ] **Step 3: Confirm the host can actually update a participant row**

The `saveTravelerPrice` update depends on an existing UPDATE policy allowing the host. Verify:

```sql
select polname, pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy
 where polrelid = 'public.group_trip_participants'::regclass
   and polcmd in ('w', '*');
```

Run it with `mcp__supabase__execute_sql`.

Expected: a policy whose expression includes `is_trip_host(trip_id)`. **If there is none, add one in a follow-up migration** — do not weaken an existing policy:

```sql
create policy gtp_host_sets_price on public.group_trip_participants
  for update to authenticated
  using (public.is_trip_host(trip_id))
  with check (public.is_trip_host(trip_id));
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx jest src/services/trips`
Expected: PASS — the Task 2 tests still green.

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase over the baseline.

- [ ] **Step 5: Stage**

```bash
git add src/services/trips/tripPaymentsService.ts src/hooks/trips/useTripQueries.ts
```

---

### Task 8: Wizard — pick a payment mode and set the deposit

Goes in the **existing budget step**, where `cost_per_person` already lives. No new step.

**Files:**
- Modify: `src/screens/trips/CreateTripFlowA.tsx` — wizard state (~line 374), initial state (~line 436), the budget step body (~line 3030), validation (~line 1713), publish (~line 1930)
- Create: `src/components/trips/ConnectStripeCard.tsx`

**Interfaces:**
- Consumes: `fetchConnectStatus`, `startConnectOnboarding` (Task 7)
- Produces: wizard state fields `paymentMode: 'offline' | 'managed'` and `depositAmount: string`

- [ ] **Step 1: Build the Stripe connect card**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchConnectStatus, startConnectOnboarding } from '../../services/trips/tripPaymentsService';
// showErrorAlert(title, error, fallback) — three arguments. It exists to keep a
// raw `e.message` off the screen; never pass one through by hand.
import { showErrorAlert } from '../../utils/friendlyError';

/**
 * The gate on managed mode. Until Stripe says this operator can accept charges,
 * a trip must not be publishable asking for money it has no way to receive.
 *
 * Status is re-read on every mount because onboarding finishes on Stripe's own
 * site — nothing tells us it happened except asking.
 */
export const ConnectStripeCard: React.FC<{
  onStatusChange: (chargesEnabled: boolean) => void;
}> = ({ onStatusChange }) => {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchConnectStatus();
      setConnected(s.chargesEnabled);
      onStatusChange(s.chargesEnabled);
    } catch {
      setConnected(false);
      onStatusChange(false);
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onConnect = useCallback(async () => {
    try {
      await startConnectOnboarding();
      // The browser sheet closing tells us nothing about whether they finished,
      // so always re-ask Stripe rather than assuming success.
      await refresh();
    } catch (e) {
      showErrorAlert('Stripe', e, 'Could not open Stripe. Try again.');
    }
  }, [refresh]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator />
      </View>
    );
  }

  if (connected) {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <Text style={styles.title}>Stripe connected</Text>
        <Text style={styles.sub}>You can collect payments for this trip.</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onConnect}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.title}>Connect Stripe</Text>
      <Text style={styles.sub}>
        Takes a few minutes. You will need your ID and bank details. Money goes
        straight to you.
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#D5D7DA',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
  },
  cardDone: { borderColor: '#0788B0', backgroundColor: '#F0F7FA' },
  // Instant feedback on press. 0.97 is the app-wide value for pressables.
  pressed: { transform: [{ scale: 0.97 }] },
  title: { fontSize: 15, fontWeight: '600', color: '#181D27' },
  sub: { fontSize: 13, color: '#535862', marginTop: 4, lineHeight: 18 },
});
```

- [ ] **Step 2: Add the wizard state**

In `CreateTripFlowA.tsx`, add to the wizard state type (~line 374, beside `costPerPerson`):

```ts
  /** Flow C only. 'offline' = the app as it is today, no money in it. */
  paymentMode: 'offline' | 'managed';
  /** Blank means one single payment — no deposit row is created at all. */
  depositAmount: string;
```

And to the initial state (~line 436):

```ts
  paymentMode: 'offline',
  depositAmount: '',
```

Add the same two to the edit-mode seed (~line 619) so the fields exist in edit mode even though the Requirements step is create-only:

```ts
  paymentMode: (trip.payment_mode as 'offline' | 'managed') ?? 'offline',
  depositAmount: trip.deposit_amount != null ? String(trip.deposit_amount) : '',
```

- [ ] **Step 3: Render the choice in the budget step**

In the budget step body, immediately after the `errors.price` line (~line 3054), insert:

```tsx
        {isFixedFlow && (
          <>
            <Text style={[localStyles.sectionTitle, localStyles.groupTopGap]}>
              Getting paid
            </Text>
            <View style={localStyles.summaryGroup}>
              <Pressable
                onPress={() => update('paymentMode', 'offline')}
                style={({ pressed }) => [
                  localStyles.payModeRow,
                  state.paymentMode === 'offline' && localStyles.payModeRowOn,
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                <Text style={localStyles.payModeTitle}>I'll handle payment myself</Text>
                <Text style={localStyles.payModeSub}>
                  Travelers pay you outside the app, however you do it today.
                </Text>
              </Pressable>

              <Pressable
                onPress={() => update('paymentMode', 'managed')}
                style={({ pressed }) => [
                  localStyles.payModeRow,
                  state.paymentMode === 'managed' && localStyles.payModeRowOn,
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                <Text style={localStyles.payModeTitle}>Collect payment in Swellyo</Text>
                <Text style={localStyles.payModeSub}>
                  Travelers pay by card. A deposit now, the rest before the trip.
                </Text>
              </Pressable>
            </View>

            {state.paymentMode === 'managed' && (
              <>
                <ConnectStripeCard onStatusChange={setStripeReady} />

                <Text style={[localStyles.sectionTitle, localStyles.groupTopGap]}>
                  Deposit · {operatorCurrency === 'ILS' ? '₪' : 'USD'}
                </Text>
                <Text style={localStyles.helper}>
                  Leave this blank to take one single payment.
                </Text>
                <View style={localStyles.priceRow}>
                  <TextInput
                    style={[localStyles.input, { flex: 1 }]}
                    value={state.depositAmount}
                    onChangeText={t => update('depositAmount', t.replace(/[^0-9]/g, ''))}
                    placeholder="500"
                    placeholderTextColor={COLORS.textPlaceholder}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>
                {errors.deposit ? (
                  <Text style={localStyles.errorText}>{errors.deposit}</Text>
                ) : null}
              </>
            )}
          </>
        )}
```

Add near the other wizard hooks:

```tsx
  const [stripeReady, setStripeReady] = useState(false);
```

And these styles to `localStyles`:

```ts
  payModeRow: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  payModeRowOn: { borderColor: '#0788B0', backgroundColor: '#F0F7FA' },
  payModeTitle: { fontSize: 15, fontWeight: '600', color: '#181D27' },
  payModeSub: { fontSize: 13, color: '#535862', marginTop: 2, lineHeight: 18 },
```

- [ ] **Step 4: Validate the budget step**

In `validateStep`, inside `case 'budget':` (~line 1713), after the existing price check:

```ts
        if (isFixedFlow && state.paymentMode === 'managed') {
          // Publishing a trip that asks for money it cannot receive is the one
          // failure with no recovery for the traveler.
          if (!stripeReady) {
            setError('deposit', 'Connect Stripe before collecting payment in the app.');
            return false;
          }
          const price = state.costPerPerson ? parseInt(state.costPerPerson, 10) : 0;
          const dep = state.depositAmount ? parseInt(state.depositAmount, 10) : 0;
          if (dep > price) {
            setError('deposit', 'The deposit cannot be more than the price.');
            return false;
          }
        }
```

- [ ] **Step 5: Save the two columns on publish**

In both the create and update payloads (~line 1939 and ~line 1996), beside `cost_per_person: fixedPrice`:

```ts
          payment_mode: isFixedFlow ? state.paymentMode : 'offline',
          deposit_amount:
            isFixedFlow && state.paymentMode === 'managed' && state.depositAmount
              ? parseInt(state.depositAmount, 10)
              : null,
```

- [ ] **Step 6: Create the two pay requirement rows on publish**

In the requirements block (~line 2014), the pay rows must be created **after** the trip row exists, because `trg_pay_requires_managed_trip` reads `payment_mode` off it.

Extend the kinds passed to `createRequirements`:

```ts
        // Money rows are added to whatever documents the operator picked. The
        // deposit row only exists when there is a deposit — a trip taking one
        // single payment gets a balance row for the full price, never a
        // zero-value deposit row.
        const payKinds: RequirementKind[] =
          state.paymentMode === 'managed'
            ? state.depositAmount
              ? ['deposit', 'balance']
              : ['balance']
            : [];
```

Then pass `[...payKinds, ...state.requirementKinds]` where `state.requirementKinds` is passed today.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase over the baseline.

- [ ] **Step 8: Stage**

```bash
git add src/screens/trips/CreateTripFlowA.tsx src/components/trips/ConnectStripeCard.tsx
```

Tell Ohad this needs a device test: create a flow-C trip, pick "Collect payment in Swellyo", connect a Stripe **test** account, set a deposit, publish, and confirm two pay rows exist:

```sql
select kind, req_type, skip_at_onboarding, deadline_days_before
  from public.organized_trip_requirements
 where trip_id = '<the new trip>' and req_type = 'pay';
```

---

### Task 9: Plan tab — show the amount and a Pay button

**Files:**
- Modify: `src/components/trips/plan/PlanSections.tsx` — `DocumentRow` type (~line 748), `DOC_ICON` (~line 773), `statusFor` (~line 794)
- Modify: `src/screens/trips/TripDetailScreen.tsx` — build the rows, handle the press

**Interfaces:**
- Consumes: `amountOutstanding`, `startCheckout`, `fetchTravelerPrices`, `fetchPaidByRequirement` (Tasks 2, 7)
- Produces: `DocumentRow.amountUsd?: number | null`

- [ ] **Step 1: Carry an amount on the row**

In `PlanSections.tsx`, add to the `DocumentRow` type (~line 748):

```ts
  /** Pay rows only — what is still owed, in canonical USD. Null when the
   *  traveler has no price set yet. */
  amountUsd?: number | null;
```

Add the two icons to `DOC_ICON` (~line 773):

```ts
  deposit: 'card-outline',
  balance: 'card-outline',
```

- [ ] **Step 2: Give pay rows their own verb**

In `statusFor` (~line 794), after the `medical` branch and before the final `return base`:

```ts
  // "Add" is the wrong verb for money, and a pay row is never "in review" —
  // it is paid or it is not.
  if (row.kind === 'deposit' || row.kind === 'balance') {
    return row.state === 'overdue'
      ? { label: 'Pay — late', tone: 'bad' }
      : { label: 'Pay', tone: 'accent' };
  }
```

- [ ] **Step 3: Show the amount beside the title**

Find where the row renders its title in the member branch of `TripDocumentsCard`, and render the amount after it:

```tsx
              {row.amountUsd != null && (
                <Text style={styles.docAmount}>
                  {formatPrice(row.amountUsd, budgetFxRate, viewerCountry) ?? ''}
                </Text>
              )}
```

Add the style:

```ts
  docAmount: { fontSize: 13, color: '#535862', marginTop: 2 },
```

`formatPrice` lives in `src/utils/currency.ts` with the signature
`formatPrice(usdAmount, fxRate, viewerCountry): string | null` — it returns
**null** for a null amount, hence the `?? ''`. It is already used this way at
`TripsScreen.tsx:400`. Add `budgetFxRate` and `viewerCountry` as props on
`TripDocumentsCard` and pass them down from `TripDetailScreen.tsx`; do not reach
for screen state inside `PlanSections.tsx`.

- [ ] **Step 4: Feed the amounts in from the screen**

In `TripDetailScreen.tsx`, where `documentRows` is built, join the payment data:

```tsx
  const paymentsQuery = useQuery({
    queryKey: tripsKeys.payments(tripId, myUserId),
    enabled: !!tripId && !!myUserId && trip?.payment_mode === 'managed',
    queryFn: async () => {
      const [prices, paid] = await Promise.all([
        fetchTravelerPrices(tripId, myUserId),
        fetchPaidByRequirement(tripId, myUserId),
      ]);
      return { prices, paid };
    },
    // Money must never be read from a stale cache.
    staleTime: 0,
  });
```

Then, when mapping requirements to `DocumentRow`:

```tsx
    amountUsd:
      r.reqType === 'pay' && paymentsQuery.data
        ? amountOutstanding(
            r.kind as PayStep,
            paymentsQuery.data.prices,
            paymentsQuery.data.paid[r.requirementId] ?? 0,
          )
        : null,
```

- [ ] **Step 5: Handle the press**

In the existing `onPressRow` handler, add a branch before the upload/agree/medical branches:

```tsx
    if (row.reqType === 'pay') {
      try {
        await startCheckout(row.requirementId);
      } catch (e) {
        showErrorAlert('Payment', e, 'Could not start the payment. Try again.');
        return;
      }
      // The browser closing is NOT proof of payment — Stripe rejects custom URL
      // schemes so there is no trustworthy redirect back. The webhook is the
      // only truth. Refetch, and give it a moment to land.
      //
      // `detailDocuments` is the traveler's own requirement list (it wraps
      // fetchMyRequirements). There is no `myRequirements` key — do not invent one.
      await queryClient.refetchQueries({ queryKey: tripsKeys.payments(tripId, myUserId) });
      await queryClient.refetchQueries({ queryKey: tripsKeys.detailDocuments(tripId) });
      return;
    }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase over the baseline.

- [ ] **Step 7: Stage**

```bash
git add src/components/trips/plan/PlanSections.tsx src/screens/trips/TripDetailScreen.tsx
```

Tell Ohad this needs a device test with a Stripe **test** card (`4242 4242 4242 4242`): open the Plan tab on a managed trip, tap the deposit row, pay, come back, and confirm the row turns green within a few seconds.

---

### Task 10: Operator edits one traveler's price

The whole point of per-traveler pricing. One sheet, opened from the member view.

**Files:**
- Create: `src/components/trips/TravelerPriceSheet.tsx`
- Modify: `src/components/trips/TripMemberSheet.tsx` — add the way in

**Interfaces:**
- Consumes: `fetchTravelerPrices`, `fetchPaidByRequirement`, `saveTravelerPrice` (Task 7), `amountDue` (Task 2)
- Produces: `<TravelerPriceSheet visible tripId userId onClose />`

- [ ] **Step 1: Build the sheet**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// Lives at src/components/BottomSheetShell.tsx — one level up from trips/.
import { BottomSheetShell } from '../BottomSheetShell';
import {
  amountDue,
  fetchPaidByRequirement,
  fetchTravelerPrices,
  saveTravelerPrice,
} from '../../services/trips/tripPaymentsService';
import { showErrorAlert } from '../../utils/friendlyError';

/**
 * One traveler's own price.
 *
 * The trip price is only a default — this is what they actually owe, and it was
 * frozen onto their participant row when they joined. Editing here affects
 * nobody else, which is exactly the point: operators agree different prices
 * with different people.
 *
 * Raising the price of someone who already paid REOPENS their balance for the
 * difference. That is intended (an operator adding services mid-trip), but it
 * surprises people, so it is said out loud before saving.
 */
export const TravelerPriceSheet: React.FC<{
  visible: boolean;
  tripId: string;
  userId: string;
  travelerName: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, tripId, userId, travelerName, onClose, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState('');
  const [deposit, setDeposit] = useState('');
  const [paid, setPaid] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [prices, paidMap] = await Promise.all([
          fetchTravelerPrices(tripId, userId),
          fetchPaidByRequirement(tripId, userId),
        ]);
        if (cancelled) return;
        setTotal(prices.totalUsd != null ? String(prices.totalUsd) : '');
        setDeposit(prices.depositUsd != null ? String(prices.depositUsd) : '');
        setPaid(Object.values(paidMap).reduce((s, n) => s + n, 0));
      } catch (e) {
        if (!cancelled) showErrorAlert('Price', e, 'Could not load this price.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tripId, userId]);

  const save = useCallback(async () => {
    const t = parseInt(total, 10);
    const d = deposit ? parseInt(deposit, 10) : null;

    if (!Number.isFinite(t) || t < 0) {
      Alert.alert('Set a total price first.');
      return;
    }
    if (d != null && d > t) {
      Alert.alert('The deposit cannot be more than the total.');
      return;
    }

    const commit = async () => {
      setSaving(true);
      try {
        await saveTravelerPrice(tripId, userId, t, d);
        onSaved();
        onClose();
      } catch (e) {
        showErrorAlert('Price', e, 'Could not save this price.');
      } finally {
        setSaving(false);
      }
    };

    // Only warn when it actually reopens something. Lowering a price, or
    // editing someone who has paid nothing, needs no ceremony.
    if (paid > 0 && t > paid) {
      Alert.alert(
        'Ask for more money?',
        `${travelerName} has paid ${paid}. Raising their price to ${t} will ask them for the difference.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Ask for it', onPress: commit },
        ],
      );
      return;
    }
    await commit();
  }, [total, deposit, paid, tripId, userId, travelerName, onClose, onSaved]);

  const balance = amountDue('balance', {
    totalUsd: parseInt(total, 10) || null,
    depositUsd: deposit ? parseInt(deposit, 10) : null,
  });

  return (
    // No `title` prop exists on BottomSheetShell — the heading is yours to
    // render. `avoidKeyboard` is required here: this sheet has text inputs.
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 32 }} />
      ) : (
        <View style={styles.body}>
          <Text style={styles.heading}>{travelerName}'s price</Text>
          <Text style={styles.label}>Total · USD</Text>
          <TextInput
            style={styles.input}
            value={total}
            onChangeText={t => setTotal(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="2000"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Deposit · USD</Text>
          <TextInput
            style={styles.input}
            value={deposit}
            onChangeText={t => setDeposit(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="500"
          />

          <Text style={styles.summary}>
            Final payment: {balance ?? 0} · Paid so far: {paid}
          </Text>

          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [
              styles.save,
              pressed && { transform: [{ scale: 0.97 }] },
              saving && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 20 },
  heading: { fontSize: 18, fontWeight: '600', color: '#181D27', marginBottom: 16 },
  label: { fontSize: 13, color: '#535862', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#181D27',
  },
  summary: { fontSize: 13, color: '#535862', marginTop: 16 },
  save: {
    backgroundColor: '#0788B0',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
```

`BottomSheetShell` is mandatory — the bottom-sheet effect is global and every sheet must use it.

- [ ] **Step 2: Open it from the member sheet**

In `TripMemberSheet.tsx`, add a row visible only to the host on a managed trip:

```tsx
        {isHost && trip?.payment_mode === 'managed' && (
          <Pressable
            onPress={() => setPriceOpen(true)}
            style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.97 }] }]}
          >
            <Text style={styles.rowText}>Price</Text>
          </Pressable>
        )}
```

Mount the sheet on `isHost` alone, **never** on data it invalidates — mounting a sheet on volatile query data is what caused the Plan-tab touch lock:

```tsx
      {isHost && (
        <TravelerPriceSheet
          visible={priceOpen}
          tripId={tripId}
          userId={member.userId}
          travelerName={member.name}
          onClose={() => setPriceOpen(false)}
          onSaved={() =>
            queryClient.refetchQueries({ queryKey: tripsKeys.payments(tripId, member.userId) })
          }
        />
      )}
```

⚠️ `TravelerPriceSheet` renders through `BottomSheetShell`, which is a `Modal`. If `TripMemberSheet` is itself a `Modal`, this must be rendered **inside** it, not as a sibling after `</Modal>` — two RN Modals dismissing in overlapping frames strand an invisible view controller on iOS that silently eats every touch on the screen beneath. Check where `TripMemberSheet`'s `</Modal>` closes before placing this.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase over the baseline.

- [ ] **Step 4: Run the full test suite**

Run: `npx jest src/services/trips src/hooks/trips src/screens/trips`
Expected: no new failures against the pre-existing baseline (2 suites / 5 tests were already failing before this work).

- [ ] **Step 5: Stage**

```bash
git add src/components/trips/TravelerPriceSheet.tsx src/components/trips/TripMemberSheet.tsx
```

---

### Task 11: ManageRequirementsSheet — pay rows after publish

The operator can already edit which documents a published trip asks for. The two pay rows must appear there too, so their deadlines can be changed after publishing.

**Files:**
- Modify: `src/components/trips/ManageRequirementsSheet.tsx`

**Interfaces:**
- Consumes: `REQUIREMENT_CATALOG` with the two new kinds (Task 3)
- Produces: nothing new

- [ ] **Step 1: Let pay rows into the sheet, but not the toggle**

The sheet builds its list from `REQUIREMENT_ORDER`, so `deposit` and `balance` now appear automatically. Two things must change.

Toggling a pay row off is not the same as removing a document requirement — it stops the trip collecting money people may have already paid. Render pay rows with their timing controls but **no on/off toggle**:

```tsx
  // Money rows are not toggled here. Turning off collection is a trip-level
  // decision (payment_mode), and deleting a pay row with payments against it
  // would strand ledger history pointing at nothing.
  const isPayKind = (k: string) => k === 'deposit' || k === 'balance';
```

Where the toggle renders, gate it with `!isPayKind(kind)`. Where the row body renders, keep the timing controls for all kinds.

- [ ] **Step 2: Hide the pay rows entirely on an offline trip**

```tsx
  const kinds = REQUIREMENT_ORDER.filter(
    k => !isPayKind(k) || paymentMode === 'managed',
  );
```

Add `paymentMode` to the sheet's props and pass `trip?.payment_mode ?? 'offline'` from `TripDetailScreen.tsx`.

- [ ] **Step 3: Keep `saveRequirementChanges` away from pay rows**

`saveRequirementChanges` diffs on/off state: a kind in `existing` but not in the
draft gets removed. Pay rows are never in the draft's `on` array (they have no
toggle), so without this guard **every save would delete them** — and their
ledger rows would be left pointing at nothing.

In `tripDocumentsService.ts`, in the loop over `existing` that already skips
kinds outside the catalog (~line 563), add the guard **before** the catalog
check:

```ts
    // Pay rows are created at publish; only their TIMING is editable here, and
    // they never appear in the draft's on/off list. Without this `continue`,
    // the diff reads them as "turned off" and deletes them on every save.
    if (r.req_type === 'pay') continue;
```

Then, in the loop over the draft that inserts or updates each kind, skip them
there too so a timing edit updates rather than re-inserts (which would fail on
`uq_organized_trip_req_kind_per_trip` with a 23505):

```ts
  for (const d of draft) {
    if (d.kind === 'deposit' || d.kind === 'balance') {
      // Timing only. The row already exists and must not be re-created.
      const row = existing.find(r => r.kind === d.kind);
      if (!row) continue;
      await supabase
        .from('organized_trip_requirements')
        .update(timingColumns(d.timing))
        .eq('id', row.id);
      continue;
    }
    // …existing insert/update/remove logic unchanged…
  }
```

`timingColumns()` already exists in this file and enforces the
`skip_at_onboarding` / `deadline_days_before` pairing that
`organized_trip_req_deadline_rule` requires — use it rather than writing the two
columns by hand, or a mismatched pair raises 23514.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase over the baseline.

Run: `npx jest src/services/trips`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/components/trips/ManageRequirementsSheet.tsx src/services/trips/tripDocumentsService.ts src/screens/trips/TripDetailScreen.tsx
```

---

## Device test script — for Ohad, after Task 11

Run against a trip whose members are all dev accounts. Group trips are live on production.

1. Create a flow-C trip, budget step → "Collect payment in Swellyo", connect a Stripe **test** account, deposit `500`, price `2000`. Publish.
2. Check two pay rows exist and their timing is right:
   ```sql
   select kind, skip_at_onboarding, deadline_days_before
     from public.organized_trip_requirements
    where trip_id = '<trip>' and req_type = 'pay';
   ```
   Expect `deposit / must_have / null` and `balance / skippable / 30`.
3. Join with a second dev account. Plan tab shows **Deposit $500** and **Final payment $1500**.
4. Tap Deposit → pay with `4242 4242 4242 4242` → back. The row turns green within a few seconds.
5. As the host, open that traveler → Price → change the total to `2400` → confirm the warning appears → save.
6. The traveler's Plan tab now shows **Final payment $1900**.
7. Refund the charge in the Stripe dashboard. The deposit row goes back to "Pay" on its own.
8. Switch the trip to offline mode. The pay rows disappear; the ledger rows still exist:
   ```sql
   select count(*) from public.organized_trip_payment_events where trip_id = '<trip>';
   ```

---

## Before real money moves — not in this plan

1. **Turn on 3DS and Stripe Radar** in the Stripe dashboard. Chargebacks land on Swellyo, not the operator, and the research prices them near $750/month at $50k GMV.
2. **Decide the deposit refund policy** with the design-partner operator. A non-refundable deposit is the single biggest chargeback mitigation, but it is a promise made on the operator's behalf.
3. **Swap the Stripe test key for the live key** (`supabase secrets set STRIPE_SECRET_KEY=sk_live_...`) and create a **separate live webhook endpoint** with its own signing secret.
