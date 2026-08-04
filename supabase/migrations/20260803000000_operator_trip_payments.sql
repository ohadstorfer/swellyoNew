-- Stripe payments for operator trips.
-- Spec: docs/superpowers/specs/2026-08-03-stripe-payments-operator-trips-design.md
--
-- Nothing here modifies an existing column or policy on group_trip_participants
-- or users beyond what section 3 adds. Every A and B trip, and every existing
-- C trip, behaves exactly as before until an operator opts in.
--
-- Fix round 1 (2026-08-03) folded in here, against the brief's original SQL:
--   C1 — freeze_traveler_price() made authoritative against non-host writes.
--   C2 — payout identity moved off `users` into operator_payout_accounts.
--   I1 — ledger amount sign now matches event_type; pay_state ignores 'failed'.
--   I2 — dedup index on (provider, provider_object_id, event_type) --
--        scope corrected in round 4, see below; it originally also covered
--        'refunded' rows and blocked legitimate second partial refunds.
--   I4 — authenticated no longer has execute on either new/replaced RPC.
--   I5 — trip-level deposit cannot exceed price; a balance that would go
--        negative returns NULL (unknown), not a floored 0 -- see round 2 below.
--   I6 — req_type = 'pay' now implies kind in ('deposit', 'balance') and vice versa.
--   minor — ledger + trigger-function revokes now cover authenticated too
--           (default ACL grants it write/execute, matching 20260729000200);
--           ledger gets is_livemode.
--
-- Round 2 (2026-08-03): the balance branch of operator_traveler_amount_due
-- originally floored at `greatest(..., 0)`. GREATEST ignores NULL
-- arguments, so a managed trip with no price configured anywhere silently
-- read as 0 owed (approved) instead of NULL (not_started). Replaced with
-- explicit NULL semantics: no price anywhere, or a negative raw balance
-- (deposit exceeds price), both return NULL and refuse to guess. A genuine
-- balance of exactly 0 still returns 0 and still correctly approves.
--
-- Round 3 (2026-08-03): comment-only reconciliation -- two comments below
-- still described the round-1 "floored at zero" behaviour after round 2
-- deleted it. No SQL changed in this round.
--
-- Round 4 (2026-08-03): uq_otpe_object (section 5) rescoped to
-- event_type = 'paid' only. It previously also covered 'refunded' rows,
-- which blocked a legitimate second partial refund against the same
-- payment_intent and turned it into a permanent-ish webhook retry storm.
-- See the comment at the index itself for the full reasoning.
--
-- Round 5 (2026-08-03), whole-branch review -- seams between tasks that each
-- reviewed clean on their own:
--   C3 — price attribution. `group_trip_participants` gains price_set_by /
--        price_set_at (section 3), stamped by operator_set_traveler_price
--        (20260803000100). Motivated by the same finding that moved that
--        RPC's authorisation off is_trip_host() and onto
--        group_trips.host_id: "host" is flat multi-host (every promoted
--        admin), "operator who gets paid" is host_id alone, and the branch
--        was mixing the two. freeze_traveler_price below now also pins the
--        two new columns against a non-host self-PATCH, so the attribution
--        cannot be forged by the person whose price it records.
--   I1 — is_livemode was written and never read. operator_requirement_pay_state
--        (section 7) now counts only rows matching the expected Stripe mode.
--        See the comment there for the app.stripe_livemode switch.

-- ══════════════════════════════════════════════════════════════════
-- 1. Operator payout identity — its own table, not columns on `users`
-- ══════════════════════════════════════════════════════════════════
-- NOT on public.users. `users_update_own` has no column scope and
-- `users_select_authenticated` is `using (true)`, so any column added to
-- `users` here would be self-writable by every traveler and world-readable.
-- A separate table with its own RLS (no write policy at all) is the only
-- way to keep this operator-only and private without touching users' grants
-- — six unrelated features already write to that table.
create table if not exists public.operator_payout_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  provider           text not null default 'stripe',
  stripe_account_id  text,
  charges_enabled    boolean not null default false,
  -- Basis points, so 1200 = 12%. An integer avoids the float-rounding
  -- argument entirely when the fee is computed in cents.
  commission_bps     integer not null default 1200 check (commission_bps between 0 and 10000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.operator_payout_accounts enable row level security;

revoke all    on public.operator_payout_accounts from anon, authenticated, public;
grant  select on public.operator_payout_accounts to   authenticated;

-- Read only, and only your own row. No insert/update/delete policy at all:
-- only the service role (the Stripe onboarding edge functions) writes.
drop policy if exists opa_read_own on public.operator_payout_accounts;
create policy opa_read_own on public.operator_payout_accounts
  for select to authenticated
  using (user_id = auth.uid());

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

-- I5: a deposit larger than the price would make `balance` negative.
-- operator_traveler_amount_due (section 6) treats a negative raw balance as
-- an unknown/contradictory configuration and returns NULL rather than
-- guessing -- this CHECK stops the trip-level half of that combination at
-- the source. Mirrors the identical per-traveler check in section 3, which
-- covers the frozen-participant half; operator_traveler_amount_due's NULL
-- branch is still what closes the mixed-coalesce case neither CHECK alone
-- can see (a frozen price_total_usd against this trip's own deposit_amount).
alter table public.group_trips
  drop constraint if exists group_trips_deposit_not_over_price;
alter table public.group_trips
  add constraint group_trips_deposit_not_over_price
  check (deposit_amount is null
      or cost_per_person is null
      or deposit_amount <= cost_per_person);

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

-- C3 (round 5): who set this price, and when. Prices are neither versioned
-- nor logged anywhere else, so without these a price change is invisible
-- after the fact — the exact reason the "a promoted admin zeroes their own
-- price" finding was undiscoverable rather than merely possible. Stamped by
-- operator_set_traveler_price (20260803000100), which is the only authorised
-- producer of a price write; freeze_traveler_price (section 8) pins both
-- columns against a non-host PATCH so the record cannot be forged by the
-- traveler it describes. Nullable: every row that predates this feature, and
-- every price frozen automatically at join time by the trigger rather than
-- set by a human, legitimately has no setter.
alter table public.group_trip_participants
  add column if not exists price_set_by uuid references auth.users(id) on delete set null,
  add column if not exists price_set_at timestamptz;

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

-- I6: req_type = 'pay' and kind in ('deposit', 'balance') were previously
-- independent. A kind = 'custom', req_type = 'pay' row was constructible and
-- permanently unsatisfiable — on a must_have item that would block onboarding
-- with no way through.
alter table public.organized_trip_requirements
  drop constraint if exists organized_trip_requirements_pay_kind_match;
alter table public.organized_trip_requirements
  add constraint organized_trip_requirements_pay_kind_match
  check ((req_type = 'pay') = (kind in ('deposit', 'balance')));

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

-- SECURITY DEFINER keeps the default PUBLIC execute grant, which also
-- reaches anon and authenticated by default. Revoke all three, matching
-- 20260729000200 — only the trigger ever needs to run this.
revoke execute on function public.enforce_pay_requires_managed_trip()
  from public, anon, authenticated;

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
  -- Stripe test-mode events must never be mistaken for real money.
  is_livemode         boolean not null default false,
  created_at          timestamptz not null default now(),
  -- I1: a 'failed' row carrying the attempted amount would still count
  -- toward the paid sum if the sign were left to convention instead of
  -- enforced. Pinning the sign to the type here means the CHECK is the
  -- single source of truth, not the webhook handler's discipline.
  constraint otpe_amount_sign_matches_type check (
    (event_type = 'paid'     and amount_usd > 0) or
    (event_type = 'refunded' and amount_usd < 0) or
    (event_type = 'failed'   and amount_usd = 0)
  )
);

-- What makes the webhook safe to retry. Stripe redelivers events; the second
-- insert fails on this index and the handler swallows it.
create unique index if not exists uq_otpe_provider_event
  on public.organized_trip_payment_events (provider, provider_event_id);

-- I2: uq_otpe_provider_event stops REdelivery of the same event id. It does
-- not stop two different Stripe event ids describing the same underlying
-- charge/refund object, which would double-count. Table is still empty, so
-- this is free to add now.
--
-- Round 4 correction: scoped to event_type = 'paid' only. 'paid' and
-- 'refunded' are NOT the same shape of risk here and must not share this
-- index. A charge/payment_intent is charged once, so a second 'paid' row
-- against the same provider_object_id really is a duplicate (two Stripe
-- event ids describing the same charge) and must be refused.
-- charge.refunded is different: it fires once per refund and carries a
-- CUMULATIVE amount_refunded, so the webhook records each refund as a
-- DELTA against what is already stored -- meaning every partial refund
-- against the same payment_intent legitimately shares
-- (provider, provider_object_id, event_type = 'refunded'). Under the
-- original unscoped predicate, a second partial refund's key collided with
-- the first, the insert raised 23505 (not a redelivery -- a real, distinct
-- row), the webhook does not swallow 23505 (it isn't in the permanent-error
-- list, correctly, since this is not the redelivery case
-- uq_otpe_provider_event exists for), and Stripe retried the same doomed
-- delta on backoff for about three days. Net effect: the refund never
-- reached the ledger AND produced a retry storm. Refunds don't need this
-- index for correctness anyway -- uq_otpe_provider_event already makes a
-- redelivered refund event a no-op, and the delta arithmetic sums correctly
-- across any number of legitimate partial refunds. Drop + recreate, not
-- `if not exists`: this migration is re-runnable, and an existing index
-- with the old (wrong) predicate would otherwise silently survive a rerun.
drop index if exists public.uq_otpe_object;
create unique index uq_otpe_object
  on public.organized_trip_payment_events (provider, provider_object_id, event_type)
  where event_type = 'paid' and provider_object_id is not null;

create index if not exists idx_otpe_lookup
  on public.organized_trip_payment_events (trip_id, user_id, requirement_id);

alter table public.organized_trip_payment_events enable row level security;

-- Default ACL on this project grants `anon` AND `authenticated` write
-- privileges on new tables; revoking only `anon, public` would leave
-- `authenticated` holding them (RLS blocks writes today, but TRUNCATE is not
-- RLS-gated). Revoke all three, then grant back only what's intended.
revoke all    on public.organized_trip_payment_events from anon, authenticated, public;
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
--
-- Round 2 correction: an earlier version of this function floored the
-- balance branch at `greatest(..., 0)`. GREATEST ignores NULL arguments, so
-- `greatest(null - x, 0)` is `0`, not NULL -- a managed trip with no price
-- configured anywhere (cost_per_person null, every existing participant's
-- price_total_usd null) would read as "0 owed", and
-- operator_requirement_pay_state's `amount is null -> not_started` guard
-- would never fire, falling through to `0 >= 0 -> approved`. Every existing
-- traveler on a trip an operator had just flipped to managed, before
-- filling in a price, would read as fully paid.
--
-- A negative raw balance (deposit exceeds price -- the case I5 actually
-- cares about, including the mixed-coalesce combination the trip-level
-- CHECK cannot see: a frozen price_total_usd with a NULL deposit_usd
-- falling back to a larger trip-level deposit_amount) is a contradictory
-- configuration. The right answer to "how much is owed" there is unknown,
-- not zero -- zero reads as fully paid to every consumer. A genuine
-- balance of exactly 0 (deposit equals total) still returns 0 and still
-- correctly reads as approved, because there really is nothing left owed.
create or replace function public.operator_traveler_amount_due(
  p_trip_id uuid, p_user_id uuid, p_kind text
) returns numeric
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with base as (
    select
      coalesce(p.price_total_usd, t.cost_per_person) as price,
      coalesce(p.deposit_usd, t.deposit_amount)       as deposit,
      coalesce(p.deposit_usd, t.deposit_amount, 0)    as deposit_or_zero
    from public.group_trips t
    left join public.group_trip_participants p
      on p.trip_id = t.id and p.user_id = p_user_id
    where t.id = p_trip_id
  )
  select case p_kind
    when 'deposit' then deposit
    when 'balance' then
      case
        when price is null then null
        when (price - deposit_or_zero) < 0 then null
        else price - deposit_or_zero
      end
    else null
  end
  from base;
$$;

-- I4: no grant to authenticated. Nothing needs it — this is only ever
-- called from inside another SECURITY DEFINER function (which runs as
-- owner) or from the service role, neither of which is gated by this grant.
-- Leaving `authenticated` able to call it directly would let any trip member
-- read what a different traveler on the same trip owes.
revoke execute on function public.operator_traveler_amount_due(uuid, uuid, text)
  from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 7. Pay state — replaces the v1 stub
-- ══════════════════════════════════════════════════════════════════
-- The stub's comment promised: "the payments spec replaces the body with a read
-- of the ledger. The signature never changes." This is that. Every caller of
-- operator_trip_my_requirements keeps working untouched.
--
-- I1 (round 5): `is_livemode` was written by the webhook and read by nothing,
-- so a Stripe TEST-mode payment counted as real money everywhere. That is not
-- hypothetical: the device test for this feature runs test keys against the
-- PRODUCTION database, writing permanent `paid` rows that would flip real
-- must_have requirements to `approved` and survive into live operation.
--
-- The sum below now only counts rows whose mode matches
-- `app.stripe_livemode`. That setting is deliberately UNSET today, and the
-- `coalesce(..., false)` default means test-mode rows are what counts — so
-- the device test behaves exactly as intended. When the live Stripe key is
-- installed, run:
--
--   alter database postgres set app.stripe_livemode = 'true';
--
-- (new sessions pick it up; `select pg_reload_conf()` is not needed for a
-- database-level SET, but existing pooled sessions must turn over). From that
-- moment every test-mode row stops counting instantly, with no data deleted
-- and nothing to migrate — and flipping it back is equally instant if the
-- go-live is aborted. Deleting the test rows instead would destroy the only
-- record that the test payments happened.
--
-- `current_setting(..., true)` (missing_ok) is required: an unset GUC raises
-- 42704 otherwise, and this function is STABLE and called per-requirement
-- from operator_trip_my_requirements — one raise would break the traveler's
-- whole plan tab, not just the pay row.
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
       -- I1: belt-and-suspenders with otpe_amount_sign_matches_type, which
       -- already pins a 'failed' row's amount to 0. Excluding the event
       -- type outright means this sum never depends on that CHECK holding.
       and event_type     <> 'failed'
       -- I1 (round 5): only money from the Stripe mode we currently treat as
       -- real. See the header comment above this function for the switch.
       -- nullif(..., '') as well as missing_ok: an unset GUC reads as NULL,
       -- but one that was set and then cleared reads as the empty string, and
       -- ''::boolean raises 22P02 rather than defaulting.
       and is_livemode    = coalesce(
                              nullif(current_setting('app.stripe_livemode', true), '')::boolean,
                              false)
  )
  select case
    -- No price set for this traveler yet: nothing can be owed, so nothing is due.
    when (select amount from due) is null then 'not_started'
    when (select total from paid) >= (select amount from due) then 'approved'
    else 'not_started'
  end;
$$;

-- I4: no grant to authenticated, same reasoning as operator_traveler_amount_due
-- above — without it, a trip member cannot read another traveler's pay state.
revoke execute on function public.operator_requirement_pay_state(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 8. Freeze the price when a traveler joins — and pin it against tampering
-- ══════════════════════════════════════════════════════════════════
-- Copying the trip price onto the participant row at join time is what makes a
-- later price edit harmless to people already on the trip — the same reason an
-- order line stores its own amount instead of pointing at the product.
--
-- C1: `group_trip_participants` grants `authenticated` full UPDATE, and its
-- policy is `using (auth.uid() = user_id)` with a WITH CHECK that pins only
-- `role`. RLS cannot scope columns, so without this trigger a traveler could
-- PATCH their own row to `price_total_usd = 0, deposit_usd = 0` and read as
-- paid. Per Ohad's ruling: fix it here, not by touching grants on a live
-- table six other features write to. This trigger is now the sole authority
-- on these two columns for anyone who isn't a host or the service role.
create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  -- auth.uid() is null under the service role -- treat that as trusted the
  -- same as a host, rather than assuming a JWT is always present.
  if auth.uid() is not null and not public.is_trip_host(new.trip_id) then
    if TG_OP = 'UPDATE' then
      -- A traveler's PATCH succeeds (other columns still apply); these four
      -- silently do not move.
      new.price_total_usd := old.price_total_usd;
      new.deposit_usd     := old.deposit_usd;
      -- C3 (round 5): the attribution columns are pinned for the same reason
      -- as the amounts. `group_trip_participants` grants `authenticated`
      -- full UPDATE with a self-only policy and no column scope, so without
      -- this a traveler could PATCH price_set_by to point at the operator —
      -- forging the record of who set their price. A record the subject can
      -- rewrite is not a record.
      new.price_set_by    := old.price_set_by;
      new.price_set_at    := old.price_set_at;
      return new;
    end if;

    -- INSERT, non-host: always the trip defaults, never a caller-supplied
    -- value. No "explicit price wins" escape hatch for anyone but a host.
    -- A price frozen automatically at join time was set by nobody, so the
    -- attribution stays null whichever branch below runs — and a joiner
    -- cannot seed it with a value of their own choosing either.
    new.price_set_by := null;
    new.price_set_at := null;

    select payment_mode, cost_per_person, deposit_amount
      into v_mode, v_price, v_dep
      from public.group_trips
     where id = new.trip_id;

    if v_mode is distinct from 'managed' then
      new.price_total_usd := null;
      new.deposit_usd     := null;
      return new;
    end if;

    new.price_total_usd := v_price;
    new.deposit_usd     := v_dep;
    return new;
  end if;

  -- Host or service role: may set both freely.
  if TG_OP = 'UPDATE' then
    return new;
  end if;

  -- INSERT, host or service role: an explicit price passed in wins; never
  -- overwrite a deliberate value.
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

revoke execute on function public.freeze_traveler_price()
  from public, anon, authenticated;

drop trigger if exists trg_freeze_traveler_price on public.group_trip_participants;
create trigger trg_freeze_traveler_price
  before insert or update on public.group_trip_participants
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

revoke execute on function public.deactivate_pay_rows_when_offline()
  from public, anon, authenticated;

drop trigger if exists trg_deactivate_pay_rows_when_offline on public.group_trips;
create trigger trg_deactivate_pay_rows_when_offline
  after update of payment_mode on public.group_trips
  for each row execute function public.deactivate_pay_rows_when_offline();
