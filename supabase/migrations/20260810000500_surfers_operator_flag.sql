-- surfers.operator — is this account a trip operator?
--
-- Today there is no such thing as "being an operator": anyone can pick the
-- third card in the create-trip chooser and publish a hosting_style = 'C' trip.
-- This column is the first half of making that a real distinction.
--
-- ⚠️ THIS COLUMN IS NOT A SECURITY BOUNDARY YET, AND NOTHING SHOULD TREAT IT
-- AS ONE. The UPDATE policy on `surfers` is `surfers_update_own`:
--
--     using       ((select auth.uid()) = user_id)
--     with check  ((select auth.uid()) = user_id)
--
-- It pins no columns. So any signed-in user can PATCH their own row and set
-- `operator = true`. That is fine while this is only a display/routing hint,
-- and it is NOT fine the moment anything gates on it — a payout, a permission,
-- a "verified operator" badge. Before that day, pin the column the same way
-- `enforce_participant_status` pins group_trip_participants.status: a
-- security-definer BEFORE UPDATE trigger that copies old.operator over
-- new.operator unless a sanctioned path says otherwise.
--
-- NOT NULL DEFAULT false does not rewrite the table on PG 11+, so this is a
-- catalogue-only change even on a large `surfers`.
--
-- ⚠️ REFERENCE COPY — applied BY HAND (2026-08-10), never `db push`.
-- Idempotent: safe to re-run.

alter table public.surfers
  add column if not exists operator boolean not null default false;

comment on column public.surfers.operator is
  'True when this account is a trip operator (hosting_style = ''C'' trips). '
  'NOT a security boundary: surfers_update_own lets a user set this on '
  'themselves. Pin it with a BEFORE UPDATE trigger before gating anything on it.';
