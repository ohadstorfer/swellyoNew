-- Trip deletion, and the account-deletion cascade.
--
-- NOT a payments migration. This started as section 12 of
-- 20260803000000_operator_trip_payments.sql and was pulled out for a reason
-- that is worth stating at length, because the same combination will look
-- harmless again to the next person.
--
-- ══════════════════════════════════════════════════════════════════
-- Why this is NOT in the payments migration
-- ══════════════════════════════════════════════════════════════════
-- Two facts, both verified against production:
--
--   1. `group_trips`' DELETE policy is `using (public.is_trip_host(id))` —
--      i.e. every promoted admin, NOT the owner.
--   2. Eighteen child tables cascade off `group_trips(id) on delete cascade`,
--      and once 20260803000000 is applied `organized_trip_payment_events`
--      joins them. That table IS the money ledger: what was paid, by whom,
--      against which requirement, with the Stripe object ids.
--
-- Together that means "any promoted admin may delete the operator's trip and
-- irreversibly erase the entire payment ledger with it" — no soft delete, no
-- recovery. It is inert today ONLY because trip deletion always raises (see
-- below). The fix in this file is precisely what makes it work.
--
-- So shipping the fix inside the payments migration would have handed every
-- promoted admin a working ledger-erase button, in the same migration whose
-- entire purpose was to stop a promoted admin touching the money. Section 11
-- there stops them REDIRECTING payments; this would have let them ERASE the
-- record of payments already taken. Hence: separate file, and the DELETE
-- policy is narrowed here before the deletion path is unblocked. The two
-- changes must land together or not at all.
--
-- ⚠️ Until this migration is applied, section 11's own trip-delete exemption
-- in 20260803000000 is UNREACHABLE — `enforce_min_one_trip_host` raises
-- first (BEFORE row triggers fire in alphabetical name order, and
-- `trg_enforce_min_one_trip_host` sorts before
-- `trg_protect_trip_owner_membership`). That is a perfectly fine state to
-- ship: it means trip deletion stays broken exactly as it is today, which is
-- strictly safer than the alternative. Nothing regresses.

-- ══════════════════════════════════════════════════════════════════
-- 1. Deleting a trip is the OWNER's act alone
-- ══════════════════════════════════════════════════════════════════
-- Same reasoning as "nobody can remove the owner" (20260803000000 §11): a
-- promoted admin is presented to users as co-leadership, with no mention of
-- money, and must not be able to destroy the operator's trip — still less
-- its payment history. `is_trip_host(id)` is the flat multi-host set;
-- `host_id` is the single operator of record.
--
-- Grepped before writing this: `deleteGroupTrip()` has NO call site anywhere
-- in `src/` today, so narrowing this policy removes no affordance any user
-- currently has. When a delete-trip UI is built it must be owner-only.
drop policy if exists "group_trips host can delete" on public.group_trips;
create policy "group_trips owner can delete" on public.group_trips
  for delete to authenticated
  using (auth.uid() = host_id);

-- ══════════════════════════════════════════════════════════════════
-- 2. `enforce_min_one_trip_host` — two missing cascade exemptions
-- ══════════════════════════════════════════════════════════════════
-- Defined in 20260708000000, which is ALREADY APPLIED to production and must
-- not be edited; replaced here, same precedent as guard_primary_trip_host in
-- 20260803000000 §10. The existing trg_enforce_min_one_trip_host trigger
-- already points at this function by name, so replacing the body is the whole
-- change — no trigger to recreate.
--
-- The invariant "a trip must keep at least one host" is right, but it was
-- enforced against two situations where it is not merely wrong but
-- meaningless, because one of the two things it relates no longer exists:
--
--   (a) THE TRIP IS GONE. `deleteGroupTrip()` deletes the `group_trips` row
--       and lets the FK cascade. When that cascade reaches the trip's last
--       host participant, the old body raised 'A trip must have at least one
--       host' and the whole delete rolled back. Reproduced against the
--       unmodified production functions: an owner deleting their own trip is
--       refused. Nearly every trip in the database has exactly one host row,
--       so this is not an edge case — trip deletion is broken outright today.
--
--   (b) THE USER IS GONE. Deleting an `auth.users` row cascades into
--       `group_trip_participants`. If that user was the sole host of a
--       SURVIVING trip, the old body raised the same exception and the
--       account deletion rolled back. "A trip cannot be left hostless by a
--       user who no longer exists" is as meaningless an invariant as (a):
--       the row is going whatever we decide, because the account is going.
--
-- (b) also makes an unasked question moot. Whether (a)'s exemption alone
-- would have covered account deletion depends on the ORDER Postgres fires
-- the two cascades — and that order comes from constraint OID, i.e. the
-- order the constraints happened to be created in. It is favourable today by
-- accident and is asserted nowhere. With both exemptions present, neither
-- cascade depends on the other's timing.
--
-- Both tests are existence checks, deliberately, not `pg_trigger_depth()`.
-- Depth answers "who called me" with "something else did", which is exactly
-- what an attacker arranges — that is what made 20260803000000 §10
-- insufficient on its own. Existence is a fact about what is happening.
--
-- Neither exemption can weaken the invariant: there is no trip left to be
-- hostless, or no user left to be its host.
create or replace function public.enforce_min_one_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip_id uuid := old.trip_id;
  v_was_host boolean := (old.role = 'host');
  v_still_host boolean := (tg_op = 'UPDATE' and new.role = 'host');
  v_remaining int;
begin
  -- Only relevant when a host row is leaving the host set.
  if not v_was_host or v_still_host then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- (a) The trip itself is being deleted; this is its ON DELETE CASCADE.
  if not exists (select 1 from public.group_trips where id = v_trip_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- (b) The user is being deleted; this is auth.users' ON DELETE CASCADE.
  if not exists (select 1 from auth.users where id = old.user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Lock the trip so two concurrent demotions can't both pass this count.
  perform 1 from public.group_trips where id = v_trip_id for update;
  select count(*) into v_remaining
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host' and user_id <> old.user_id;
  if v_remaining = 0 then
    raise exception 'A trip must have at least one host'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function public.enforce_min_one_trip_host()
  from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- Known consequence, accepted: a trip can now outlive its owner
-- ══════════════════════════════════════════════════════════════════
-- Exemption (b) lets the sole host's account deletion succeed, which leaves
-- the trip with `host_id` pointing at a deleted user and no host participant.
-- `sync_primary_trip_host` cannot rescue it — there is no remaining host to
-- promote. That state is not introduced by this file so much as revealed by
-- it: the alternative is that account deletion fails outright, which is
-- worse, and is a compliance problem rather than a data-tidiness one.
--
-- What to do with a hostless trip — cascade-delete it, reassign it to the
-- longest-tenured member, or surface it for support — is a product decision
-- and is deliberately NOT made here. Today's account deletion is a request
-- email handled manually within 30 days (DeleteAccountScreen), so a human is
-- already in the loop and can pick per case.
