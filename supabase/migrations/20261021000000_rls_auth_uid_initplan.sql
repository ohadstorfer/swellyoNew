-- RLS speed-up: call auth.uid() once per query, not once per row.
-- APPLIED to prod 2026-10-21 via MCP apply_migration. Rollback: supabase/rollbacks/20261021000000_rls_auth_uid_initplan_rollback.sql
--
-- Why: the 21 Oct 2026 load test (docs/load-test-slowness-2026-10-21.md).
-- The Supabase advisor `auth_rls_initplan` flags these 81 policies: written
-- as `auth.uid()`, Postgres runs the function again for EVERY row it checks.
-- Written as `(select auth.uid())`, it runs once per query and reuses the
-- value. Same meaning, same rows allowed — only faster. This is Supabase's
-- own recommendation:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- How: ALTER POLICY (not drop + create), so each policy keeps its name,
-- command, roles and permissive/restrictive type. Only the expressions
-- change. The new expressions are built from the LIVE definitions in
-- pg_policies, so this cannot drift from what is in production.
--
-- Safety: one transaction. If any of the 81 is missing, renamed, or
-- already partly wrapped, it raises and NOTHING is applied.
--
-- Scope: public (77) + realtime.messages (4). The 15 storage.objects
-- policies are left alone (Supabase-owned table).
--
-- Verify after applying (should return 0 rows):
--   select schemaname, tablename, policyname from pg_policies
--   where schemaname in ('public','realtime')
--     and (regexp_replace(coalesce(qual,''), '\( SELECT auth\.(uid|jwt|role)\(\) AS (uid|jwt|role)\)', '', 'g') ~ 'auth\.(uid|jwt|role)\(\)'
--       or regexp_replace(coalesce(with_check,''), '\( SELECT auth\.(uid|jwt|role)\(\) AS (uid|jwt|role)\)', '', 'g') ~ 'auth\.(uid|jwt|role)\(\)');

-- Fail fast instead of queueing live requests behind our table locks.
set local lock_timeout = '5s';

do $$
declare
  r record;
  q text;
  w text;
  stmt text;
  n int := 0;
  -- How Postgres prints (select auth.uid()) back: ( SELECT auth.uid() AS uid)
  wrapped constant text := '\( SELECT auth\.(uid|jwt|role)\(\) AS (uid|jwt|role)\)';
  bare constant text := 'auth\.(uid|jwt|role)\(\)';
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check
    from pg_policies p
    join (values
    ('public', 'analytics_events', 'auth_users_insert_own_events'),
    ('public', 'conversations', 'conversations_insert_authenticated'),
    ('public', 'conversations', 'conversations_select_members'),
    ('public', 'conversations', 'conversations_update_admin_or_creator'),
    ('public', 'group_trip_acknowledgements', 'ack_insert'),
    ('public', 'group_trip_acknowledgements', 'ack_select'),
    ('public', 'group_trip_admin_updates', 'admin_updates host can delete'),
    ('public', 'group_trip_admin_updates', 'admin_updates host can insert'),
    ('public', 'group_trip_admin_updates', 'admin_updates host can update'),
    ('public', 'group_trip_commitment_requests', 'gtcr insert self'),
    ('public', 'group_trip_commitment_requests', 'gtcr select'),
    ('public', 'group_trip_commitment_requests', 'gtcr update host or self supersede'),
    ('public', 'group_trip_days', 'gtdays host can delete'),
    ('public', 'group_trip_days', 'gtdays host can insert'),
    ('public', 'group_trip_days', 'gtdays host can update'),
    ('public', 'group_trip_destinations', 'gtd host can delete'),
    ('public', 'group_trip_destinations', 'gtd host can insert'),
    ('public', 'group_trip_destinations', 'gtd host can update'),
    ('public', 'group_trip_gear_claims', 'gear_claims member can insert own'),
    ('public', 'group_trip_gear_claims', 'gear_claims owner can delete'),
    ('public', 'group_trip_gear_claims', 'gear_claims owner can update'),
    ('public', 'group_trip_gear_items', 'gear_items host can insert'),
    ('public', 'group_trip_gear_requests', 'gear_requests member can insert own'),
    ('public', 'group_trip_gear_requests', 'gear_requests requester can withdraw'),
    ('public', 'group_trip_join_requests', 'join_requests host or requester can delete'),
    ('public', 'group_trip_join_requests', 'join_requests readable by requester or host'),
    ('public', 'group_trip_join_requests', 'join_requests requester can insert pending'),
    ('public', 'group_trip_join_requests', 'join_requests requester can withdraw'),
    ('public', 'group_trip_participants', 'group_trip_participants user joins self'),
    ('public', 'group_trip_participants', 'group_trip_participants user leaves self or host removes'),
    ('public', 'group_trip_participants', 'group_trip_participants user updates self'),
    ('public', 'group_trip_stops', 'gts host can delete'),
    ('public', 'group_trip_stops', 'gts host can insert'),
    ('public', 'group_trip_stops', 'gts host can update'),
    ('public', 'group_trips', 'group_trips host can insert'),
    ('public', 'group_trips', 'group_trips owner can delete'),
    ('public', 'notifications', 'notifications_select_own'),
    ('public', 'notifications', 'notifications_update_own'),
    ('public', 'operator_payout_accounts', 'opa_read_own'),
    ('public', 'organized_trip_delivered_documents', 'otdd_insert'),
    ('public', 'organized_trip_delivered_documents', 'otdd_select'),
    ('public', 'organized_trip_payment_events', 'otpe_read_own'),
    ('public', 'organized_trip_personal_info', 'personal_info_traveler_insert'),
    ('public', 'organized_trip_personal_info', 'personal_info_traveler_select'),
    ('public', 'organized_trip_personal_info', 'personal_info_traveler_update'),
    ('public', 'organized_trip_refunds', 'trip_refunds_select_own'),
    ('public', 'organized_trip_staff', 'ots_select'),
    ('public', 'organized_trip_staff_requirements', 'otsr_select'),
    ('public', 'organized_trip_staff_roles', 'otsr_select'),
    ('public', 'organized_trip_travelers_documents', 'otd_delete'),
    ('public', 'organized_trip_travelers_documents', 'otd_insert'),
    ('public', 'organized_trip_travelers_documents', 'otd_select'),
    ('public', 'surftrip_group_members', 'surftrip_group_members host can insert host row'),
    ('public', 'surftrip_group_members', 'surftrip_group_members host can update role'),
    ('public', 'surftrip_group_members', 'surftrip_group_members self or host or admin can delete'),
    ('public', 'surftrip_groups', 'surftrip_groups host can delete'),
    ('public', 'surftrip_groups', 'surftrip_groups host can insert'),
    ('public', 'surftrip_groups', 'surftrip_groups host or admin can update'),
    ('public', 'surftrip_invite_links', 'surftrip_invite_links creator can read own'),
    ('public', 'surftrip_join_requests', 'surftrip_join_requests host or admin can review'),
    ('public', 'surftrip_join_requests', 'surftrip_join_requests readable by requester host or admin'),
    ('public', 'surftrip_join_requests', 'surftrip_join_requests requester can insert pending'),
    ('public', 'surftrip_join_requests', 'surftrip_join_requests requester can withdraw'),
    ('public', 'trip_invites', 'trip_invites_host_insert'),
    ('public', 'trip_invites', 'trip_invites_host_select'),
    ('public', 'trip_invites', 'trip_invites_update'),
    ('public', 'user_activity', 'Users can insert own activity'),
    ('public', 'user_activity', 'Users can update own activity'),
    ('public', 'user_activity', 'Users can view conversation member activity'),
    ('public', 'user_activity', 'Users can view own activity'),
    ('public', 'user_blocks', 'Users can block others'),
    ('public', 'user_blocks', 'Users can unblock'),
    ('public', 'user_blocks', 'Users can view their own blocks'),
    ('public', 'user_destinations', 'Users can delete own destinations'),
    ('public', 'user_destinations', 'Users can insert own destinations'),
    ('public', 'user_destinations', 'Users can update own destinations'),
    ('public', 'user_destinations', 'Users can view own destinations'),
    ('realtime', 'messages', 'messaging: read conversation topic'),
    ('realtime', 'messages', 'messaging: write conversation topic'),
    ('realtime', 'messages', 'reactions: read conversation topic'),
    ('realtime', 'messages', 'trips: read trip topics')
    ) as t(s, tb, pn)
      on p.schemaname = t.s and p.tablename = t.tb and p.policyname = t.pn
  loop
    -- The rollback assumes these policies had NO wrapped call before.
    if coalesce(r.qual, '') ~ wrapped or coalesce(r.with_check, '') ~ wrapped then
      raise exception 'policy % on %.% is already partly wrapped — nothing was applied',
        r.policyname, r.schemaname, r.tablename;
    end if;
    q := regexp_replace(r.qual, bare, '(select auth.\1())', 'g');
    w := regexp_replace(r.with_check, bare, '(select auth.\1())', 'g');
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if w is not null then stmt := stmt || format(' with check (%s)', w); end if;
    execute stmt;
    n := n + 1;
  end loop;

  if n <> 81 then
    raise exception 'expected 81 policies, changed % — nothing was applied', n;
  end if;
end $$;
