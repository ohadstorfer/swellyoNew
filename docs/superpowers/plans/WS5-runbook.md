# WS5 APPLY RUNBOOK — match pre-filter + indexes + RLS cleanup

> ⚠️ **DRAFT artifacts. Nothing here is applied or committed.** This runbook tells
> the controller (you) how to apply WS5 safely. Repo SQL drifts from the LIVE
> prod schema — every step that touches a function/index/policy says "dump live
> first, reconcile, then apply." Migrations are applied **MANUALLY** via the
> Supabase SQL editor — **never `supabase db push`** (remote history frozen at
> `20260528`).

**Files in this workstream**
- `supabase/migrations/20260605120000_match_surfers.sql` — match RPC, **Part A folded in**, NOT yet applied to prod.
- `supabase/migrations/20260617120000_match_surfers_indexes.sql` — NEW, Part A indexes.
- `supabase/migrations/20260617130000_rls_cleanup_hot_tables.sql` — NEW, Part B RLS (high-risk, reference only).
- `supabase/tests/match_surfers_scenarios.sql` — existing parity suite (read-only).

---

## PART A — match_surfers sargable pre-filter + indexes

`match_surfers` is **not yet on prod**, so Part A ships as **one unit**: apply the
(folded) function file + the index file together, then prove parity.

### A1. Apply the indexes first (so the new plan can use them)
1. Dump live surfers indexes and confirm the two "already exist" ones are present:
   ```sql
   select indexname, indexdef from pg_indexes
   where schemaname='public' and tablename='surfers' order by indexname;
   ```
   Expect `idx_surfers_surf_level_category` and
   `idx_surfers_surf_level_category_board_type`. If EITHER is missing, the
   board/level pre-filter still works (it just filters instead of index-scans) —
   note it and proceed; do not invent them.
2. Apply `20260617120000_match_surfers_indexes.sql`. On a busy prod `surfers`,
   run each `create index` as `create index concurrently if not exists ...` on its
   own statement (CONCURRENTLY can't run inside the editor's implicit txn).
3. Verify both new indexes exist (query in that file's VERIFY block).

### A2. Apply the (folded) match_surfers function
1. Dump the live def of `match_surfers` and every `mc_*` helper and diff against
   the repo file BEFORE applying (live may be AHEAD — the swelly path is known to
   drift). If live differs in the function BODY (scoring/order), STOP and
   reconcile — Part A only touches the CTE plumbing, not scoring.
   ```sql
   select pg_get_functiondef('public.match_surfers(uuid,uuid[],text,text,text[],text[],text[],int,int,int)'::regprocedure);
   ```
   (If the function does not exist on live yet, that's expected — it's the
   un-applied file; just apply the repo version.)
2. Apply `20260605120000_match_surfers.sql` whole. **Preserve** the trailing
   `REVOKE ... FROM public, anon` + `GRANT ... TO authenticated` + the
   `set search_path = public` pins — without the GRANT, signed-in calls 403.
3. Confirm grants:
   ```sql
   select grantee, privilege_type from information_schema.role_routine_grants
   where routine_name='match_surfers';
   -- expect authenticated has EXECUTE; anon/public do NOT.
   ```

### A3. Prove IDENTICAL results (parity — the hard gate)
1. Run the parity suite — it must end with `ALL SCENARIOS PASSED`:
   ```
   psql "$DB_URL" -f supabase/tests/match_surfers_scenarios.sql
   ```
   (or paste in the SQL editor). It checks: rows ≤ limit, total_count ≥ returned,
   requester/excluded never appear, every row satisfies country/board/level/age,
   dest-path country_match+score>0, general-path flags false, score-desc ordering,
   and exclusion. The pre-filter must not change any of these.
2. **Stronger parity (recommended): capture full result sets before/after.**
   Because the suite asserts invariants (not exact row identity), also snapshot a
   few representative filters and diff row-for-row:
   ```sql
   -- run BEFORE applying Part A (against current/old fn if present) and AFTER:
   select user_id, match_score, days_in_destination, country_match, area_match, total_count
   from match_surfers('<me-uuid>','{}','Indonesia',null,null,null,null,null,null,100)
   order by user_id;     -- order by user_id to make the diff stable
   ```
   Repeat for: a general criteria-only filter (e.g. country_from=['Israel'],
   board=['shortboard']); an age-range filter (20–30, advanced/pro); a dest+area
   filter (Portugal/Ericeira). The two snapshots must be byte-identical.
   - If they differ, the prefilter dropped a row it shouldn't — the most likely
     culprit is a case/normalization mismatch on `surf_level_category` or
     `surfboard_type`. The draft already lowercases/normalizes both, but confirm
     against the actual live data values.

### A4. Prove a better plan (EXPLAIN before/after)
On the **largest realistic filter** (the one that scans the most surfers — e.g. a
broad country_from + board + an age range, no destination):
```sql
explain (analyze, buffers)
select * from match_surfers('<me-uuid>','{}',null,null,
  array['United States'], array['shortboard'], array['advanced','pro'], 20, 40, 3);
```
- BEFORE (no prefilter): expect `Seq Scan on surfers` feeding the per-row mc_* +
  `jsonb_array_elements(destinations_array)` correlated subqueries over the whole
  table.
- AFTER: expect an `Index Scan` / `Bitmap Index Scan` on `idx_surfers_age`
  (and/or the surf_level/board composite) feeding the CTE, with **fewer rows
  reaching the scored CTE** (compare `actual rows` into the jsonb scoring node and
  total `Buffers` read). The fuzzy mc_* fns and JSONB scoring should run on a
  smaller candidate set.
- The `count(*) over ()` still materializes the matched set — that's expected and
  unchanged; the win is fewer rows *entering* scoring.
- If the planner still picks a Seq Scan, check that the indexes from A1 exist and
  that the filter is selective enough; a tiny surfers table will legitimately seq
  scan (test on prod-scale data).

**Part A done when:** parity suite PASSES + before/after snapshots identical +
EXPLAIN shows Seq Scan → Index/Bitmap and fewer scored rows.

---

## PART B — RLS cleanup (HIGH BLAST RADIUS — one table at a time)

> `20260617130000_rls_cleanup_hot_tables.sql` is a **reference**, not a
> run-as-one-shot script. Policy names/predicates drift from prod. For EVERY
> table: dump live → map names → reconcile predicate → apply that table's block →
> re-dump → verify visibility + realtime → run messaging jest → only then next
> table.

### Recommended order (lowest → highest blast radius)
`swelly_chat_history` → `surfers` → `conversation_members` → `users` → `messages`.
(`messages` LAST because its SELECT RLS gates postgres_changes realtime delivery.)

### Per-table loop
1. **Dump BEFORE:**
   ```sql
   select policyname, permissive, roles, cmd, qual, with_check
   from pg_policies where schemaname='public' and tablename='<t>'
   order by cmd, policyname;
   ```
   Save this output.
2. **Reconcile the draft block** for `<t>`: map each `drop policy if exists "..."`
   to a REAL live `policyname`; confirm each recreated predicate equals the live
   `qual`/`with_check` except for `auth.uid()` → `(select auth.uid())`. Fix the
   placeholder names (`<...>`) in the draft.
3. **Apply ONLY that table's block** in the SQL editor (wrap in a single
   transaction so a mistake rolls back: `begin; ... commit;` — but DROP+CREATE of
   the same policy momentarily removes it, so keep the txn tight and off-peak).
4. **Dump AFTER** (same query). Diff against BEFORE:
   - kept policies show `(SELECT auth.uid())` in qual/with_check (init-plan);
   - dropped twins are gone;
   - no policy you meant to keep disappeared; no qual flipped.
5. **Verify visibility — authenticated user sees the SAME rows:**
   ```sql
   -- impersonate an authed user (set request.jwt.claims) or use a test session:
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<test-user-uuid>","role":"authenticated"}';
   select count(*) from public.<t>;   -- compare to the same count BEFORE the change
   reset role;
   ```
   And confirm **anon sees nothing new**:
   ```sql
   set local role anon; select count(*) from public.<t>; reset role;  -- must not increase
   ```
6. **Verify realtime (messages + conversation_members especially):** on a
   **physical device** (Simulator gives false WS failures), 2-account chat:
   - send a message A→B; B receives it live (SELECT RLS on `public.messages` and
     the `realtime.messages` topic policies both gate this);
   - typing + "Seen" still fire (the `messaging: write conversation topic` policy
     on `realtime.messages` — DO NOT touch it).
   If live messages stop arriving, the membership SELECT policy is wrong → roll
   back this table immediately (below).
7. **Run the messaging jest suite** (mocked client; no network):
   ```
   npx jest messaging
   npx tsc --noEmit
   ```
8. Only if 4–7 are clean, proceed to the next table.

### Per-table ROLLBACK
Re-apply the BEFORE dump. Concretely, for each kept/dropped policy, recreate the
original from the saved BEFORE output:
```sql
-- generic rollback shape — paste the ORIGINAL qual/with_check captured in step 1:
drop policy if exists "<recreated name>" on public.<t>;
create policy "<original name>" on public.<t>
  [as restrictive] for <cmd> to <roles>
  using ( <original qual> ) [with check ( <original with_check> )];
-- and recreate any twin you dropped, verbatim from the BEFORE dump.
```
Because every change is DROP+CREATE of named policies, rollback is always "recreate
the BEFORE state for this one table." Keep the BEFORE dump until the table is
signed off.

### Table-specific KEEP / DROP summary (reconcile names against live first)
- **swelly_chat_history** — KEEP one `{authenticated}` policy per action (wrapped);
  DROP the `{public}` twin per action (identical `auth.uid()=user_id`).
- **surfers** — KEEP `surfers_select_authenticated` (qual=true; matching needs it,
  nothing to wrap) + the RESTRICTIVE `surfers_block_filter` (wrap its auth.uid()
  from the live def, keep AS RESTRICTIVE). DROP `Users can view own surfer data` and
  `Users can view conversation member surfers` (subsets of qual=true).
- **conversation_members** — KEEP the broad "members of my conversations" policy
  (wrapped) per action; DROP narrower own-row subset twin(s).
- **users** — KEEP the broad profile-read SELECT + self-only write policies
  (wrapped); DROP the narrower "view own row" subset twin.
- **messages** — KEEP `messages_select_members` (wrapped) + the realtime-topic
  policies on `realtime.messages` (`messaging:`/`reactions:`/`trips:` read,
  `messaging: write`) — **NOT duplicates, do NOT touch**. DROP the bare-auth.uid()
  membership SELECT twins; collapse the 3 stacked INSERT → 1 (wrapped) and the 3
  stacked UPDATE → 1 (wrapped).

> **Never** collapse a realtime-topic policy into a membership policy, and never
> drop `surfers_select_authenticated`'s qual=true SELECT — both are load-bearing.

---

## Done / sign-off checklist
- [ ] A1 indexes applied + verified (and the 2 pre-existing confirmed).
- [ ] A2 function applied; grants confirmed (authenticated EXECUTE, anon/public none).
- [ ] A3 parity suite PASSES + before/after snapshots byte-identical.
- [ ] A4 EXPLAIN shows Seq Scan → Index/Bitmap + fewer scored rows.
- [ ] B per table (in order): pg_policies diff clean, visibility unchanged, anon
      unchanged, realtime live on device, `npx jest messaging` + `tsc` green.
- [ ] Commit (only when Ohad asks; do NOT commit as part of WS5 draft work).
