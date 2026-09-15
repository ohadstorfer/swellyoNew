-- A crew member may rewrite the line under their own name. Nothing else.
--
-- Product Specs §"Manage self": "edit your own description." Today nobody can:
-- `ots_write` covers all four verbs with `staff.manage` (20260901000000), so a
-- guide who wants to fix a typo in their own bio has to ask the operator.
--
-- ── The decision this settles ──────────────────────────────────────────────
-- tripStaffService.updateTripStaffProfile says the opposite, deliberately: "an
-- account-holding guide's job and blurb belong to the OPERATOR, not to them.
-- They are how this trip introduces its crew, and the same person can be 'Head
-- guide' on one trip and 'Photographer' on the next."
--
-- That is right, and it is not in conflict with the spec once you notice they
-- are about different verbs. The operator keeps the power to write anyone's
-- title and bio — that is what makes the crew section a coherent piece of
-- copy. This adds a second, narrower right: the person themselves may also
-- edit those same two fields. Last write wins, which is the correct outcome
-- for two people editing one sentence about one of them. Decision D3,
-- 4 September 2026.
--
-- ── Why a policy alone would be a hole ─────────────────────────────────────
-- RLS is row-level. A policy that says `user_id = auth.uid()` says "you may
-- UPDATE this row", and an UPDATE names whatever columns it likes — so on its
-- own it would hand every guide on every trip the ability to set their own
-- `role_key` to 'co_operator' and take the trip over.
--
-- So: policy for WHO, trigger for WHICH COLUMNS. The same split
-- guard_waiver_replacement and guard_operator_trip_dates use, for the same
-- reason. The trigger is the wall; the policy just opens the door.
--
-- Note the trigger deliberately does NOT ask "is this a self-edit?" — it asks
-- "does the caller hold staff.manage?", and constrains them if not. That is
-- the same question from the other side, and it is the one that stays correct
-- when a new policy is added later.

-- ── 1. The column guard ────────────────────────────────────────────────────

create or replace function public.guard_staff_self_edit()
returns trigger
language plpgsql
-- INVOKER, matching guard_operator_trip_money (20260813200000). This reads
-- nothing but NEW and OLD; the only lookup it makes is trip_staff_can(), which
-- is itself security definer and does its own reading. A definer wrapper here
-- would buy nothing and widen what the function can touch.
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  -- No JWT: the service role, a cron job, or a migration. Not the threat this
  -- guards against — it never carries a user's token.
  if auth.uid() is null then
    return new;
  end if;

  -- Whoever manages the crew may write the whole row, exactly as before. This
  -- is the operator of record (granted from group_trips.host_id inside
  -- trip_staff_can itself) and any co-operator they appointed.
  if public.trip_staff_can(new.trip_id, 'staff.manage') then
    return new;
  end if;

  -- Everyone else reaching an UPDATE is here through ots_self_profile below,
  -- so they are editing their own row. Two fields, and `updated_at`, which the
  -- touch trigger writes for them.
  if new.id           is distinct from old.id
     or new.trip_id      is distinct from old.trip_id
     or new.user_id      is distinct from old.user_id
     or new.operator_id  is distinct from old.operator_id
     or new.role_key     is distinct from old.role_key
     or new.display_name is distinct from old.display_name
     or new.photo_url    is distinct from old.photo_url
     or new.invited_at   is distinct from old.invited_at
     or new.accepted_at  is distinct from old.accepted_at
     or new.revoked_at   is distinct from old.revoked_at
     or new.created_at   is distinct from old.created_at then
    raise exception
      'You can change your own title and bio on this trip. Everything else is the operator''s.'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.guard_staff_self_edit() is
  'Column-level permission RLS cannot express: without staff.manage, an UPDATE '
  'on organized_trip_staff may change only title and bio. Without this the '
  'self-edit policy would let any guide set their own role_key to co_operator.';

revoke execute on function public.guard_staff_self_edit()
  from public, anon, authenticated;

-- Named to sort before trg_touch_ots, which stamps updated_at. Order does not
-- actually matter here — the guard ignores updated_at — but a guard that runs
-- first is the one that is easy to reason about.
drop trigger if exists trg_guard_ots_self_edit on public.organized_trip_staff;
create trigger trg_guard_ots_self_edit
  before update on public.organized_trip_staff
  for each row execute function public.guard_staff_self_edit();

-- ── 2. The door ────────────────────────────────────────────────────────────
--
-- `ots_write` stays exactly as it is — this is an additional UPDATE policy, and
-- Postgres ORs permissive policies together. A live row only: somebody taken
-- off the trip does not get to keep editing how they are introduced on it.

drop policy if exists ots_self_profile on public.organized_trip_staff;
create policy ots_self_profile on public.organized_trip_staff
  for update to authenticated
  using      (user_id = (select auth.uid()) and revoked_at is null)
  with check (user_id = (select auth.uid()) and revoked_at is null);

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select policyname, cmd from pg_policies
--  where tablename = 'organized_trip_staff' order by policyname;
-- select tgname from pg_trigger where tgname = 'trg_guard_ots_self_edit';
--
-- Inside `begin; … rollback;`, with a GUIDE's claims on the session, against
-- their own live staff row. This must succeed:
--   update organized_trip_staff set bio = 'Ten years on this reef.' where id = '<row>';
-- These must both raise 42501:
--   update organized_trip_staff set role_key = 'co_operator' where id = '<row>';
--   update organized_trip_staff set revoked_at = null        where id = '<other-row>';
-- And this must still find nothing — a guide cannot reach anyone else's row:
--   update organized_trip_staff set bio = 'x' where id = '<someone-elses-row>';
--
-- As the operator of record, all four must still behave as they did before.
