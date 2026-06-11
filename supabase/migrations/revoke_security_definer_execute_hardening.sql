-- ============================================================================
-- Security hardening: lock down EXECUTE on all SECURITY DEFINER functions
-- Date: 2026-06-10
-- Apply: manually via Supabase SQL editor (never `db push`)
--
-- WHY: All 60 SECURITY DEFINER functions in `public` were executable by the
-- `anon` role via PostgREST (e.g. POST /rest/v1/rpc/send_email with just the
-- anon key). SECURITY DEFINER bypasses RLS, so anyone on the internet could
-- call send_email, find_and_connect_matches, backfill_*, etc.
--
-- STRATEGY (verified against live DB + codebase on 2026-06-10):
--   1. REVOKE EXECUTE from PUBLIC, anon, authenticated on ALL of them.
--   2. GRANT back to `authenticated` ONLY:
--      a. The 13 RPCs the client actually calls via supabase.rpc()
--      b. The 4 helper functions referenced inside RLS policies
--         (EXECUTE *is* checked for functions in policy expressions;
--          all such policies are TO authenticated — anon needs nothing)
--   3. service_role keeps its explicit grants (untouched) -> edge functions
--      and admin tooling unaffected.
--
-- SAFE BECAUSE:
--   * Trigger functions: Postgres checks EXECUTE only at CREATE TRIGGER time,
--     never when the trigger fires. Proof in prod: broadcast_message_change /
--     broadcast_reaction_change already have no anon/authenticated EXECUTE
--     and messaging works.
--   * Functions called from inside other SECURITY DEFINER functions
--     (send_email, add_surftrip_member_with_conversation, ...) execute as the
--     function owner (postgres), not the end-user role.
--   * Cron jobs only call edge functions over net.http_post — no direct
--     DB function calls.
--   * Realtime + storage policies use inline subqueries, none of these fns.
--   * No views reference these functions.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) REVOKE from PUBLIC, anon, authenticated — every SECURITY DEFINER function
-- ----------------------------------------------------------------------------

-- Callable (non-trigger) functions
REVOKE EXECUTE ON FUNCTION public.accept_surftrip_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_surftrip_member_with_conversation(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_surftrip_members_from_dms(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.are_users_in_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_public_users_for_existing_auth_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_public_users_for_existing_auth_users_robust() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_surftrip_group(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_surftrip_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_and_connect_matches(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notify_member_left(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_blocked_by_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_blocked_users_with_profiles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_surftrip_invite_preview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_conv_member_for_current_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_user_conversation_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_addable_dm_partners(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_my_dm_partners() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_join_decision_seen(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_surfers(uuid, uuid[], text, text, text[], text[], text[], integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_pending_email_batches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_ready_email_batches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_email(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trip_admin_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_display_name(uuid) FROM PUBLIC, anon, authenticated;

-- Trigger functions (EXECUTE never checked at fire time — safe to fully revoke)
REVOKE EXECUTE ON FUNCTION public.broadcast_message_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_new_member() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_reaction_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_gear_claims_on_participant_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_analytics_event_flags() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_surftrip_max_members() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_join_request_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_surftrip_join_request_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_surftrip_member_joined_banner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_surftrip_member_left_banner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_surftrip_member_removed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notifications_testing_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_message_insert_analytics() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_group_trip_participant_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_participant_group_gear() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_surfer_admin_flag() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_enqueue_push() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_mark_commitment_received_handled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_mark_gear_received_handled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_mark_join_received_handled() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_admin_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_commitment_decided() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_commitment_received() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_gear_claimed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_gear_request_decided() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_gear_request_received() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_group_gear() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_join_request_decided() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_join_request_received() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_member_joined() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_personal_gear() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_shared_personal_gear() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_trip_cancelled() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2a) GRANT back to authenticated — RPCs the client calls via supabase.rpc()
--     (verified by grepping src/ on 2026-06-10)
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.accept_surftrip_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_surftrip_members_from_dms(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_surftrip_group(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_surftrip_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_and_connect_matches(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_member_left(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_blocked_by_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_blocked_users_with_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_surftrip_invite_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_addable_dm_partners(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_dm_partners() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_join_decision_seen(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_surfers(uuid, uuid[], text, text, text[], text[], text[], integer, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2b) GRANT back to authenticated — helpers referenced inside RLS policies
--     (policies on conversations, conversation_members, messages, users,
--      surfers — all TO authenticated; EXECUTE is checked in policy exprs)
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.are_users_in_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_conversation_member(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION (run after applying)
-- Expect: anon_exec = false everywhere; auth_exec = true only for the 17
-- granted functions; svc_exec = true everywhere.
-- ----------------------------------------------------------------------------
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        COALESCE((SELECT bool_or(a.grantee::regrole::text='anon') FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), p.proacl IS NULL) AS anon_exec,
--        COALESCE((SELECT bool_or(a.grantee::regrole::text='authenticated') FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), p.proacl IS NULL) AS auth_exec,
--        COALESCE((SELECT bool_or(a.grantee=0) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), p.proacl IS NULL) AS public_exec
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.prosecdef
-- ORDER BY p.proname;

-- ----------------------------------------------------------------------------
-- ROLLBACK (only if something breaks — restores the old permissive state)
-- ----------------------------------------------------------------------------
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
--            JOIN pg_namespace n ON n.oid=p.pronamespace
--            WHERE n.nspname='public' AND p.prosecdef
--   LOOP
--     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.fn);
--   END LOOP;
-- END $$;
