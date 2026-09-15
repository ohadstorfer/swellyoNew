-- Enum value only. Postgres will not let a new enum label be USED in the same
-- transaction that adds it, so the producer that writes this type lives in
-- 20260820000800 and this file must be applied first. Same two-part split as
-- 20260811000000 (operator onboarding) and 20260818000200 / 20260818000300.

alter type public.notification_type
  add value if not exists 'operator_traveler_confirmed';
