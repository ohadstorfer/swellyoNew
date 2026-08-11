-- Make `surfers.operator` mean something: pin the column, and give it one
-- sanctioned way in.
--
-- THE HOLE THIS CLOSES. `surfers_update_own` is:
--     using / with check  ((select auth.uid()) = user_id)
-- It pins no columns, so a signed-in user could PATCH their own row and set
-- `operator = true`. A flag anyone can grant themselves is decoration, not a
-- permission. Same shape as the `group_trip_participants.status` hole, and the
-- same fix: a BEFORE trigger silently copies the old value over the new one,
-- exactly like `enforce_participant_status` and `freeze_traveler_price`.
--
-- SILENTLY, not with an exception. A raise here would turn every unrelated
-- profile save that happens to echo the column back into a failed save. The
-- write is ignored; the client is not punished for sending it.
--
-- WHO CAN GRANT IT — a decision, stated: only a Swellyo admin, meaning
-- `users.role = 'admin'` (2 accounts today). That matches the "approve the
-- first operators by hand" plan. If you later want self-serve, add a second
-- sanctioned path; do not loosen the trigger.
--
-- ⚠️ CHECKED AGAINST `users.role`, NEVER `surfers.is_admin`. is_admin is only a
-- mirror, maintained by sync_surfer_admin_flag, and it lives on `surfers` — so
-- it is writable by its owner under the very policy this migration works
-- around. Trusting it here would rebuild the hole one table over. (is_admin
-- gates no RLS policy today; it only filters analytics, so it is a reporting
-- nuisance rather than an escalation. Worth pinning separately one day.)
--
-- ⚠️ `update of operator` is deliberate. The trigger then fires only when a
-- statement actually mentions the column — which is exactly what a PostgREST
-- PATCH carrying `operator` does — instead of on every profile save.
--
-- ⚠️ REFERENCE COPY — applied BY HAND (2026-08-10), never `db push`.
-- Idempotent: safe to re-run.

create or replace function public.pin_surfer_operator()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  -- No auth.uid() means service_role, a cron job, or the SQL editor. Those are
  -- already trusted and must stay able to backfill. Same carve-out as
  -- enforce_participant_status.
  if auth.uid() is null then
    return new;
  end if;

  -- The sanctioned path identifies itself with a transaction-local GUC. It
  -- cannot key off auth.uid(): set_operator_status runs AS the calling admin,
  -- so the caller looks identical to any other signed-in user from in here.
  if coalesce(nullif(current_setting('app.operator_grant', true), ''), 'off') = 'on' then
    return new;
  end if;

  -- A new account is never born an operator.
  if tg_op = 'INSERT' then
    new.operator := false;
    return new;
  end if;

  new.operator := old.operator;
  return new;
end;
$$;

drop trigger if exists trg_pin_surfer_operator on public.surfers;
create trigger trg_pin_surfer_operator
  before insert or update of operator on public.surfers
  for each row execute function public.pin_surfer_operator();


-- ── The one way in ────────────────────────────────────────────────────────
create or replace function public.set_operator_status(
  p_user_id  uuid,
  p_operator boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select (u.role = 'admin') into v_is_admin
    from public.users u where u.id = v_caller;

  if not coalesce(v_is_admin, false) then
    raise exception 'Only a Swellyo admin can change operator status'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.surfers s where s.user_id = p_user_id) then
    raise exception 'No such surfer' using errcode = 'no_data_found';
  end if;

  perform set_config('app.operator_grant', 'on', true);
  update public.surfers set operator = p_operator where user_id = p_user_id;
  perform set_config('app.operator_grant', 'off', true);

  return p_operator;
end;
$$;

-- CREATE OR REPLACE re-grants EXECUTE to PUBLIC every time, so the revoke has
-- to follow the definition, not precede it.
revoke execute on function public.set_operator_status(uuid, boolean) from public, anon;
grant  execute on function public.set_operator_status(uuid, boolean) to authenticated;

comment on function public.set_operator_status(uuid, boolean) is
  'Sets surfers.operator. Swellyo admins only (users.role = ''admin''). The only '
  'path past trg_pin_surfer_operator for a signed-in caller.';
