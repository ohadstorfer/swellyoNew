-- ⚠️ DRAFT — reconcile against live def before applying; RLS changes are
-- high-risk, apply table-by-table with before/after pg_policies diff + realtime +
-- visibility verification.
--
-- ⚠️⚠️ HIGH BLAST RADIUS — DO NOT run this file as one shot. It is a *reference*
-- assembled from WS5 research + live advisors; the policy NAMES and PREDICATES
-- below WILL drift from prod (repo RLS files are known to lag the live DB).
-- The controller MUST, per table:
--   1. dump live policies first:
--        select policyname, permissive, roles, cmd, qual, with_check
--        from pg_policies where schemaname='public' and tablename='<t>'
--        order by cmd, policyname;
--   2. match each DROP below to a REAL live policyname (rename if needed);
--   3. confirm the predicate the DRAFT recreates is byte-equivalent to the live
--      qual/with_check (modulo the auth.uid() -> (select auth.uid()) wrap);
--   4. apply ONLY that table's block, re-dump, eyeball the diff;
--   5. verify visibility (authed user sees SAME rows; anon sees nothing new) AND
--      realtime delivery AND run the messaging jest suite (see WS5-runbook.md).
--
-- WHAT THIS DRAFT DOES (two safe, semantics-preserving transforms only):
--   (A) auth_rls_initplan fix: wrap bare auth.uid() -> (select auth.uid()) so it
--       is evaluated ONCE per query (init-plan) instead of once per row.
--       (select auth.uid()) is semantically identical to auth.uid().
--   (B) multiple_permissive_policies fix: drop ONLY true duplicates — a policy
--       whose (role, cmd, effective predicate) is already fully covered by a kept
--       policy. NEVER drop a qual=true visibility policy matching/realtime needs,
--       and NEVER collapse a realtime-topic policy into a membership policy.
--
-- Tables (live advisor counts initplan/multiperm): messages (9/3),
-- swelly_chat_history (7/3), surfers (5/1), conversation_members (4/2), users (5/1).
-- ============================================================================


-- ===========================================================================
-- TABLE 1: public.swelly_chat_history   (LOW risk — start here)
-- ---------------------------------------------------------------------------
-- Live (per research): for EACH action (SELECT/INSERT/UPDATE) there is a
-- {authenticated} policy AND a {public} twin, both qual/with_check
-- = (auth.uid() = user_id). The {public} twins are redundant (an authenticated
-- request is already covered by the {authenticated} policy; anon has no
-- auth.uid() so the {public} twin grants anon nothing). KEEP one {authenticated}
-- per action with the wrapped predicate; DROP the {public} twins.
--
-- NOTE: repo file create_swelly_chat_history.sql shows only the {authenticated}
-- SELECT/INSERT/UPDATE policies named "Users can view/insert/update own chat
-- history" — the {public} twins exist only on LIVE. Controller: confirm the live
-- {public} policynames before dropping (names below are best-guess placeholders).
-- ===========================================================================

-- (A) wrap auth.uid() on the kept {authenticated} policies (recreate in place):
drop policy if exists "Users can view own chat history"   on public.swelly_chat_history;
create policy "Users can view own chat history"
  on public.swelly_chat_history for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own chat history" on public.swelly_chat_history;
create policy "Users can insert own chat history"
  on public.swelly_chat_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own chat history" on public.swelly_chat_history;
create policy "Users can update own chat history"
  on public.swelly_chat_history for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- (B) DROP the {public} twins (redundant duplicates of the above).
--     >>> CONFIRM these exact live names first; placeholders shown. <<<
-- drop policy if exists "<public SELECT twin name>" on public.swelly_chat_history;
-- drop policy if exists "<public INSERT twin name>" on public.swelly_chat_history;
-- drop policy if exists "<public UPDATE twin name>" on public.swelly_chat_history;


-- ===========================================================================
-- TABLE 2: public.surfers   (visibility-critical — matching depends on qual=true)
-- ---------------------------------------------------------------------------
-- Live (per research, 5 permissive SELECT-ish + 1 restrictive):
--   KEEP  surfers_select_authenticated   (PERMISSIVE SELECT, qual = true) <-- matching
--   KEEP  surfers_block_filter           (RESTRICTIVE — the block/visibility gate)
--   DROP  "Users can view own surfer data"            (qual: auth.uid()=user_id)
--   DROP  "Users can view conversation member surfers"(qual: membership subset)
--         ^ both are strict SUBSETS of qual=true -> redundant for SELECT.
--
-- We do NOT recreate surfers_select_authenticated's predicate change (it's qual
-- = true, no auth.uid() to wrap). surfers_block_filter, IF it references
-- auth.uid(), should be wrapped — but it's RESTRICTIVE and load-bearing, so the
-- controller must hand-reconcile it from the live def (left as a TODO below).
-- ===========================================================================

-- (B) drop the redundant narrower SELECT twins:
drop policy if exists "Users can view own surfer data"             on public.surfers;
drop policy if exists "Users can view conversation member surfers" on public.surfers;

-- (A) surfers_block_filter (RESTRICTIVE): wrap auth.uid() ONLY after dumping its
--     live definition — recreating it wrong silently changes who is blocked.
--     >>> Controller: paste the live def, wrap bare auth.uid(), keep AS RESTRICTIVE. <<<
-- drop policy if exists "surfers_block_filter" on public.surfers;
-- create policy "surfers_block_filter" on public.surfers as restrictive
--   for select to authenticated using ( <live predicate, auth.uid() wrapped> );

-- surfers_select_authenticated stays AS-IS (qual=true, nothing to wrap). Do NOT
-- drop it — it is what lets match_surfers / the app read all surfer rows.


-- ===========================================================================
-- TABLE 3: public.conversation_members
-- ---------------------------------------------------------------------------
-- Live advisor: 4 initplan + 2 multipermissive. Pattern: a broad correct policy
-- per action plus narrower redundant twin(s). KEEP the broad correct policy
-- (wrapped); DROP the narrower duplicate(s) whose predicate is a subset.
--
-- >>> Names below are placeholders — DUMP live first and map them. <<<
-- The common shape is "can see members of conversations I'm in" (broad, KEEP)
-- vs "can see my own membership row" (narrow subset, DROP).
-- ===========================================================================

-- (A) recreate the KEPT broad SELECT policy with the wrap (example shape):
-- drop policy if exists "<broad members SELECT name>" on public.conversation_members;
-- create policy "<broad members SELECT name>"
--   on public.conversation_members for select to authenticated
--   using ( public.is_user_conversation_member((select auth.uid()), conversation_id) );

-- (B) drop the narrower redundant twin(s):
-- drop policy if exists "<narrow own-row SELECT twin>" on public.conversation_members;

-- Repeat (A) wrap for any INSERT/UPDATE/DELETE policies on this table that use a
-- bare auth.uid() (recreate-in-place; do NOT change predicates).


-- ===========================================================================
-- TABLE 4: public.users
-- ---------------------------------------------------------------------------
-- Live advisor: 5 initplan + 1 multipermissive. KEEP the broad correct policy
-- per action; DROP the redundant narrower twin. Wrap bare auth.uid() on kept.
--
-- >>> Placeholders — DUMP live first. <<< Typical: a public/authenticated "read
-- profiles" SELECT (broad) + "view own user row" (narrow subset -> DROP), and
-- self-only INSERT/UPDATE (KEEP, wrap auth.uid()).
-- ===========================================================================

-- (A) wrap on kept self-write policies (example):
-- drop policy if exists "<users update self name>" on public.users;
-- create policy "<users update self name>"
--   on public.users for update to authenticated
--   using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- (B) drop redundant narrower SELECT twin:
-- drop policy if exists "<users view own twin>" on public.users;


-- ===========================================================================
-- TABLE 5: public.messages   (HIGHEST risk — RLS gates postgres_changes realtime)
-- ---------------------------------------------------------------------------
-- ⚠️ A broken SELECT policy here SILENTLY kills live message delivery (Realtime
-- respects RLS). Apply this table LAST, and verify realtime on a physical device.
--
-- Live (per research): 9 initplan / 3 multipermissive on public.messages:
--   SELECT:  KEEP  messages_select_members  (the canonical membership SELECT;
--                  recreate wrapped). DROP the bare-auth.uid() duplicates:
--                  "Users can view messages in their conversations" {authenticated}
--                  and its {public} twin "Users can see messages in their
--                  conversations". Both check the same membership -> redundant.
--   INSERT:  3 stacked policies -> keep ONE canonical (wrapped), drop the 2 twins.
--   UPDATE:  3 stacked policies -> keep ONE canonical (wrapped), drop the 2 twins.
--
-- ⚠️ DO NOT touch the realtime-topic policies. Those live on the SEPARATE table
--    realtime.messages (NOT public.messages):
--      "messaging: read conversation topic"  (SELECT, realtime.messages)
--      "messaging: write conversation topic"  (INSERT, realtime.messages)
--      "reactions: read conversation topic"   (SELECT, realtime.messages)
--      "trips: read trip topics"              (SELECT, realtime.messages)
--    They are NOT duplicates of the public.messages membership policies and must
--    NOT be dropped or merged. (They already use bare auth.uid(); wrapping them
--    is OPTIONAL and out of scope for this draft — leave them untouched to keep
--    blast radius minimal. Topic policies run once per subscribe, not per row.)
--
-- NOTE: messages_select_members uses the SECURITY DEFINER helper
-- is_user_conversation_member(uid, conv) (see add_messages_rls_policy.sql). The
-- repo's "Users can view messages in their conversations" IS that membership
-- SELECT — on LIVE it has been (per research) superseded/renamed to
-- messages_select_members with a possible bare-auth.uid() twin still present.
-- Controller: confirm whether messages_select_members exists on live; if the live
-- canonical is still named "Users can view messages in their conversations",
-- keep THAT name (wrapped) and drop only the {public} twin.
-- ===========================================================================

-- (A) SELECT — keep ONE canonical membership policy, wrapped:
drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members"
  on public.messages for select to authenticated
  using ( public.is_user_conversation_member((select auth.uid()), conversation_id) );

-- (B) SELECT — drop the bare-auth.uid() duplicates (subset of the above):
drop policy if exists "Users can view messages in their conversations" on public.messages;
drop policy if exists "Users can see messages in their conversations"  on public.messages; -- {public} twin

-- (A) INSERT — keep ONE canonical, wrapped (sender + member):
drop policy if exists "Users can insert messages in their conversations" on public.messages;
create policy "Users can insert messages in their conversations"
  on public.messages for insert to authenticated
  with check (
    public.is_user_conversation_member((select auth.uid()), conversation_id)
    and sender_id = (select auth.uid())
  );
-- (B) INSERT — drop the other 2 stacked twins (CONFIRM live names):
-- drop policy if exists "<insert twin 2>" on public.messages;
-- drop policy if exists "<insert twin 3>" on public.messages;

-- (A) UPDATE — keep ONE canonical, wrapped (own message, still member):
drop policy if exists "Users can update their own messages" on public.messages;
create policy "Users can update their own messages"
  on public.messages for update to authenticated
  using (
    sender_id = (select auth.uid())
    and public.is_user_conversation_member((select auth.uid()), conversation_id)
  )
  with check (
    sender_id = (select auth.uid())
    and public.is_user_conversation_member((select auth.uid()), conversation_id)
  );
-- (B) UPDATE — drop the other 2 stacked twins (CONFIRM live names):
-- drop policy if exists "<update twin 2>" on public.messages;
-- drop policy if exists "<update twin 3>" on public.messages;


-- ===========================================================================
-- POST-APPLY VERIFY (every table) — see docs/superpowers/plans/WS5-runbook.md
--   select policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies where schemaname='public' and tablename='<t>'
--   order by cmd, policyname;
-- Expect: fewer rows (twins gone), kept rows show (SELECT auth.uid()) in
-- qual/with_check, realtime-topic policies on realtime.messages UNCHANGED.
-- ===========================================================================
