-- Drop public.surf_trip_plans — write-only dead end.
-- Old Swelly onboarding chat (ChatScreen) wrote a plan here when a swelly-chat
-- response included `surf_trip_plan`, but nothing ever READ the table back. Last
-- write was Dec 2025 (8 stale rows); the matching flow moved to
-- TripPlanningChatScreen and the write path went silent.
-- Dead code removed alongside this: saveSurfTripPlan() in
-- supabaseDatabaseService.ts + its call site in ChatScreen.tsx. Applied 2026-05-27.

drop table if exists public.surf_trip_plans;
