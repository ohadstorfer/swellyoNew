-- Operator setup, redesigned (Figma 15265-76107, 15522-19229):
--   · insurance gains provider, policy number, expiry date, and a REVIEW;
--   · the operator agreement records the full name the operator typed.
--
-- ── INSURANCE IS NOW REVIEWED ───────────────────────────────────────────────
-- Uploading no longer finishes the step. A Swellyo admin approves or rejects,
-- and the step counts only once it is `approved` (and not expired — the client
-- checks the date). Ohad, 15 Sep.
--
-- The operator writes their own row (RLS update_own), so nothing stops a
-- client sending `insurance_status = 'approved'`. The BEFORE trigger below is
-- what makes the status mean something:
--   · any change to the document or its fields → back to `pending`, review
--     stamps cleared. Replacing an approved certificate is a new submission;
--   · a signed-in caller touching the status/review columns directly → reverted;
--   · only `review_operator_insurance()` (admins) gets past, via a
--     transaction-local GUC — the same shape as set_operator_status.
-- No auth.uid() (service_role, SQL editor) is trusted, as elsewhere.
--
-- ⚠️ BACKFILL: rows that already hold a certificate become `pending`. Checked
-- live 15 Sep: 2 rows, both with insurance. Those operators' setup reads as
-- unfinished until an admin approves them.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent.

alter table public.operator_settings
  add column if not exists insurance_provider      text,
  add column if not exists insurance_policy_number text,
  add column if not exists insurance_expires_on    date,
  add column if not exists insurance_status        text,
  add column if not exists insurance_reviewed_at   timestamptz,
  add column if not exists insurance_review_note   text,
  add column if not exists terms_signed_name       text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_insurance_status_check') then
    alter table public.operator_settings
      add constraint operator_settings_insurance_status_check
      check (insurance_status is null
             or insurance_status in ('pending', 'approved', 'rejected'));
  end if;

  -- Lengths match the client's counters, with room. Not a place for an essay.
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_insurance_text_len_check') then
    alter table public.operator_settings
      add constraint operator_settings_insurance_text_len_check
      check (coalesce(char_length(insurance_provider), 0) <= 80
             and coalesce(char_length(insurance_policy_number), 0) <= 80
             and coalesce(char_length(insurance_review_note), 0) <= 500
             and coalesce(char_length(terms_signed_name), 0) <= 120);
  end if;
end $$;

comment on column public.operator_settings.insurance_status is
  'pending | approved | rejected. NULL when there is no certificate. Only '
  'review_operator_insurance() may set approved/rejected for a signed-in caller.';
comment on column public.operator_settings.terms_signed_name is
  'The full name typed when accepting terms_version. Stamped with terms_accepted_at.';

-- Backfill before the trigger exists, so it is not reverted.
update public.operator_settings
   set insurance_status = 'pending'
 where insurance_path is not null
   and insurance_status is null;


-- ── The guard ─────────────────────────────────────────────────────────────
create or replace function public.guard_operator_insurance_review()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  -- No certificate, no status. Holds for everyone, admins included.
  if new.insurance_path is null then
    new.insurance_status      := null;
    new.insurance_reviewed_at := null;
    new.insurance_review_note := null;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if coalesce(nullif(current_setting('app.insurance_review', true), ''), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.insurance_path          is distinct from old.insurance_path
     or new.insurance_provider      is distinct from old.insurance_provider
     or new.insurance_policy_number is distinct from old.insurance_policy_number
     or new.insurance_expires_on    is distinct from old.insurance_expires_on
  then
    -- A (re)submission.
    new.insurance_status      := 'pending';
    new.insurance_reviewed_at := null;
    new.insurance_review_note := null;
  else
    -- Not a submission: the review columns are not the operator's to write.
    new.insurance_status      := old.insurance_status;
    new.insurance_reviewed_at := old.insurance_reviewed_at;
    new.insurance_review_note := old.insurance_review_note;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_operator_insurance_review on public.operator_settings;
create trigger trg_guard_operator_insurance_review
  before insert or update on public.operator_settings
  for each row execute function public.guard_operator_insurance_review();

revoke execute on function public.guard_operator_insurance_review() from public, anon, authenticated;


-- ── The one way to review ─────────────────────────────────────────────────
create or replace function public.review_operator_insurance(
  p_user_id uuid,
  p_approve boolean,
  p_note    text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_status   text := case when p_approve then 'approved' else 'rejected' end;
  v_rows     integer;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select (u.role = 'admin') into v_is_admin
    from public.users u where u.id = v_caller;

  if not coalesce(v_is_admin, false) then
    raise exception 'Only a Swellyo admin can review insurance'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.insurance_review', 'on', true);
  update public.operator_settings
     set insurance_status      = v_status,
         insurance_reviewed_at = now(),
         insurance_review_note = nullif(btrim(p_note), '')
   where user_id = p_user_id
     and insurance_path is not null;
  -- Read the count BEFORE the next PERFORM, which would overwrite FOUND.
  get diagnostics v_rows = row_count;
  perform set_config('app.insurance_review', 'off', true);

  if v_rows = 0 then
    raise exception 'That operator has no insurance to review' using errcode = 'no_data_found';
  end if;

  return v_status;
end;
$$;

-- CREATE OR REPLACE re-grants EXECUTE to PUBLIC, so the revoke follows it.
revoke execute on function public.review_operator_insurance(uuid, boolean, text) from public, anon;
grant  execute on function public.review_operator_insurance(uuid, boolean, text) to authenticated;

comment on function public.review_operator_insurance(uuid, boolean, text) is
  'Approves or rejects an operator''s insurance certificate. Swellyo admins only '
  '(users.role = ''admin''). The only path past trg_guard_operator_insurance_review.';
