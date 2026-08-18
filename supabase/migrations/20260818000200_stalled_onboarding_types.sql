-- Two notification types for the traveler who paid and never finished.
--
-- Spec: docs/operator-trips-checklist.html §4 — "Deposit paid, onboarding
--       abandoned — and nobody notices".
--
-- SEPARATE MIGRATION, and it must stay that way: Postgres refuses to USE an
-- enum value in the same transaction that added it. 20260818000300 lists both
-- of these in `notification_push_priority`, which is exactly that use. Run this
-- one first, on its own, or the next one fails with 55P04.
-- (Same two-part shape as 20260811000000_operator_onboarding.sql.)
--
-- ✅ APPLIED to prod 2026-08-18.

-- The traveler: "your deposit is in, you are not on the trip yet."
alter type public.notification_type
  add value if not exists 'onboarding_unfinished';

-- The operator: a per-trip digest, never one push per stuck traveler.
alter type public.notification_type
  add value if not exists 'operator_onboarding_stalled';
