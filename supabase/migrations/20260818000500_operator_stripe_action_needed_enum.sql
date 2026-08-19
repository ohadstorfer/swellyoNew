-- Stripe Connect: the notification type for "Stripe stopped, or is about to
-- stop, your payments".
--
-- The mirror of `operator_stripe_ready`, which 20260805000000 added. That one
-- fires on the way UP and has existed since August; nothing has ever fired on
-- the way DOWN. See 20260818000600 for what that silence costs.
--
-- ── Why this is its own file ────────────────────────────────────────────────
-- Postgres will not let a new enum value be USED in the same transaction that
-- adds it, and 20260818000600 references this value inside
-- `notification_push_priority`. So this one must be committed first — run this
-- file, then that one, never both in one editor tab. Same split as
-- 20260805000000, 20260713000000 and 20260724000000.

alter type public.notification_type add value if not exists 'operator_stripe_action_needed';
