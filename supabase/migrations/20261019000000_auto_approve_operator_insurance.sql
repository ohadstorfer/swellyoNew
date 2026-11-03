-- Auto-approve operator liability insurance — TEMPORARY. Ohad, 19 Oct.
--
-- There is no admin UI to review insurance yet, so every operator sat on
-- "In review" forever. For now a submission is approved on the spot.
--
-- Only ONE thing changes in guard_operator_insurance_review(): a
-- (re)submission is stamped `approved` + reviewed_at = now(), not `pending`.
-- Everything else stays:
--   · a client still cannot write the status/review columns by hand;
--   · review_operator_insurance() still works (an admin can still reject);
--   · expiry is still checked by the client, so an expired policy is not done.
--
-- TO UNDO: re-run the guard from 20260915000000_operator_insurance_review.sql
-- (it sets 'pending'). The backfill below is not undone by that — approved rows
-- stay approved until re-submitted or rejected.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent.

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
    -- A (re)submission. TEMPORARY: approved on the spot (was 'pending').
    new.insurance_status      := 'approved';
    new.insurance_reviewed_at := now();
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

-- CREATE OR REPLACE keeps the ACL, but re-state the revoke to be safe.
revoke execute on function public.guard_operator_insurance_review() from public, anon, authenticated;

-- Approve everyone already waiting. No auth.uid() here, so the guard lets it through.
update public.operator_settings
   set insurance_status      = 'approved',
       insurance_reviewed_at = now(),
       insurance_review_note = null
 where insurance_path is not null
   and insurance_status = 'pending';
