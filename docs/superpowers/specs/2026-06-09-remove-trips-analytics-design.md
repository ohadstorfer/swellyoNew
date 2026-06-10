# Remove Trips Analytics (feature abandoned)

**Date:** 2026-06-09
**Decision:** Fully remove the group-trips analytics feature built on 2026-06-08. The feature is abandoned; future analytics work will follow Eyal's updated plans instead.

## Background

On 2026-06-08 a Trips analytics dashboard was built across ~9 commits (`ab8a086` → `2ff3cec`, plus parts of `a44aabe`): 4 Postgres RPCs, an `analytics-trips` edge function, a client service, a Trips dashboard view, and a Users/Trips toggle in `AnalyticsDashboardScreen`. Everything is merged to `main` and live on prod (RPCs applied manually; edge function deployed, v3, ACTIVE).

## Approach

Forward cleanup commit (no history rewrite, no `git revert` — commit `a44aabe` is mixed with non-analytics work and can't be cleanly reverted). `AnalyticsDashboardScreen.tsx` is restored byte-for-byte to its pre-analytics version (`de467e3^` = `7a75c86` era); nothing else touched that file since, verified via `git log --follow`.

## Scope

### 1. Code removal (one commit on `ohad`)

Delete:
- `src/screens/analytics/TripsAnalyticsView.tsx`
- `src/services/analytics/analyticsTripsService.ts`
- `src/screens/analytics/analyticsTokens.tsx` (shared-tokens refactor existed only to serve two views; with one view left it has no purpose)
- `supabase/functions/analytics-trips/` (entire directory)
- `supabase/migrations/20260608000000_trips_analytics_rpcs.sql`
- `supabase/migrations/20260608000001_trips_analytics_fixes.sql`
- `scripts/test-analytics-trips-access.sh`
- `scripts/verify-trips-analytics.sql`
- `trips-analytics-plan.html`
- `docs/superpowers/plans/2026-06-08-trips-analytics.md`

Restore:
- `src/screens/AnalyticsDashboardScreen.tsx` ← `git show de467e3^:src/screens/AnalyticsDashboardScreen.tsx`

Keep (explicitly NOT removed):
- `analytics-v1-mockup.html` and `trip-creation-analytics-plan.md` — Eyal's updated plans; they are the future direction
- `scale-report.html` — unrelated (scaling work, came in the same mixed commit)
- `analytics-dashboard` edge function and all Users analytics — untouched

### 2. Supabase DB cleanup (manual, via SQL editor)

Cleanup SQL file dropping ONLY the 4 trips RPCs, with exact signatures:
- `DROP FUNCTION IF EXISTS public.trips_overview(timestamptz, timestamptz);`
- `DROP FUNCTION IF EXISTS public.trips_overview_series(int);`
- `DROP FUNCTION IF EXISTS public.trips_breakdowns_and_rates(timestamptz, timestamptz);`
- `DROP FUNCTION IF EXISTS public.trips_funnels(timestamptz, timestamptz);`

⚠️ Migration `20260608000001` also REVOKEd EXECUTE on three pre-existing user-analytics RPCs (`count_active_conversations`, `active_conversations_series`, `count_distinct_users_event`). Those REVOKEs are unrelated security hardening (see RPC-execute-revoke policy) and MUST stay — the cleanup does not touch them.

Per project workflow: Ohad pastes the SQL in the Supabase SQL editor; Claude verifies afterward with read-only `execute_sql` (functions gone, hardening REVOKEs intact).

### 3. Edge function removal (prod)

`npx supabase functions delete analytics-trips` — run only after Ohad's explicit go-ahead (outward-facing prod change). `analytics-dashboard` stays.

### 4. Ship

Ohad reviews + commits manually, merges `ohad` → `main`, pushes `origin`, then `git push love main --force` for SwellyoLove.

## Order of operations

1. Code cleanup commit (app stops referencing the RPCs/edge fn once shipped)
2. Delete edge function from prod
3. Drop the 4 RPCs
4. Verify: read-only DB check + app's Users analytics dashboard still works

Rationale: the Trips tab is admin-only dashboard UI; removing prod objects before the code ships would only break that tab for devs, but doing code-first keeps the window of broken UI at zero.

## Acceptance criteria

- `AnalyticsDashboardScreen.tsx` is identical to `de467e3^` version (`git diff de467e3^ -- src/screens/AnalyticsDashboardScreen.tsx` is empty after the change)
- No file in `src/` references `analyticsTokens`, `analyticsTripsService`, `TripsAnalyticsView`, or `analytics-trips`
- `trips_overview`, `trips_overview_series`, `trips_funnels`, `trips_breakdowns_and_rates` no longer exist in prod DB
- EXECUTE on `count_active_conversations` / `active_conversations_series` / `count_distinct_users_event` still revoked from PUBLIC/anon/authenticated
- `analytics-trips` no longer listed in `npx supabase functions list`; `analytics-dashboard` still ACTIVE
- Users analytics dashboard loads and renders normally

## Error handling / risks

- **Wrong DROP signature** → `DROP FUNCTION IF EXISTS` with explicit arg types; verified against the migration files.
- **Accidentally undoing security hardening** → cleanup SQL contains no GRANT statements at all; verification step explicitly checks the three hardening REVOKEs survive.
- **Live edge fn drift** (deployed v3 at 20:44, after last repo commit) → irrelevant; function is deleted, not redeployed.
- **SwellyoLove lag** → same push flow as any merge; web users never saw the Trips tab (admin-gated).

## Testing

Manual: open Users analytics dashboard after cleanup (dev build) and confirm it renders. No automated tests cover this screen; the deleted access-test script tested only the removed function.
