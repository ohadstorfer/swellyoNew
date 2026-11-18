-- Crew tier gets the trip chat.
--
-- APPLIED to prod 2026-11-06 (Ohad's go-ahead). Kept here so the repo matches
-- live.
--
-- Why: operators expect crew to see the trip's Overview, Plan AND Chat. Crew had
-- roster.view (Overview + Plan) but not chat.participate, so the Chat tab never
-- showed for them.
--
-- No backfill needed: trg_sync_trip_chat_members on organized_trip_staff_roles
-- (20260923000000) recomputes every staff member of the changed tier and adds
-- them to their trip chats. Verified after apply: all 4 accepted crew members
-- have an active conversation_members row.

update public.organized_trip_staff_roles
   set capabilities = array_append(capabilities, 'chat.participate')
 where role_key = 'crew' and operator_id is null
   and not ('chat.participate' = any(capabilities));
