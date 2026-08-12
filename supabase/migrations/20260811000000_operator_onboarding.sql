-- Operator onboarding — the four things an operator sets once, before they can
-- sell a trip: Stripe, price currency, cancellation policy, default waiver.
--
-- WHY THIS IS NOT JUST "ARE THE COLUMNS NULL". Two of the four already have
-- working defaults: `cancellation_preset` defaults to 'standard' and
-- `default_currency` NULL means "follow my country". Neither can ever be
-- *missing*, so neither can ever be *outstanding* either — an operator would be
-- told setup was complete having never seen the refund terms they are selling
-- on. The two `*_confirmed_at` stamps are the whole fix: they record that a
-- human looked, which is a different fact from what the value happens to be.
--
-- THE DEFAULT WAIVER IS A TEMPLATE, NOT THE DOCUMENT. Trip waivers live in
-- `organized_trip_operator_documents` keyed by `trip_id`, under storage path
-- `<trip_id>/operator/<uuid>.pdf`, and the storage policy gates that path on
-- `is_trip_host(trip_id)`. A per-operator file can never satisfy that check, and
-- widening the policy to let one object serve many trips would break the thing
-- the whole design rests on: the traveler agreed to THIS pdf, whose hash we
-- still hold. So the default is stored separately and COPIED into the trip at
-- publish. Downstream — hashing, agreement matching, version numbering, the
-- nightly purge skipping operator materials — is completely untouched.
--
-- ⚠️ APPLY IN TWO PARTS, IN THIS ORDER. Part 1 adds an enum value; Postgres
-- refuses to let a new enum value be USED in the transaction that added it
-- ("unsafe use of new value of enum type"), and Part 2 uses it in
-- `notification_push_priority`. Running the whole file as one statement fails.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent: safe to re-run.


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — run alone, commit, then run Part 2.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.notification_type add value if not exists 'operator_setup_required';


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — everything else.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. What the operator has settled ──────────────────────────────────────
alter table public.operator_settings
  add column if not exists currency_confirmed_at      timestamptz,
  add column if not exists policy_confirmed_at        timestamptz,
  add column if not exists default_waiver_path        text,
  add column if not exists default_waiver_name        text,
  add column if not exists default_waiver_hash        text,
  add column if not exists default_waiver_size_bytes  integer,
  add column if not exists default_waiver_uploaded_at timestamptz;

comment on column public.operator_settings.currency_confirmed_at is
  'When the operator explicitly accepted their price currency. NULL means they '
  'have never looked — which is NOT the same as having no currency, because '
  'NULL default_currency is a valid setting meaning "follow my country".';

comment on column public.operator_settings.policy_confirmed_at is
  'When the operator explicitly accepted their cancellation policy. NULL means '
  'they have never looked; the preset still defaults to ''standard''.';

comment on column public.operator_settings.default_waiver_path is
  'Storage object under defaults/<user_id>/<uuid>.pdf in group-trip-documents. '
  'A TEMPLATE: copied into <trip_id>/operator/<uuid>.pdf at publish, never '
  'referenced directly by a trip.';

-- A waiver row is all-or-nothing. A path with no hash would publish a trip
-- whose waiver cannot be proven, which is the one thing the hash exists for.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_waiver_complete_check') then
    alter table public.operator_settings
      add constraint operator_settings_waiver_complete_check
      check (
        default_waiver_path is null
        or (default_waiver_hash is not null and default_waiver_uploaded_at is not null)
      );
  end if;
end $$;


-- ── 2. Storage for the template ───────────────────────────────────────────
-- New prefix, new policies, ADDITIVE. `can_access_group_document` is
-- deliberately NOT edited: it is a SECURITY DEFINER function three live
-- policies depend on, and a mistake there silently opens or closes every
-- traveler passport in the bucket. Policies are OR'd, so a separate one for a
-- separate prefix cannot affect the existing paths.
--
-- Owner-only, including SELECT. Travelers never read the template — they read
-- the copy that lives inside their trip.

drop policy if exists "group docs: operator uploads own default" on storage.objects;
create policy "group docs: operator uploads own default"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-trip-documents'
  and name ~ '^defaults/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.pdf$'
  and ((storage.foldername(name))[2])::uuid = (select auth.uid())
);

drop policy if exists "group docs: operator reads own default" on storage.objects;
create policy "group docs: operator reads own default"
on storage.objects for select to authenticated
using (
  bucket_id = 'group-trip-documents'
  and name ~ '^defaults/[0-9a-fA-F-]{36}/'
  and ((storage.foldername(name))[2])::uuid = (select auth.uid())
);

-- Replacing the default is delete + upload under a new id; objects stay
-- immutable, exactly as in the trip prefix.
drop policy if exists "group docs: operator deletes own default" on storage.objects;
create policy "group docs: operator deletes own default"
on storage.objects for delete to authenticated
using (
  bucket_id = 'group-trip-documents'
  and name ~ '^defaults/[0-9a-fA-F-]{36}/'
  and ((storage.foldername(name))[2])::uuid = (select auth.uid())
);


-- ── 3. The push ───────────────────────────────────────────────────────────
-- ⚠️ WITHOUT THIS THE NOTIFICATION IS SILENT. `notification_push_priority`
-- ends in `else -1`, and -1 means feed-only — a new type that is not listed
-- here writes a bell row and never pushes. That failure is invisible: the row
-- appears in the app, so nothing looks broken.
--
-- Priority 1, not 0. Zero bypasses quiet hours, which is for things that are
-- happening to you right now (a join request, a cancelled trip). "Finish your
-- setup" can wait until morning.
create or replace function public.notification_push_priority(
  p_type notification_type, p_data jsonb
) returns smallint
language sql
immutable
as $$
  select case p_type
    when 'join_request_received'        then 0
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end
    when 'commitment_request_received'  then 0
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end
    when 'member_committed'             then 1
    when 'gear_request_received'        then 0
    when 'gear_request_decided'         then 1
    when 'admin_update_posted'          then 1
    when 'group_gear_updated'           then 1
    when 'personal_gear_updated'        then 1
    when 'member_left'                  then 1
    when 'trip_cancelled'               then 0
    when 'member_removed'               then 0
    when 'trip_invite_received'         then 0
    when 'operator_staff_invited'       then 0
    when 'trip_invite_accepted'         then 0
    when 'trip_invite_declined'         then 1
    when 'operator_document_rejected'   then 0
    when 'operator_requirement_added'   then 1
    when 'operator_requirement_overdue' then 0
    when 'operator_requirement_overdue_operator' then 1
    when 'operator_stripe_ready'        then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;


-- ── 4. Tell them the moment we promote them ───────────────────────────────
-- Fires on the manual flip Ohad and Eyal do by hand. FALSE→TRUE only: an
-- UPDATE that leaves `operator` true (any other column changing) must not
-- re-notify, and `is distinct from` covers the NULL the column had before it
-- was backfilled.
--
-- No cron and no reminder. The one thing that could spam a real user here is a
-- repeating job, so there isn't one — the Trips tab card is what keeps the
-- prompt visible after this single push.
--
-- `trip_id` stays NULL: this is about the account, not a trip. NotificationCenter
-- has to route it by TYPE (see operator_stripe_ready, which set the precedent
-- and is unpressable for exactly this reason).
--
-- AFTER, and that matters. `trg_pin_surfer_operator` is a BEFORE trigger that
-- reverts anyone promoting themselves — only `set_operator_status()` (admins)
-- may set the flag. Running AFTER means this sees the value that SURVIVED the
-- pin, so a rejected self-promotion sends nothing. A BEFORE trigger here would
-- have congratulated them.
create or replace function public.notify_operator_setup_required()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if coalesce(new.operator, false) and not coalesce(old.operator, false) then
    insert into public.notifications (recipient_id, type, data)
    values (new.user_id, 'operator_setup_required', '{}'::jsonb);
  end if;
  return new;
end;
$$;

-- SECURITY DEFINER, so lock it down even though `returns trigger` keeps it off
-- PostgREST. Creating a function grants EXECUTE to PUBLIC by default, and a
-- SECDEF function that anon can call is the exact shape of bug this project has
-- had to fix before.
revoke execute on function public.notify_operator_setup_required() from public, anon, authenticated;

drop trigger if exists trg_notify_operator_setup_required on public.surfers;
create trigger trg_notify_operator_setup_required
  after update of operator on public.surfers
  for each row
  when (new.operator is distinct from old.operator)
  execute function public.notify_operator_setup_required();
