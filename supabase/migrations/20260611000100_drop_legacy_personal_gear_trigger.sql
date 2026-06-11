-- ============================================================================
-- Fix double "Your packing list" notifications (found in testing, 2026-06-10).
--
-- Two triggers fired for one host edit of the packing checklist:
--   • trg_shared_personal_gear (NEW, on group_trips.personal_gear_host_suggestion)
--     → one clean fan-out to all members. KEEP — this is plan row 2.2.
--   • trg_personal_gear (LEGACY, on group_trip_participants.personal_gear_by_host)
--     → fired again for every member because the app fans the host edit out into
--       each member's personal copy. ALSO fired when a member toggled a checkbox
--       on their own list (self-notification). DROP.
-- ============================================================================

drop trigger if exists trg_personal_gear on public.group_trip_participants;
drop function if exists public.tg_notify_personal_gear();
