-- Phase 2b, part 1 of 2: the enum value ONLY.
--
-- APPLIED to prod 2026-08-07.
--
-- It has to land in its own migration and commit before anything references it.
-- Postgres refuses to use an enum value that was added in the same transaction
-- — the same trap called out in 20260805000100's header.
--
-- Part 2 is 20260807000400_operator_staff_in_app_invites.sql.
alter type public.notification_type add value if not exists 'operator_staff_invited';
