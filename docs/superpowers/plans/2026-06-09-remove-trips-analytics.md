# Remove Trips Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully remove the abandoned group-trips analytics feature — repo code, the `analytics-trips` edge function on prod, and 4 Postgres RPCs on prod — without touching unrelated security hardening or Eyal's future analytics plans.

**Architecture:** One forward cleanup commit on `ohad` (delete 10 files + restore `AnalyticsDashboardScreen.tsx` byte-for-byte to `de467e3^`), then two manual prod operations (edge fn delete, RPC drops) each gated on Ohad's explicit go-ahead. Code ships first so the prod objects are unreferenced before they disappear.

**Tech Stack:** git, Supabase CLI, Supabase SQL editor (manual), Supabase MCP `execute_sql` (read-only verification only — per project policy never `db push` / never write via MCP).

**Spec:** `docs/superpowers/specs/2026-06-09-remove-trips-analytics-design.md`

**Project constraints (apply to every task):**
- Ohad commits manually. Claude stages and prepares; STOP gates mark where Ohad acts.
- Prod-mutating steps (Tasks 4–5) require explicit go-ahead in the conversation, even though this plan was approved.

---

### Task 1: Delete trips-analytics files

**Files:**
- Delete: `src/screens/analytics/TripsAnalyticsView.tsx`
- Delete: `src/services/analytics/analyticsTripsService.ts`
- Delete: `src/screens/analytics/analyticsTokens.tsx`
- Delete: `supabase/functions/analytics-trips/` (entire directory)
- Delete: `supabase/migrations/20260608000000_trips_analytics_rpcs.sql`
- Delete: `supabase/migrations/20260608000001_trips_analytics_fixes.sql`
- Delete: `scripts/test-analytics-trips-access.sh`
- Delete: `scripts/verify-trips-analytics.sql`
- Delete: `trips-analytics-plan.html`
- Delete: `docs/superpowers/plans/2026-06-08-trips-analytics.md`

Do NOT touch: `analytics-v1-mockup.html`, `trip-creation-analytics-plan.md` (Eyal's future plans), `scale-report.html` (unrelated), `supabase/functions/analytics-dashboard/` (Users analytics, stays live).

- [ ] **Step 1: Confirm clean working tree on `ohad`**

Run: `git status --short && git branch --show-current`
Expected: empty status, branch `ohad`. If dirty, stop and ask Ohad.

- [ ] **Step 2: Delete the files**

```bash
git rm -r \
  src/screens/analytics/TripsAnalyticsView.tsx \
  src/services/analytics/analyticsTripsService.ts \
  src/screens/analytics/analyticsTokens.tsx \
  supabase/functions/analytics-trips \
  supabase/migrations/20260608000000_trips_analytics_rpcs.sql \
  supabase/migrations/20260608000001_trips_analytics_fixes.sql \
  scripts/test-analytics-trips-access.sh \
  scripts/verify-trips-analytics.sql \
  trips-analytics-plan.html \
  docs/superpowers/plans/2026-06-08-trips-analytics.md
```

Expected: 10 paths staged as deleted (`git status --short` shows `D` lines, plus the edge-fn dir contents).

- [ ] **Step 3: Verify the keep-list survived**

Run: `ls analytics-v1-mockup.html trip-creation-analytics-plan.md scale-report.html supabase/functions/analytics-dashboard/index.ts`
Expected: all four paths listed, no error.

---

### Task 2: Restore `AnalyticsDashboardScreen.tsx` to pre-analytics state

**Files:**
- Modify: `src/screens/AnalyticsDashboardScreen.tsx` (full restore from `de467e3^`)

`git log --follow` confirmed nothing besides the trips-analytics commits touched this file since `7a75c86`, so the pre-refactor version is the exact known-good state (inline tokens, no Users/Trips toggle).

- [ ] **Step 1: Restore the file from git**

```bash
git checkout de467e3^ -- src/screens/AnalyticsDashboardScreen.tsx
```

- [ ] **Step 2: Verify byte-for-byte restore (spec acceptance criterion)**

Run: `git diff de467e3^ HEAD -- src/screens/AnalyticsDashboardScreen.tsx && git diff --cached --stat -- src/screens/AnalyticsDashboardScreen.tsx`
Expected: first diff against the worktree is empty for that file; staged diff shows the screen reverting (~60+ lines changing relative to HEAD).

Simpler equivalent check: `git diff de467e3^ -- src/screens/AnalyticsDashboardScreen.tsx` → no output.

- [ ] **Step 3: Verify zero remaining references to removed code**

Run: `grep -rn "analyticsTokens\|analyticsTripsService\|TripsAnalyticsView\|analytics-trips" src/ supabase/ scripts/ App.tsx 2>/dev/null`
Expected: no output. Any hit = a missed reference; fix before proceeding.

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -iE "analytics" ; echo "exit-filtered: $?"`
Expected: no analytics-related errors (`exit-filtered: 1` from grep finding nothing). Pre-existing unrelated `tsc` noise, if any, is out of scope — only analytics-related errors block.

- [ ] **Step 5: STOP — Ohad reviews and commits**

Stage is complete. Suggested commit message for Ohad:

```
chore(analytics): remove abandoned trips-analytics feature

Deletes Trips dashboard view/service/tokens, analytics-trips edge fn,
both trips RPC migrations, test scripts, and the old plan docs.
Restores AnalyticsDashboardScreen to pre-toggle state (de467e3^).
Keeps Eyal's analytics-v1 mockup + trip-creation funnel plan.
Prod cleanup (edge fn delete + RPC drops) tracked in
docs/superpowers/plans/2026-06-09-remove-trips-analytics.md.
```

Ohad: review `git diff --cached`, commit on `ohad`, merge to `main`, `git push origin main`, then `git push love main --force` (SwellyoLove flow).

---

### Task 3: Hand Ohad the prod-DB cleanup SQL (do not run yet)

**Files:** none committed — one-off SQL pasted into the Supabase SQL editor (project policy: migrations applied manually; never `supabase db push`).

- [ ] **Step 1: Present this exact SQL to Ohad**

```sql
-- Remove abandoned trips-analytics RPCs (2026-06-09).
-- Drops ONLY the 4 trips functions. Deliberately contains NO GRANT/REVOKE:
-- the hardening REVOKEs on count_active_conversations,
-- active_conversations_series and count_distinct_users_event
-- (added in 20260608000001) must remain in place.
DROP FUNCTION IF EXISTS public.trips_overview(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.trips_overview_series(int);
DROP FUNCTION IF EXISTS public.trips_breakdowns_and_rates(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.trips_funnels(timestamptz, timestamptz);
```

- [ ] **Step 2: Confirm sequencing with Ohad**

Run order is: code merged & pushed (Task 2 gate) → edge function deleted (Task 4) → this SQL (Task 5). Do not paste the SQL before the edge function is gone — the deployed function still calls these RPCs and would start 500ing instead of being cleanly absent.

---

### Task 4: Delete `analytics-trips` edge function from prod

**Gate:** Ohad's explicit "go" in conversation (prod-mutating).

- [ ] **Step 1: Confirm what exists before deleting**

Run: `npx supabase functions list 2>/dev/null | grep -i analytics`
Expected: two rows — `analytics-dashboard` (ACTIVE) and `analytics-trips` (ACTIVE).

- [ ] **Step 2: Delete the function**

Run: `npx supabase functions delete analytics-trips`
Expected: success message. If it prompts for project ref, use the linked project (it resolved fine for `functions list`).

- [ ] **Step 3: Verify**

Run: `npx supabase functions list 2>/dev/null | grep -i analytics`
Expected: exactly one row — `analytics-dashboard` ACTIVE. `analytics-trips` gone.

---

### Task 5: Drop the 4 RPCs on prod (Ohad runs, Claude verifies)

**Gate:** edge function already deleted (Task 4 verified).

- [ ] **Step 1: Ohad pastes the Task 3 SQL in the Supabase SQL editor and runs it**

Expected: `DROP FUNCTION` × 4, no errors (`IF EXISTS` makes reruns safe).

- [ ] **Step 2: Claude verifies drops via read-only MCP `execute_sql`**

```sql
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('trips_overview','trips_overview_series',
                    'trips_breakdowns_and_rates','trips_funnels');
```

Expected: 0 rows.

- [ ] **Step 3: Claude verifies hardening REVOKEs survived (spec acceptance criterion)**

```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('count_active_conversations',
                    'active_conversations_series',
                    'count_distinct_users_event');
```

Expected: 3 rows, `anon_exec = false` and `auth_exec = false` on every row. Any `true` = hardening regressed; re-apply the REVOKEs from the (now-deleted, recoverable via `git show 2ff3cec`) migration immediately.

---

### Task 6: Final functional check

- [ ] **Step 1: Ohad opens the Users analytics dashboard in a dev build**

Expected: dashboard loads and renders normally — no Trips toggle, no errors. (`analytics-dashboard` edge fn and the user RPCs were never touched; this is a smoke check, not a test of changed code.)

- [ ] **Step 2: Close out**

Mark the feature removed. Source of truth for what was kept: the spec's "Keep" list.

---

## Self-review notes

- **Spec coverage:** code removal → Tasks 1–2; DB cleanup + REVOKE preservation → Tasks 3, 5; edge fn → Task 4; ship flow → Task 2 Step 5; order of operations → Task 3 Step 2 enforces code → edge fn → SQL; acceptance criteria each map to a verification step (T2/S2, T2/S3, T5/S2, T5/S3, T4/S3, T6/S1).
- **No TDD tasks:** this plan only deletes code and prod objects; the "tests" are the explicit verification commands with expected outputs in every task.
- **Type consistency:** function signatures in Task 3 SQL match the migration definitions (`timestamptz, timestamptz` / `int`) verified against the migration files before they're deleted.
