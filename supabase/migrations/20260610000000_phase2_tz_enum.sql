-- ============================================================================
-- Phase 2 (part 1/3): per-user timezone column + new reminder enum values.
-- APPLY ORDER: 000000 (this) → 000050 (functions) → 000100 (cron).
-- Kept separate from the functions so the new enum values are COMMITTED before
-- 000050 uses them (Postgres forbids using a new enum value in the same txn).
-- ============================================================================

-- Per-user IANA timezone, captured from the device. Null until first app open post-deploy.
alter table public.surfers add column if not exists timezone text;

-- New notification types.
alter type public.notification_type add value if not exists 'trip_reminder';
alter type public.notification_type add value if not exists 'trip_ended';
