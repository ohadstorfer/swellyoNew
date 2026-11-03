---
name: reference_fake_users_hiding_and_membership_rows
description: What hides a surfer (surfers.is_demo_user only; no is_test/hidden/banned flag) and the minimal rows for an active operator-trip member; chat/gear/push write paths for load tests
metadata:
  type: reference
---

Only existing hide flag is `surfers.is_demo_user` (NOT NULL default false). Filtered by: match_surfers RPC (20260714010000:51), matchingService.ts:699/964/1084/1147 (+ pending_deletion at :700), swelly-trip-planning-copy(/-copy) edge fns, search_users_for_staff (latest 20260906000300:655), tripInvitesService.ts:96, destinations_reminder cron, analytics (triggers copy flag onto analytics_events). NOT filtered: explore_feed member_avatars, trip participant lists, operator-dashboard roster, UserSearchModal (DM search by name), push/chat. `finished_onboarding` only gates app routing + onboarding-reminder crons, not visibility.

Active operator-trip member = auth.users (handle_new_auth_user trigger auto-creates public.users, live-only) + public.surfers + group_trip_participants(status='active'). Service-role insert (auth.uid() null) skips enforce_participant_status, so status can be set directly. tg_sync_trip_chat_from_participant -> recompute_trip_chat_member adds conversation_members automatically, but ONLY if a public.users row exists. loadtest/seed.sql is a local-only reference (replica mode, never prod).

Gotchas: trg_member_joined, trg_gear_claimed, trg_gear_request_received insert notifications for REAL operator/members -> real pushes. send-push-notification (messages trigger, live-only DB webhook) pushes to every active conversation_member with expo_push_token; no per-message sent timestamp exists (only edge logs / net._http_response). notification_queue has created_at + sent_at.
