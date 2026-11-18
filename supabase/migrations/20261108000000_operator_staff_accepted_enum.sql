-- Crew invite accepted → tell the operator. Part 1 of 2: the enum value ONLY.
--
-- APPLIED to prod 2026-11-08 (Ohad's go-ahead).
--
-- Must commit on its own before part 2 references it: Postgres refuses to use
-- an enum value added in the same transaction (same trap as 20260807000300).
--
-- Part 2 is 20261108000100_operator_staff_accepted_notify.sql.
alter type public.notification_type add value if not exists 'operator_staff_accepted';
