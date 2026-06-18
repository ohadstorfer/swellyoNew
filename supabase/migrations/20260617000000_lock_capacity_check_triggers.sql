-- Concurrency fix: capacity-enforcement triggers were doing a read-then-check
-- (SUM/COUNT the existing rows, then compare to a limit) WITHOUT locking the
-- parent row. Under the default READ COMMITTED isolation, two overlapping
-- transactions each take their snapshot before the other commits, so both read
-- the same pre-change total, both pass the check, and both commit — letting the
-- limit be exceeded (e.g. two surfers each grabbing the last unit of a group
-- gear item, or the last open slot in a surftrip group, at the same instant).
--
-- Fix: SELECT ... FOR UPDATE on the parent row (the gear item / the surftrip
-- group) at the top of each trigger. This serializes concurrent writes to the
-- same parent: the second transaction blocks on the row lock until the first
-- commits, then re-reads the now-current total and correctly rejects the
-- overflow. Scope is per-parent-row, so unrelated items/groups don't contend.
--
-- Why enforce_gear_claim_capacity also flips to SECURITY DEFINER:
--   It was SECURITY INVOKER (ran under the claimant's RLS). group_trip_gear_items
--   has a host-only UPDATE policy, and PostgreSQL's handling of whether a
--   `SELECT ... FOR UPDATE` consults the UPDATE policy (vs only SELECT) is
--   version-dependent — a non-host claimant could end up blocked by RLS on the
--   lock, breaking the normal claim path. Running the trigger as the table owner
--   (postgres) with force_rls=false bypasses RLS for its internal read+lock, so
--   it works identically for host and non-host. The SUM result is unchanged:
--   the SELECT policy on group_trip_gear_claims is already `true`, so the count
--   was never RLS-filtered. This mirrors enforce_surftrip_max_members, which is
--   already SECURITY DEFINER. search_path stays pinned; EXECUTE is revoked to
--   match the project's secdef-hardening posture (a trigger function cannot be
--   called directly as an RPC anyway, and triggers fire regardless of EXECUTE).
--
-- Only these two triggers were vulnerable. The surftrip JOIN paths
-- (accept_surftrip_invite, handle_surftrip_join_request_approval,
-- add_surftrip_members_from_dms) already serialize via pg_advisory_xact_lock /
-- FOR UPDATE — but enforce_surftrip_max_members is the last-line backstop that
-- fires on EVERY insert into surftrip_group_members regardless of path, so it
-- must hold its own lock too.
--
-- No deadlock risk: each claim / member-insert locks exactly ONE parent row, so
-- a single transaction can't form a multi-resource cycle. The only conflicting
-- lock on that parent row is a host edit/reorder of the same item/group, which
-- simply serializes (one waits), never cycles. The advisory-locked RPCs only
-- ever take the advisory lock first and the row lock second (a consistent
-- order), and pure-insert paths take only the row lock — so no cross-cycle.
--
-- Both are CREATE OR REPLACE and only add a `FOR UPDATE` (and, for the gear
-- function, SECURITY DEFINER) — behavior is otherwise identical to prod today.

-- 1) Group-trip gear claims: lock the gear item before summing claimed quantity.
CREATE OR REPLACE FUNCTION public.enforce_gear_claim_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_needed integer;
  v_taken integer;
BEGIN
  -- Lock the parent item row so concurrent claims on the same item serialize.
  SELECT needed_qty INTO v_needed
    FROM public.group_trip_gear_items
    WHERE id = NEW.item_id
    FOR UPDATE;
  IF v_needed IS NULL THEN
    RAISE EXCEPTION 'Gear item % does not exist', NEW.item_id;
  END IF;

  -- Total claimed AFTER this row's change. For UPDATE, exclude the OLD row.
  SELECT COALESCE(SUM(quantity), 0) INTO v_taken
    FROM public.group_trip_gear_claims
    WHERE item_id = NEW.item_id
      AND id <> NEW.id;

  IF v_taken + NEW.quantity > v_needed THEN
    RAISE EXCEPTION
      'Cannot claim % — only % of % needed remain',
      NEW.quantity, v_needed - v_taken, v_needed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_gear_claim_capacity() FROM PUBLIC, anon, authenticated;

-- 2) Surftrip group members: lock the group before counting members.
CREATE OR REPLACE FUNCTION public.enforce_surftrip_max_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_max integer;
  v_count integer;
begin
  -- Lock the group row so concurrent member inserts on the same group serialize.
  select max_members into v_max
    from public.surftrip_groups
    where id = new.group_id
    for update;

  if v_max is null then
    return new;
  end if;

  select count(*) into v_count
    from public.surftrip_group_members
    where group_id = new.group_id;

  if v_count >= v_max then
    raise exception 'group has reached its member limit (%)', v_max
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

-- 3) Group-trip participants: NEW capacity enforcement (none existed before —
-- group_trips.max_participants was never enforced server-side, only in the UI).
-- BEFORE INSERT backstop on group_trip_participants so it holds for every insert
-- path (host self-insert at trip creation, handle_join_request_approval, and any
-- future path), with the same FOR UPDATE serialization. max_participants counts
-- the host too (per the client contract), so we count every participant row.
-- null max = no cap. SECURITY DEFINER + owner postgres + force_rls=false →
-- bypasses RLS for the read+lock; EXECUTE revoked to match hardening posture.
CREATE OR REPLACE FUNCTION public.enforce_group_trip_max_participants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_max integer;
  v_count integer;
begin
  -- A duplicate (trip_id, user_id) adds nobody — the INSERT either no-ops via
  -- ON CONFLICT DO NOTHING or is rejected by the unique constraint. Skip the
  -- capacity check so a re-approval of an existing member never falsely fails on
  -- a full trip. (BEFORE INSERT triggers fire even for soon-to-conflict rows.)
  if exists (
    select 1 from public.group_trip_participants
    where trip_id = new.trip_id and user_id = new.user_id
  ) then
    return new;
  end if;

  -- Lock the trip row so concurrent joins to the same trip serialize.
  select max_participants into v_max
    from public.group_trips
    where id = new.trip_id
    for update;

  if v_max is null then
    return new;  -- no cap set
  end if;

  select count(*) into v_count
    from public.group_trip_participants
    where trip_id = new.trip_id;

  if v_count >= v_max then
    raise exception 'Trip is full — % of % spots taken', v_count, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_group_trip_max_participants() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_group_trip_max_participants ON public.group_trip_participants;
CREATE TRIGGER trg_enforce_group_trip_max_participants
  BEFORE INSERT ON public.group_trip_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_trip_max_participants();
