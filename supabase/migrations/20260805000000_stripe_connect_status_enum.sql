-- Stripe Connect: the notification type for "Stripe approved you".
--
-- ── Why this is its own file ────────────────────────────────────────────────
-- Postgres will not let a new enum value be USED in the same transaction that
-- adds it. `20260805000100_stripe_connect_status.sql` references
-- 'operator_stripe_ready' inside notification_push_priority, so the value has
-- to be committed first. Same split as 20260713000000_trip_invites_enum.sql
-- and 20260724000000_operator_notification_types.sql — run this one, then that
-- one, never both in one editor tab.

alter type public.notification_type add value if not exists 'operator_stripe_ready';
