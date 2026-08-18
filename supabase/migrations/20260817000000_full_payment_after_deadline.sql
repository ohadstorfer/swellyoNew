-- Late joiners pay in full.
-- Spec: docs/specs/operator-trips/traveler-onboarding.md
--
-- On a managed (type C) trip the money is split in two rows:
--
--   • `deposit` — must_have, no deadline. Paid inside onboarding. It is the
--     wall: nobody becomes a member without it.
--   • `balance`  — skippable, and it carries the operator's full-payment
--     deadline (`deadline_days_before`, counted back from `start_date`). It
--     lives in the Plan tab, long after joining.
--
-- That split only makes sense while the deadline is still ahead. Once it has
-- passed, a new traveler would be asked for a deposit and then handed a "final
-- payment" that was already overdue the moment they received it. Worse: the
-- balance is SKIPPABLE, so `activate_trip_membership` does not wait for it —
-- they could pay $1,000 of a $3,000 trip, walk out of onboarding a full
-- member, and hold a seat while owing most of the price with no deadline left
-- to chase them with.
--
-- So: a traveler whose participant row is created ON OR AFTER the full-payment
-- deadline has their `deposit_usd` frozen at the whole price. One payment,
-- during onboarding, for the full cost. The balance then works out to exactly
-- 0 — a value `operator_traveler_amount_due` already returns as such, and
-- `operator_requirement_pay_state` already reads as approved.
--
-- Frozen PER TRAVELER at join time, exactly like the price itself. Nobody who
-- already joined is touched, and moving the trip's dates afterwards does not
-- rewrite a deal that was already struck.
--
-- Nothing else changes: no new column, no new requirement row, no change to
-- what activation checks. The whole feature is "what number gets frozen".
--
-- ✅ APPLIED to prod 2026-08-17 (by Claude, on Ohad's explicit say-so this
--    session — the standing convention is still that Ohad applies these by
--    hand). Ran as one transaction via MCP execute_sql rather than
--    apply_migration, so the frozen supabase_migrations history is untouched,
--    exactly as pasting into the SQL editor would be.
--
--    Verified BEFORE: the live `freeze_traveler_price` was byte-identical to
--    the version this file rewrites — no drift to preserve. (Live has been
--    ahead of the repo on other functions, so this was checked, not assumed.)
--
--    Verified AFTER, against the two real managed trips: both read
--    `operator_trip_full_payment_due` = false — one has a null start_date, the
--    other's deadline is 2026-12-11, still ahead. No existing traveler moved.
--
--    Verified BEHAVIOUR, in a transaction that was rolled back:
--      • start_date pushed to current_date + 10, so the 30-day deadline sits
--        20 days in the past → the function returns true;
--      • a participant inserted in that state froze at 3000 / 3000 — the whole
--        price as the deposit;
--      • the same insert with the deadline still ahead froze at 3000 / 1000,
--        the normal split. Nothing was committed and the trip still has its
--        original two participants.
--
--    Client half shipped in the same session and needs no deadline logic of
--    its own: `isPayingInFull()` just reads deposit >= total off the frozen
--    row, and `amountDue('balance')` works out to 0 on its own.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Has this trip's full-payment deadline arrived?
-- ═══════════════════════════════════════════════════════════════════════════
-- `<=`, not `<`: a deadline of "today" means the money is due today, so
-- someone joining today is already in the pay-in-full window.
--
-- Three ways this is false, all deliberate:
--   • the trip is not managed — no money moves in the app at all;
--   • `start_date` is null (a months-only trip) — a relative deadline has no
--     real date to land on, mirroring `resolveDeadlineDate` on the client;
--   • no active `balance` row — the operator is not collecting in two parts.
--
-- `current_date` is UTC, the same clock every other deadline in this feature
-- is measured against (see `organized_trip_requirements_resolved`). It can
-- read as arrived up to a day early west of Greenwich; that is the existing,
-- accepted behaviour and not worth a different answer here.
create or replace function public.operator_trip_full_payment_due(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1
      from public.group_trips t
      join public.organized_trip_requirements r
        on  r.trip_id  = t.id
        and r.kind     = 'balance'
        and r.audience = 'traveler'
        and r.is_active
     where t.id = p_trip_id
       and t.payment_mode = 'managed'
       and t.start_date is not null
       and r.deadline_days_before is not null
       and (t.start_date - r.deadline_days_before) <= current_date
  );
$$;

-- Same reasoning as `operator_traveler_amount_due`: only ever called from
-- inside another SECURITY DEFINER function, which runs as owner. A direct
-- grant would buy nothing and widen the surface.
revoke execute on function public.operator_trip_full_payment_due(uuid)
  from public, anon, authenticated;

comment on function public.operator_trip_full_payment_due(uuid) is
  'True once a managed trip''s balance deadline has arrived. A traveler who '
  'joins from this point on pays the whole price in onboarding instead of a '
  'deposit — see freeze_traveler_price().';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. freeze_traveler_price — unchanged except for the two INSERT branches
--    Original: 20260803000000_operator_trip_payments.sql (section 8)
-- ═══════════════════════════════════════════════════════════════════════════
-- Everything about who may write these columns is carried over verbatim; the
-- security reasoning behind it is documented at the original and has not
-- moved. The ONLY new behaviour is the `v_dep := v_price` line, which runs in
-- both branches that derive a price from the trip defaults.
--
-- It is deliberately NOT applied to the "operator passed an explicit price"
-- early return. An operator setting a traveler's own deal by hand has decided
-- what that traveler owes and how it splits; second-guessing that against a
-- deadline would silently overwrite a deliberate number.
--
-- `v_price is not null` guards the write: with no price anywhere there is
-- nothing to charge in full, and `chk` (deposit_usd <= price_total_usd) reads
-- a null price as satisfied — so a deposit copied onto a null price would slip
-- past the constraint and read as a charge with no total behind it.
create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  -- auth.uid() is null under the service role -- treat that as trusted the
  -- same as the operator, rather than assuming a JWT is always present.
  if auth.uid() is not null and not exists (
       select 1 from public.group_trips
        where id = new.trip_id and host_id = auth.uid()
     ) then
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

    -- Joining on or after the full-payment deadline: the whole price, in one
    -- payment, in onboarding. See the header.
    if v_price is not null and public.operator_trip_full_payment_due(new.trip_id) then
      v_dep := v_price;
    end if;

    new.price_total_usd := v_price;
    new.deposit_usd     := v_dep;
    return new;
  end if;

  -- Operator of record or service role: may set both freely.
  if TG_OP = 'UPDATE' then
    return new;
  end if;

  -- INSERT, operator or service role: an explicit price passed in wins; never
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

  if v_price is not null and public.operator_trip_full_payment_due(new.trip_id) then
    v_dep := v_price;
  end if;

  new.price_total_usd := v_price;
  new.deposit_usd     := v_dep;
  return new;
end $$;

revoke execute on function public.freeze_traveler_price()
  from public, anon, authenticated;

-- The trigger itself is untouched — recreated only so a fresh database that
-- runs the migrations in order still ends up wired the same way.
drop trigger if exists trg_freeze_traveler_price on public.group_trip_participants;
create trigger trg_freeze_traveler_price
  before insert or update on public.group_trip_participants
  for each row execute function public.freeze_traveler_price();
