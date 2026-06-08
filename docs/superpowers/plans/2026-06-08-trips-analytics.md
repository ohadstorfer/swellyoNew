# Group Surf Trips Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Trips" view to the existing admin Analytics dashboard that reports the health, supply, demand, and engagement of group surf trips — computed entirely from existing trip tables, with no new client instrumentation.

**Architecture:** A new sibling Edge Function `analytics-trips` (same auth + CORS shape as `analytics-dashboard`) calls a handful of new read-only Postgres RPCs that do all aggregation/exclusion in SQL. A new client service `analyticsTripsService.ts` fetches it. The existing `AnalyticsDashboardScreen` gets a `Users | Trips` segmented toggle; the Trips body reuses the existing `StatTile` / `Sparkline` and adds three small generic components (`FunnelCard`, `BreakdownCard`, `RatesCard`). The live Users dashboard is **not touched** server-side — all trip work is additive and isolated.

**Tech Stack:** React Native 0.81 / Expo 54 / React 19, Supabase Postgres (RPCs) + Edge Functions (Deno), `react-native-svg` for sparklines.

---

## Scope

**In scope (Phase 1 — all DB-derived):** trips created, join requests, members joined, unique hosts, commitments approved (overview tiles w/ sparklines); status / hosting-style / budget / top-destination breakdowns; a trip-lifecycle funnel and a demand funnel; key rates (fill rate, % reached full, cancellation rate, approval rate, ghost trips, median host response time).

**Out of scope (deferred):** Phase 2 top-of-funnel events (Explore impressions, card taps, create-wizard drop-off, join intent) — these require new client events and have no history. Phase 3 heavy cross-cuts (per-trip chat activity, post-join retention cohorts). See `trips-analytics-plan.html` at repo root for the full metric catalog.

## Decisions (locked)

1. **All trip aggregation runs in SQL RPCs**, not the JS client, because every metric must exclude trips whose host is a demo/admin user (`surfers.is_demo_user OR surfers.is_admin`) and the JS client can't express those joins. This matches the dashboard's existing "Demo & admins excluded" guarantee.
2. **Sibling edge function** `analytics-trips` rather than extending `analytics-dashboard` — isolates risk from the live Users dashboard and keeps each function focused (the codebase pattern).
3. **New generic UI components** (`FunnelCard`, `BreakdownCard`, `RatesCard`) instead of generalizing the existing `FunnelSection` (which is hard-typed to `EventName`) — avoids touching live Users UI. Reuse `StatTile` + `Sparkline` as-is.
4. **No jest.** This project has no test harness and deploys edge functions by copy-paste. Verification = SQL `SELECT` checks, `deno check`, `npx tsc --noEmit`, and a visual check on the iOS simulator — the project's actual practice (the existing analytics migration ships "Verify after applying" SELECTs).

## Exclusion rule (used everywhere)

A trip is counted only if its host is a real user:

```sql
NOT EXISTS (
  SELECT 1 FROM surfers s
  WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin)
)
```

Requester/member-keyed counts additionally exclude demo/admin on that person.

## Data contract

The edge function returns this shape (mirrored in the client service):

```ts
interface TripCounter { total: number; prev: number; series: number[] } // series = 30 daily values, oldest→newest
interface NamedCount  { label: string; count: number }

interface TripsDashboardData {
  range: { from: string | null; to: string | null };
  prev_range: { from: string | null; to: string | null };
  overview: {
    trips_created: TripCounter;
    join_requests: TripCounter;
    members_joined: TripCounter;
    unique_hosts: TripCounter;
    commitments_approved: TripCounter;
  };
  breakdowns: {
    status: NamedCount[];            // Active / Completed / Cancelled
    hosting_style: NamedCount[];     // Plan together / Leader / Operator
    budget: NamedCount[];            // <$500 / $500–1k / $1k–2k / $2k+ / Not set
    top_destinations: NamedCount[];  // by country, top 8
  };
  lifecycle_funnel: NamedCount[];    // Created → ≥1 request → ≥1 member → ≥50% full → Completed
  demand_funnel: NamedCount[];       // Requests → Approved → Committed
  rates: {
    fill_rate_avg: number | null;       // 0..1, avg participant_count/max_participants over capped trips
    pct_reached_full: number | null;    // 0..1
    cancellation_rate: number | null;   // 0..1
    approval_rate: number | null;       // 0..1 of decided requests
    ghost_trips: number;                // trips w/ 0 requests AND 0 members
    median_response_hours: number | null;
  };
}
```

## File structure

- **Create** `supabase/migrations/20260608000000_trips_analytics_rpcs.sql` — 4 read-only RPCs (`trips_overview`, `trips_overview_series`, `trips_breakdowns_and_rates`, `trips_funnels`). One responsibility: trip analytics aggregation.
- **Create** `supabase/functions/analytics-trips/index.ts` — admin-gated edge function; calls the RPCs, assembles `TripsDashboardData`. Mirrors `analytics-dashboard` auth/CORS.
- **Create** `src/services/analytics/analyticsTripsService.ts` — types + `fetchTripsDashboard()`. Mirrors `analyticsDashboardService.ts`.
- **Create** `src/screens/analytics/TripsAnalyticsView.tsx` — the Trips body + the 3 new generic components (`FunnelCard`, `BreakdownCard`, `RatesCard`). Self-contained; imports shared tokens.
- **Create** `src/screens/analytics/analyticsTokens.ts` — extract the `C` palette, `CARD_SHADOW`, `HIT`, `Sparkline`, `StatTile`, `DeltaPill`, and shared styles so both the Users screen and the Trips view share them without duplication.
- **Modify** `src/screens/AnalyticsDashboardScreen.tsx` — import shared tokens, add a `Users | Trips` segmented toggle, render `<TripsAnalyticsView range=… />` when Trips is selected.

> The token-extraction file (`analyticsTokens.ts`) is the one refactor we take on, because the Trips view needs the exact same `StatTile`/`Sparkline`/palette and copy-pasting them would violate DRY. It's a pure move (no behavior change) and is verified by the Users dashboard still rendering identically.

---

## Task 1: Postgres RPCs for trip analytics

**Files:**
- Create: `supabase/migrations/20260608000000_trips_analytics_rpcs.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260608000000_trips_analytics_rpcs.sql` with exactly:

```sql
-- =============================================================
-- Group surf trips analytics — read-only RPCs for the admin dashboard.
-- All functions exclude trips whose HOST is a demo/admin user, and (where the
-- metric is keyed to a person) exclude demo/admin requesters/members, to stay
-- consistent with the rest of the dashboard ("Demo & admins excluded").
-- NULL range bound = unbounded on that side (all-time when both NULL).
--
-- Verify after applying:
--   SELECT * FROM trips_overview(NULL, NULL);
--   SELECT * FROM trips_overview_series(30);
--   SELECT trips_breakdowns_and_rates(NULL, NULL);
--   SELECT trips_funnels(NULL, NULL);
-- =============================================================

-- Helper predicate is inlined (SQL has no macro). Pattern, repeated below:
--   NOT EXISTS (SELECT 1 FROM surfers s
--               WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))

-- ---------- 1. Overview totals ----------
CREATE OR REPLACE FUNCTION trips_overview(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
) RETURNS TABLE (
  trips_created        bigint,
  join_requests        bigint,
  members_joined       bigint,
  unique_hosts         bigint,
  commitments_approved bigint
) AS $$
  SELECT
    (SELECT count(*) FROM group_trips g
       WHERE g.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
         AND g.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))),
    (SELECT count(*) FROM group_trip_join_requests r
       JOIN group_trips g ON g.id = r.trip_id
       WHERE r.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
         AND r.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM surfers s  WHERE s.user_id  = g.host_id      AND (s.is_demo_user  OR s.is_admin))
         AND NOT EXISTS (SELECT 1 FROM surfers s2 WHERE s2.user_id = r.requester_id AND (s2.is_demo_user OR s2.is_admin))),
    (SELECT count(*) FROM group_trip_participants p
       JOIN group_trips g ON g.id = p.trip_id
       WHERE p.role = 'member'
         AND p.joined_at >= COALESCE(p_from, '-infinity'::timestamptz)
         AND p.joined_at <  COALESCE(p_to,   'infinity'::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM surfers s  WHERE s.user_id  = g.host_id  AND (s.is_demo_user  OR s.is_admin))
         AND NOT EXISTS (SELECT 1 FROM surfers s2 WHERE s2.user_id = p.user_id  AND (s2.is_demo_user OR s2.is_admin))),
    (SELECT count(DISTINCT g.host_id) FROM group_trips g
       WHERE g.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
         AND g.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))),
    (SELECT count(*) FROM group_trip_commitment_requests cr
       JOIN group_trips g ON g.id = cr.trip_id
       WHERE cr.status = 'approved'
         AND cr.decided_at >= COALESCE(p_from, '-infinity'::timestamptz)
         AND cr.decided_at <  COALESCE(p_to,   'infinity'::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin)));
$$ LANGUAGE sql STABLE;

-- ---------- 2. Daily series for sparklines (last p_days) ----------
CREATE OR REPLACE FUNCTION trips_overview_series(
  p_days int DEFAULT 30
) RETURNS TABLE (
  day                  date,
  trips_created        bigint,
  join_requests        bigint,
  members_joined       bigint,
  unique_hosts         bigint,
  commitments_approved bigint
) AS $$
  WITH days AS (
    SELECT generate_series(CURRENT_DATE - (p_days - 1), CURRENT_DATE, interval '1 day')::date AS day
  )
  SELECT d.day,
    (SELECT count(*) FROM group_trips g
       WHERE (g.created_at AT TIME ZONE 'UTC')::date = d.day
         AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))),
    (SELECT count(*) FROM group_trip_join_requests r JOIN group_trips g ON g.id = r.trip_id
       WHERE (r.created_at AT TIME ZONE 'UTC')::date = d.day
         AND NOT EXISTS (SELECT 1 FROM surfers s  WHERE s.user_id  = g.host_id      AND (s.is_demo_user  OR s.is_admin))
         AND NOT EXISTS (SELECT 1 FROM surfers s2 WHERE s2.user_id = r.requester_id AND (s2.is_demo_user OR s2.is_admin))),
    (SELECT count(*) FROM group_trip_participants p JOIN group_trips g ON g.id = p.trip_id
       WHERE p.role = 'member' AND (p.joined_at AT TIME ZONE 'UTC')::date = d.day
         AND NOT EXISTS (SELECT 1 FROM surfers s  WHERE s.user_id  = g.host_id AND (s.is_demo_user  OR s.is_admin))
         AND NOT EXISTS (SELECT 1 FROM surfers s2 WHERE s2.user_id = p.user_id AND (s2.is_demo_user OR s2.is_admin))),
    (SELECT count(DISTINCT g.host_id) FROM group_trips g
       WHERE (g.created_at AT TIME ZONE 'UTC')::date = d.day
         AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))),
    (SELECT count(*) FROM group_trip_commitment_requests cr JOIN group_trips g ON g.id = cr.trip_id
       WHERE cr.status = 'approved' AND (cr.decided_at AT TIME ZONE 'UTC')::date = d.day
         AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin)))
  FROM days d
  ORDER BY d.day;
$$ LANGUAGE sql STABLE;

-- ---------- 3. Breakdowns + rates (single JSON blob) ----------
CREATE OR REPLACE FUNCTION trips_breakdowns_and_rates(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
) RETURNS jsonb AS $$
  WITH real_trips AS (
    SELECT g.* FROM group_trips g
    WHERE g.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
      AND g.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))
  ),
  status_b AS (
    SELECT jsonb_agg(jsonb_build_object('label', initcap(status), 'count', n) ORDER BY n DESC) j
    FROM (SELECT status, count(*) n FROM real_trips GROUP BY status) t
  ),
  style_b AS (
    SELECT jsonb_agg(jsonb_build_object(
             'label', CASE hosting_style WHEN 'A' THEN 'Plan together' WHEN 'B' THEN 'Leader-led' WHEN 'C' THEN 'Operator' ELSE hosting_style END,
             'count', n) ORDER BY n DESC) j
    FROM (SELECT hosting_style, count(*) n FROM real_trips GROUP BY hosting_style) t
  ),
  budget_b AS (
    SELECT jsonb_agg(jsonb_build_object('label', label, 'count', n) ORDER BY ord) j
    FROM (
      SELECT
        CASE
          WHEN budget_min IS NULL THEN 'Not set'
          WHEN budget_min < 500 THEN '< $500'
          WHEN budget_min < 1000 THEN '$500–1k'
          WHEN budget_min < 2000 THEN '$1k–2k'
          ELSE '$2k+'
        END AS label,
        CASE
          WHEN budget_min IS NULL THEN 5
          WHEN budget_min < 500 THEN 1
          WHEN budget_min < 1000 THEN 2
          WHEN budget_min < 2000 THEN 3
          ELSE 4
        END AS ord,
        count(*) n
      FROM real_trips
      GROUP BY 1, 2
    ) t
  ),
  dest_b AS (
    SELECT jsonb_agg(jsonb_build_object('label', COALESCE(country, 'Unknown'), 'count', n) ORDER BY n DESC) j
    FROM (
      SELECT d.country, count(*) n
      FROM real_trips rt
      JOIN group_trip_destinations d ON d.trip_id = rt.id
      GROUP BY d.country
      ORDER BY n DESC
      LIMIT 8
    ) t
  ),
  rates AS (
    SELECT
      avg(participant_count::numeric / NULLIF(max_participants, 0))
        FILTER (WHERE max_participants IS NOT NULL AND max_participants > 0)                       AS fill_rate_avg,
      (count(*) FILTER (WHERE max_participants IS NOT NULL AND participant_count >= max_participants))::numeric
        / NULLIF(count(*) FILTER (WHERE max_participants IS NOT NULL AND max_participants > 0), 0)  AS pct_reached_full,
      (count(*) FILTER (WHERE status = 'cancelled'))::numeric / NULLIF(count(*), 0)                 AS cancellation_rate,
      count(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM group_trip_join_requests r WHERE r.trip_id = real_trips.id)
          AND NOT EXISTS (SELECT 1 FROM group_trip_participants p WHERE p.trip_id = real_trips.id AND p.role = 'member')
      )                                                                                            AS ghost_trips
    FROM real_trips
  ),
  approval AS (
    SELECT
      (count(*) FILTER (WHERE r.status = 'approved'))::numeric
        / NULLIF(count(*) FILTER (WHERE r.status IN ('approved', 'declined')), 0) AS approval_rate,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (r.reviewed_at - r.created_at)) / 3600.0
      ) FILTER (WHERE r.reviewed_at IS NOT NULL)                                  AS median_response_hours
    FROM group_trip_join_requests r
    JOIN group_trips g ON g.id = r.trip_id
    WHERE r.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
      AND r.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))
  )
  SELECT jsonb_build_object(
    'status',           COALESCE((SELECT j FROM status_b), '[]'::jsonb),
    'hosting_style',    COALESCE((SELECT j FROM style_b),  '[]'::jsonb),
    'budget',           COALESCE((SELECT j FROM budget_b), '[]'::jsonb),
    'top_destinations', COALESCE((SELECT j FROM dest_b),   '[]'::jsonb),
    'rates', jsonb_build_object(
      'fill_rate_avg',         (SELECT fill_rate_avg        FROM rates),
      'pct_reached_full',      (SELECT pct_reached_full     FROM rates),
      'cancellation_rate',     (SELECT cancellation_rate    FROM rates),
      'ghost_trips',           COALESCE((SELECT ghost_trips FROM rates), 0),
      'approval_rate',         (SELECT approval_rate        FROM approval),
      'median_response_hours', (SELECT median_response_hours FROM approval)
    )
  );
$$ LANGUAGE sql STABLE;

-- ---------- 4. Funnels (single JSON blob) ----------
CREATE OR REPLACE FUNCTION trips_funnels(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
) RETURNS jsonb AS $$
  WITH real_trips AS (
    SELECT g.* FROM group_trips g
    WHERE g.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
      AND g.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))
  ),
  life AS (
    SELECT
      count(*) AS created,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM group_trip_join_requests r WHERE r.trip_id = real_trips.id))                       AS with_request,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM group_trip_participants p WHERE p.trip_id = real_trips.id AND p.role = 'member')) AS with_member,
      count(*) FILTER (WHERE max_participants IS NOT NULL AND participant_count >= CEIL(max_participants / 2.0))                      AS half_full,
      count(*) FILTER (WHERE status = 'completed')                                                                                    AS completed
    FROM real_trips
  ),
  demand AS (
    SELECT
      count(*)                                          AS requests,
      count(*) FILTER (WHERE r.status = 'approved')     AS approved,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM group_trip_participants p
        WHERE p.trip_id = r.trip_id AND p.user_id = r.requester_id AND p.commitment_status = 'approved'
      ))                                                AS committed
    FROM group_trip_join_requests r
    JOIN group_trips g ON g.id = r.trip_id
    WHERE r.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
      AND r.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))
  )
  SELECT jsonb_build_object(
    'lifecycle', jsonb_build_array(
      jsonb_build_object('label', 'Created',        'count', (SELECT created      FROM life)),
      jsonb_build_object('label', '≥1 request',     'count', (SELECT with_request FROM life)),
      jsonb_build_object('label', '≥1 member',      'count', (SELECT with_member  FROM life)),
      jsonb_build_object('label', '≥50% full',      'count', (SELECT half_full    FROM life)),
      jsonb_build_object('label', 'Completed',      'count', (SELECT completed    FROM life))
    ),
    'demand', jsonb_build_array(
      jsonb_build_object('label', 'Requests',  'count', (SELECT requests  FROM demand)),
      jsonb_build_object('label', 'Approved',  'count', (SELECT approved  FROM demand)),
      jsonb_build_object('label', 'Committed', 'count', (SELECT committed FROM demand))
    )
  );
$$ LANGUAGE sql STABLE;
```

- [ ] **Step 2: Apply the migration to the remote DB**

Use the Supabase MCP `apply_migration` tool with name `trips_analytics_rpcs` and the file's SQL as the query. (This project applies migrations to the remote project; there is no local stack running.)

Expected: success, no error.

- [ ] **Step 3: Verify each RPC returns sane data**

Run via Supabase MCP `execute_sql` (or the SQL editor), one at a time:

```sql
SELECT * FROM trips_overview(NULL, NULL);
SELECT day, trips_created, join_requests FROM trips_overview_series(30) ORDER BY day DESC LIMIT 5;
SELECT jsonb_pretty(trips_breakdowns_and_rates(NULL, NULL));
SELECT jsonb_pretty(trips_funnels(NULL, NULL));
```

Expected:
- `trips_overview` → one row, all columns ≥ 0, `trips_created` ≥ the others' implied maxima.
- `trips_overview_series` → 30 rows, today first when sorted DESC.
- `trips_breakdowns_and_rates` → JSON with `status`/`hosting_style`/`budget`/`top_destinations` arrays and a `rates` object; rates are decimals in 0..1 or null, `ghost_trips` an integer.
- `trips_funnels` → `lifecycle` array of 5 (monotonically non-increasing counts) and `demand` array of 3.

If `trips_created` is 0 (empty data set), the funnels/breakdowns return empty arrays and rates are null — that's correct and the UI handles it (Step in Task 4).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608000000_trips_analytics_rpcs.sql
git commit -m "feat(analytics): add trip analytics Postgres RPCs"
```

---

## Task 2: Edge function `analytics-trips`

**Files:**
- Create: `supabase/functions/analytics-trips/index.ts`

- [ ] **Step 1: Write the edge function**

Create `supabase/functions/analytics-trips/index.ts` with exactly:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const SPARKLINE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

interface RequestBody { from?: string | null; to?: string | null }
interface Counter { total: number; prev: number; series: number[] }

const OVERVIEW_KEYS = [
  'trips_created', 'join_requests', 'members_joined', 'unique_hosts', 'commitments_approved',
] as const
type OverviewKey = typeof OVERVIEW_KEYS[number]

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ---------- helpers ----------
function isoMs(s: string | null): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

function prevRange(from: string | null, to: string | null): { prevFrom: string | null; prevTo: string | null } {
  const fromMs = isoMs(from), toMs = isoMs(to)
  if (fromMs === null || toMs === null) return { prevFrom: null, prevTo: null }
  const L = toMs - fromMs
  return { prevFrom: new Date(fromMs - L).toISOString(), prevTo: new Date(fromMs).toISOString() }
}

async function overviewTotals(from: string | null, to: string | null): Promise<Record<OverviewKey, number>> {
  const { data, error } = await supabase.rpc('trips_overview', { p_from: from, p_to: to })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) ?? {}
  const out = {} as Record<OverviewKey, number>
  for (const k of OVERVIEW_KEYS) out[k] = Number(row?.[k]) || 0
  return out
}

async function overviewSeries(): Promise<Record<OverviewKey, number[]>> {
  const { data, error } = await supabase.rpc('trips_overview_series', { p_days: SPARKLINE_DAYS })
  if (error) throw error
  const todayMidnight = new Date(); todayMidnight.setUTCHours(0, 0, 0, 0)
  const cutoffMs = todayMidnight.getTime() - (SPARKLINE_DAYS - 1) * DAY_MS
  const series = {} as Record<OverviewKey, number[]>
  for (const k of OVERVIEW_KEYS) series[k] = new Array<number>(SPARKLINE_DAYS).fill(0)
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const t = new Date(`${row.day}T00:00:00Z`).getTime()
    if (Number.isNaN(t)) continue
    const idx = Math.round((t - cutoffMs) / DAY_MS)
    if (idx < 0 || idx >= SPARKLINE_DAYS) continue
    for (const k of OVERVIEW_KEYS) series[k][idx] = Number(row[k]) || 0
  }
  return series
}

// ---------- auth (identical pattern to analytics-dashboard) ----------
async function isAdmin(jwt: string): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error } = await userClient.auth.getUser(jwt)
  if (error || !user) return { ok: false, status: 401, reason: 'invalid token' }
  const { data, error: roleErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (roleErr) return { ok: false, status: 500, reason: 'role lookup failed' }
  if (!data || data.role !== 'admin') return { ok: false, status: 403, reason: 'not an admin' }
  return { ok: true }
}

// ---------- handler ----------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing bearer token' }), { status: 401, headers: jsonHeaders })
  }
  const adminCheck = await isAdmin(authHeader.slice(7).trim())
  if (!adminCheck.ok) {
    return new Response(JSON.stringify({ error: adminCheck.reason }), { status: adminCheck.status, headers: jsonHeaders })
  }

  let body: RequestBody = {}
  try {
    if (req.headers.get('content-type')?.includes('application/json')) body = await req.json()
  } catch { body = {} }
  const from = body.from ?? null
  const to = body.to ?? null
  const { prevFrom, prevTo } = prevRange(from, to)
  const hasRange = !!(from && to)

  try {
    const [totals, prevTotals, series, brJson, fnJson] = await Promise.all([
      overviewTotals(from, to),
      hasRange ? overviewTotals(prevFrom, prevTo) : Promise.resolve(null),
      overviewSeries(),
      supabase.rpc('trips_breakdowns_and_rates', { p_from: from, p_to: to }),
      supabase.rpc('trips_funnels', { p_from: from, p_to: to }),
    ])
    if (brJson.error) throw brJson.error
    if (fnJson.error) throw fnJson.error

    const overview: Record<string, Counter> = {}
    for (const k of OVERVIEW_KEYS) {
      overview[k] = {
        total: totals[k],
        prev: prevTotals ? prevTotals[k] : 0,
        series: series[k],
      }
    }

    const br = brJson.data ?? {}
    const fn = fnJson.data ?? {}

    return new Response(JSON.stringify({
      range: { from, to },
      prev_range: { from: prevFrom, to: prevTo },
      overview,
      breakdowns: {
        status: br.status ?? [],
        hosting_style: br.hosting_style ?? [],
        budget: br.budget ?? [],
        top_destinations: br.top_destinations ?? [],
      },
      lifecycle_funnel: fn.lifecycle ?? [],
      demand_funnel: fn.demand ?? [],
      rates: br.rates ?? {
        fill_rate_avg: null, pct_reached_full: null, cancellation_rate: null,
        approval_rate: null, ghost_trips: 0, median_response_hours: null,
      },
    }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    console.error('[analytics-trips] error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message ?? 'internal error' }), { status: 500, headers: jsonHeaders })
  }
})
```

- [ ] **Step 2: Type-check the function with Deno**

Run: `deno check supabase/functions/analytics-trips/index.ts`
Expected: no errors. (If `deno` is not installed, skip — the function is validated at deploy time; note the skip.)

- [ ] **Step 3: Deploy the function**

Per `CLAUDE.md`, edge functions deploy by copy-pasting the file contents into the Supabase dashboard → Edge Functions → create a new function named `analytics-trips` → paste → Deploy. (Do NOT rename existing functions.)

- [ ] **Step 4: Smoke-test the deployed function as an admin**

In the app while logged in as an admin, or via curl with a valid admin JWT:

```bash
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/analytics-trips" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool | head -40
```

Expected: 200 with the `overview`/`breakdowns`/`lifecycle_funnel`/`demand_funnel`/`rates` keys. A non-admin JWT must return 403; no token returns 401.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/analytics-trips/index.ts
git commit -m "feat(analytics): add analytics-trips edge function"
```

---

## Task 3: Client service `analyticsTripsService.ts`

**Files:**
- Create: `src/services/analytics/analyticsTripsService.ts`

- [ ] **Step 1: Write the service**

Create `src/services/analytics/analyticsTripsService.ts` with exactly:

```ts
import { supabase, isSupabaseConfigured } from '../../config/supabase';

/** Same shape as the Users dashboard counter: total / prior-range / 30-day daily series. */
export interface TripCounter {
  total: number;
  prev: number;
  series: number[];
}

export interface NamedCount {
  label: string;
  count: number;
}

export const TRIP_OVERVIEW_KEYS = [
  'trips_created',
  'join_requests',
  'members_joined',
  'unique_hosts',
  'commitments_approved',
] as const;
export type TripOverviewKey = typeof TRIP_OVERVIEW_KEYS[number];

export interface TripsRates {
  fill_rate_avg: number | null;
  pct_reached_full: number | null;
  cancellation_rate: number | null;
  approval_rate: number | null;
  ghost_trips: number;
  median_response_hours: number | null;
}

export interface TripsDashboardData {
  range: { from: string | null; to: string | null };
  prev_range: { from: string | null; to: string | null };
  overview: Record<TripOverviewKey, TripCounter>;
  breakdowns: {
    status: NamedCount[];
    hosting_style: NamedCount[];
    budget: NamedCount[];
    top_destinations: NamedCount[];
  };
  lifecycle_funnel: NamedCount[];
  demand_funnel: NamedCount[];
  rates: TripsRates;
}

export interface TripsDashboardRange {
  from?: string | null;
  to?: string | null;
}

/**
 * Fetch the trips analytics dashboard. Caller must be an admin (`users.role = 'admin'`);
 * the edge function returns 401/403 otherwise.
 */
export async function fetchTripsDashboard(range: TripsDashboardRange = {}): Promise<TripsDashboardData> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }
  const body: Record<string, string> = {};
  if (range.from) body.from = range.from;
  if (range.to) body.to = range.to;

  const { data, error } = await supabase.functions.invoke<TripsDashboardData>('analytics-trips', { body });
  if (error) throw error;
  if (!data) throw new Error('Empty response from analytics-trips');
  return data;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `analyticsTripsService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/analytics/analyticsTripsService.ts
git commit -m "feat(analytics): add trips dashboard client service"
```

---

## Task 4: Extract shared tokens (refactor, no behavior change)

**Files:**
- Create: `src/screens/analytics/analyticsTokens.ts`
- Modify: `src/screens/AnalyticsDashboardScreen.tsx`

- [ ] **Step 1: Create the shared tokens module**

Create `src/screens/analytics/analyticsTokens.ts`. Move the **exact** `C` palette, `CARD_SHADOW`, `HIT`, the `deltaPct` helper, the `Sparkline` component, the `DeltaPill` component, and the `StatTile` component out of `AnalyticsDashboardScreen.tsx` into this file and `export` each. Copy the relevant `StyleSheet` entries they use (`tile`, `tileHeader`, `tileIconWrap`, `tileNumber`, `tileLabel`, `tileFooter`, `tileSpark`, `deltaPill`, `deltaPillUp`, `deltaPillDown`, `deltaText`, `deltaUp`, `deltaDown`, `deltaPlaceholder`) into a `StyleSheet.create` in this file. `StatTile`'s `eventKey`/`onInfo` props are generic strings here:

```ts
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';

export const TILE_W = (Dimensions.get('window').width - 32 - 10) / 2;
export const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

export const C = {
  bg: '#F4F5F7', card: '#FFFFFF', text: '#222B30', textSecondary: '#7B7B7B',
  label: '#4A5565', faint: '#AEB4BC', border: '#E5E7EB', divider: '#ECECEC',
  track: '#EEF0F2', accent: '#0788B0', accentSoft: '#E6F4F8', accentBg: '#F0F8FB',
  up: '#1B9E5A', upSoft: '#E7F6EE', down: '#C0392B', downSoft: '#FBE9E7',
  backdrop: 'rgba(0,0,0,0.45)',
};

export const CARD_SHADOW = Platform.select({
  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  android: { elevation: 2 },
  default: {},
});

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface Counter { total: number; prev: number; series: number[] }

export function deltaPct(total: number, prev: number): { value: number; up: boolean; flat: boolean } | null {
  if (prev <= 0) return null;
  const v = ((total - prev) / prev) * 100;
  return { value: Math.abs(v), up: v >= 0, flat: Math.abs(v) < 0.1 };
}

export function Sparkline({ data, height }: { data: number[]; height: number }) {
  const [width, setWidth] = useState(0);
  if (!data || data.length === 0) return <View style={{ height }} />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const stepX = data.length > 1 && width > 0 ? width / (data.length - 1) : 0;
  const padY = 3, usableH = height - padY * 2;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = padY + usableH - ((v - min) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <View style={{ height, width: '100%' }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Polyline points={points} fill="none" stroke={C.accent} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

export function DeltaPill({ counter }: { counter: Counter }) {
  const delta = deltaPct(counter.total, counter.prev);
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);
  if (!delta) {
    return <Text style={styles.deltaPlaceholder}>{isEmpty ? 'No events yet' : 'No prior data'}</Text>;
  }
  return (
    <View style={[styles.deltaPill, delta.up ? styles.deltaPillUp : styles.deltaPillDown]}>
      <Text style={[styles.deltaText, delta.up ? styles.deltaUp : styles.deltaDown]}>
        {delta.flat ? '— flat' : `${delta.up ? '▲' : '▼'} ${delta.value.toFixed(0)}%`}
      </Text>
    </View>
  );
}

export function StatTile({ label, icon, counter, eventKey, onInfo }: {
  label: string; icon: IoniconName; counter: Counter; eventKey: string; onInfo: (e: string) => void;
}) {
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);
  return (
    <TouchableOpacity style={styles.tile} activeOpacity={0.7} onPress={() => onInfo(eventKey)}>
      <View style={styles.tileHeader}>
        <View style={styles.tileIconWrap}><Ionicons name={icon} size={15} color={C.accent} /></View>
        <Ionicons name="information-circle-outline" size={15} color={C.faint} />
      </View>
      <Text style={styles.tileNumber} numberOfLines={1}>{counter.total.toLocaleString()}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.tileFooter}>
        <DeltaPill counter={counter} />
        {!isEmpty && <View style={styles.tileSpark}><Sparkline data={counter.series} height={22} /></View>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: { width: TILE_W, backgroundColor: C.card, borderRadius: 14, padding: 14, minHeight: 150, borderWidth: 1, borderColor: C.border, ...CARD_SHADOW },
  tileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  tileIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  tileNumber: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.6 },
  tileLabel: { fontSize: 12, fontWeight: '600', color: C.textSecondary, lineHeight: 16, marginTop: 2, minHeight: 32 },
  tileFooter: { marginTop: 'auto', paddingTop: 8 },
  tileSpark: { marginTop: 8 },
  deltaPill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  deltaPillUp: { backgroundColor: C.upSoft },
  deltaPillDown: { backgroundColor: C.downSoft },
  deltaText: { fontSize: 11, fontWeight: '700' },
  deltaUp: { color: C.up },
  deltaDown: { color: C.down },
  deltaPlaceholder: { fontSize: 10.5, fontWeight: '500', color: C.faint, fontStyle: 'italic' },
});
```

- [ ] **Step 2: Update `AnalyticsDashboardScreen.tsx` to import from the tokens module**

In `src/screens/AnalyticsDashboardScreen.tsx`:
- Delete the local `C`, `CARD_SHADOW`, `HIT`, `TILE_W`, `deltaPct`, `Sparkline`, `DeltaPill`, `StatTile` definitions and the StyleSheet entries that moved (`tile*`, `delta*`).
- Add at the top: `import { C, CARD_SHADOW, HIT, TILE_W, Sparkline, DeltaPill, StatTile, deltaPct, IoniconName } from './analytics/analyticsTokens';`
- Replace the local `type IoniconName = …` with the imported one.
- Keep everything else (the `FunnelSection`, `InfoSheet`, range bar, etc.) unchanged.

- [ ] **Step 3: Verify the Users dashboard is unchanged**

Run: `npx tsc --noEmit`
Expected: no errors.
Then open the app as admin → Settings → Analytics. The Users dashboard (Overview tiles + both funnels) must render **identically** to before. This proves the extraction was behavior-preserving.

- [ ] **Step 4: Commit**

```bash
git add src/screens/analytics/analyticsTokens.ts src/screens/AnalyticsDashboardScreen.tsx
git commit -m "refactor(analytics): extract shared dashboard tokens/components"
```

---

## Task 5: Trips view + generic components

**Files:**
- Create: `src/screens/analytics/TripsAnalyticsView.tsx`

- [ ] **Step 1: Write the Trips view and its three generic components**

Create `src/screens/analytics/TripsAnalyticsView.tsx` with exactly:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, CARD_SHADOW, StatTile, IoniconName } from './analyticsTokens';
import {
  fetchTripsDashboard, TripsDashboardData, NamedCount, TripCounter, TripOverviewKey,
} from '../../services/analytics/analyticsTripsService';

const EMPTY_COUNTER: TripCounter = { total: 0, prev: 0, series: [] };

const OVERVIEW_TILES: { key: TripOverviewKey; label: string; icon: IoniconName }[] = [
  { key: 'trips_created',        label: 'Trips created',     icon: 'add-circle-outline' },
  { key: 'join_requests',        label: 'Join requests',     icon: 'hand-left-outline' },
  { key: 'members_joined',       label: 'Members joined',    icon: 'people-outline' },
  { key: 'unique_hosts',         label: 'Unique hosts',      icon: 'person-outline' },
  { key: 'commitments_approved', label: 'Commitments',       icon: 'checkmark-circle-outline' },
];

// Short, accurate definitions for the info sheet (keyed by tile/metric).
export const TRIP_METRIC_INFO: Record<string, { what: string; when: string }> = {
  trips_created:        { what: 'Group trips published in the selected period. Excludes trips hosted by demo/admin accounts.', when: 'When a host creates a group trip.' },
  join_requests:        { what: 'Requests to join a trip in the selected period.', when: 'When a user taps "Request to join".' },
  members_joined:       { what: 'People who became trip members (role = member) in the selected period.', when: 'When a host approves a join request.' },
  unique_hosts:        { what: 'Distinct hosts who created at least one trip in the selected period.', when: 'Counted from trips created in range.' },
  commitments_approved: { what: 'Commitments a host approved (flight booked, insurance, etc.) in the selected period.', when: 'When a host approves a member\'s commitment.' },
};

interface TripsAnalyticsViewProps {
  range: { from: string | null; to: string | null };
  onInfo: (key: string) => void;
  reloadToken: number; // bump to force refetch (e.g. pull-to-refresh from parent)
}

export function TripsAnalyticsView({ range, onInfo, reloadToken }: TripsAnalyticsViewProps) {
  const [data, setData] = useState<TripsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTripsDashboard({ from: range.from ?? undefined, to: range.to ?? undefined })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, reloadToken]);

  if (loading && !data) {
    return (
      <View style={styles.firstLoad}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={styles.firstLoadText}>Loading trip analytics…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.errorBanner}>
        <Ionicons name="alert-circle" size={18} color={C.down} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (!data) return null;

  return (
    <>
      <SectionLabel text="Overview" />
      <View style={styles.gridWrap}>
        {OVERVIEW_TILES.map(t => (
          <StatTile
            key={t.key}
            label={t.label}
            icon={t.icon}
            counter={data.overview[t.key] ?? EMPTY_COUNTER}
            eventKey={t.key}
            onInfo={onInfo}
          />
        ))}
      </View>

      <SectionLabel text="Funnels" />
      <FunnelCard title="Trip lifecycle" subtitle="Created → completed" icon="trending-down-outline" steps={data.lifecycle_funnel} />
      <FunnelCard title="Demand" subtitle="Request → committed" icon="git-compare-outline" steps={data.demand_funnel} />

      <SectionLabel text="Key rates" />
      <RatesCard rates={data.rates} />

      <SectionLabel text="Breakdowns" />
      <BreakdownCard title="By status" icon="ellipse-outline" items={data.breakdowns.status} />
      <BreakdownCard title="By hosting style" icon="options-outline" items={data.breakdowns.hosting_style} />
      <BreakdownCard title="Top destinations" icon="location-outline" items={data.breakdowns.top_destinations} />
      <BreakdownCard title="By budget" icon="cash-outline" items={data.breakdowns.budget} />
    </>
  );
}

// ============== Section label ==============
function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text.toUpperCase()}</Text>;
}

// ============== Generic funnel card ==============
function FunnelCard({ title, subtitle, icon, steps }: { title: string; subtitle?: string; icon: IoniconName; steps: NamedCount[] }) {
  const top = steps[0]?.count ?? 0;
  const bottom = steps[steps.length - 1]?.count ?? 0;
  const max = top || 1;
  const allZero = steps.every(s => s.count === 0);
  const overallConv = top > 0 ? (bottom / top) * 100 : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIconWrap}><Ionicons name={icon} size={16} color={C.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
        </View>
      </View>

      {allZero ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={20} color={C.faint} />
          <Text style={styles.emptyText}>No trips in this range yet.</Text>
        </View>
      ) : (
        <>
          <View style={styles.convCallout}>
            <View style={styles.cardIconWrap}><Ionicons name="git-compare-outline" size={16} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.convLabel}>End-to-end</Text>
              <Text style={styles.convSub}>{top.toLocaleString()} → {bottom.toLocaleString()}</Text>
            </View>
            <Text style={styles.convPctBig}>{overallConv !== null ? `${overallConv.toFixed(0)}%` : '—'}</Text>
          </View>

          <View style={{ marginTop: 4 }}>
            {steps.map((s, i) => {
              const pct = max > 0 ? (s.count / max) * 100 : 0;
              const dropoff = i > 0 ? steps[i - 1].count - s.count : 0;
              const dropoffPct = i > 0 && steps[i - 1].count > 0 ? (dropoff / steps[i - 1].count) * 100 : 0;
              return (
                <View key={s.label} style={[styles.funnelRow, i > 0 && styles.funnelRowDivider]}>
                  <View style={styles.funnelTopRow}>
                    <Text style={styles.funnelLabel} numberOfLines={1}>{s.label}</Text>
                    <Text style={styles.funnelNumber}>{s.count.toLocaleString()}</Text>
                  </View>
                  <View style={styles.funnelBarRow}>
                    <View style={styles.funnelBarWrap}><View style={[styles.funnelBar, { width: `${Math.max(pct, 2)}%` }]} /></View>
                    <Text style={styles.funnelPct}>{pct.toFixed(0)}%</Text>
                  </View>
                  {i > 0 && dropoff > 0 && (
                    <Text style={styles.funnelDropoff}>↓ {dropoff.toLocaleString()} dropped off ({dropoffPct.toFixed(0)}%)</Text>
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

// ============== Generic breakdown card ==============
function BreakdownCard({ title, icon, items }: { title: string; icon: IoniconName; items: NamedCount[] }) {
  const total = items.reduce((sum, it) => sum + it.count, 0);
  const max = Math.max(1, ...items.map(it => it.count));
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIconWrap}><Ionicons name={icon} size={16} color={C.accent} /></View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {items.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No data in this range.</Text></View>
      ) : (
        items.map((it, i) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          const barPct = (it.count / max) * 100;
          return (
            <View key={it.label} style={[styles.breakRow, i > 0 && styles.funnelRowDivider]}>
              <View style={styles.funnelTopRow}>
                <Text style={styles.funnelLabel} numberOfLines={1}>{it.label}</Text>
                <Text style={styles.breakNumber}>{it.count.toLocaleString()} · {pct.toFixed(0)}%</Text>
              </View>
              <View style={styles.funnelBarWrap}><View style={[styles.funnelBar, { width: `${Math.max(barPct, 2)}%` }]} /></View>
            </View>
          );
        })
      )}
    </View>
  );
}

// ============== Rates card ==============
function RatesCard({ rates }: { rates: TripsDashboardData['rates'] }) {
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);
  const hrs = (v: number | null) => (v === null ? '—' : v < 1 ? `${Math.round(v * 60)} min` : `${v.toFixed(1)} h`);
  const rows: { label: string; value: string }[] = [
    { label: 'Avg fill rate', value: pct(rates.fill_rate_avg) },
    { label: 'Reached full', value: pct(rates.pct_reached_full) },
    { label: 'Cancellation rate', value: pct(rates.cancellation_rate) },
    { label: 'Approval rate', value: pct(rates.approval_rate) },
    { label: 'Median host response', value: hrs(rates.median_response_hours) },
    { label: 'Ghost trips', value: rates.ghost_trips.toLocaleString() },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.ratesGrid}>
        {rows.map(r => (
          <View key={r.label} style={styles.rateCell}>
            <Text style={styles.rateValue}>{r.value}</Text>
            <Text style={styles.rateLabel}>{r.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  firstLoad: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  firstLoadText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  errorBanner: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.downSoft, borderRadius: 12, padding: 14, marginBottom: 16 },
  errorText: { fontSize: 13, color: C.down, flex: 1, fontWeight: '500' },

  sectionLabel: { fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 0.6, marginBottom: 10 },

  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },

  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border, ...CARD_SHADOW },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  cardIconWrap: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  cardSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  empty: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: C.bg },
  emptyText: { fontSize: 12.5, color: C.textSecondary, fontStyle: 'italic' },

  convCallout: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.accentBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: C.accentSoft, marginBottom: 6 },
  convLabel: { fontSize: 12.5, fontWeight: '700', color: C.text },
  convSub: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  convPctBig: { fontSize: 24, fontWeight: '800', color: C.accent, letterSpacing: -0.5 },

  funnelRow: { paddingVertical: 13 },
  funnelRowDivider: { borderTopWidth: 1, borderTopColor: C.divider },
  funnelTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  funnelLabel: { fontSize: 13, fontWeight: '600', color: C.text, flex: 1, paddingRight: 10 },
  funnelNumber: { fontSize: 17, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  funnelBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  funnelBarWrap: { flex: 1, height: 10, backgroundColor: C.track, borderRadius: 5, overflow: 'hidden' },
  funnelBar: { height: '100%', backgroundColor: C.accent, borderRadius: 5 },
  funnelPct: { fontSize: 11, fontWeight: '600', color: C.textSecondary, width: 34, textAlign: 'right' },
  funnelDropoff: { fontSize: 11, color: C.down, marginTop: 7, fontWeight: '500' },

  breakRow: { paddingVertical: 11 },
  breakNumber: { fontSize: 13, fontWeight: '700', color: C.text },

  ratesGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  rateCell: { width: '33.33%', paddingVertical: 10, alignItems: 'center' },
  rateValue: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  rateLabel: { fontSize: 10.5, color: C.textSecondary, marginTop: 3, textAlign: 'center', fontWeight: '600' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/analytics/TripsAnalyticsView.tsx
git commit -m "feat(analytics): add Trips analytics view + generic cards"
```

---

## Task 6: Wire the `Users | Trips` toggle into the dashboard screen

**Files:**
- Modify: `src/screens/AnalyticsDashboardScreen.tsx`

- [ ] **Step 1: Add the tab state and segmented control**

In `AnalyticsDashboardScreen.tsx`:

1. Add the import: `import { TripsAnalyticsView, TRIP_METRIC_INFO } from './analytics/TripsAnalyticsView';`
2. Add state inside the component (near the other `useState`s):

```tsx
const [tab, setTab] = useState<'users' | 'trips'>('users');
const [reloadToken, setReloadToken] = useState(0);
const [tripInfoKey, setTripInfoKey] = useState<string | null>(null);
```

3. Immediately under the sticky range bar `</View>` (line ~319, before the body `ScrollView`), add the segmented control:

```tsx
<View style={styles.segmentWrap}>
  {(['users', 'trips'] as const).map(t => (
    <TouchableOpacity
      key={t}
      style={[styles.segment, tab === t && styles.segmentActive]}
      activeOpacity={0.8}
      onPress={() => setTab(t)}
    >
      <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
        {t === 'users' ? 'Users' : 'Trips'}
      </Text>
    </TouchableOpacity>
  ))}
</View>
```

4. Add these styles to the `StyleSheet.create` block:

```tsx
segmentWrap: { flexDirection: 'row', backgroundColor: C.track, borderRadius: 10, padding: 3, marginHorizontal: 16, marginTop: 12, gap: 3 },
segment: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
segmentActive: { backgroundColor: C.card, ...CARD_SHADOW },
segmentText: { fontSize: 13.5, fontWeight: '700', color: C.textSecondary },
segmentTextActive: { color: C.accent },
```

- [ ] **Step 2: Render the Trips body when the Trips tab is active**

Inside the body `ScrollView`, wrap the existing Users content (`{data && ( … )}` block at lines ~348–392) so it only renders when `tab === 'users'`, and add the Trips branch:

```tsx
{tab === 'users' && data && (
  <>
    {/* …existing Overview + Funnels JSX, unchanged… */}
  </>
)}

{tab === 'trips' && (
  <TripsAnalyticsView
    range={{ from: range.from, to: range.to }}
    onInfo={setTripInfoKey}
    reloadToken={reloadToken}
  />
)}
```

Also update the `RefreshControl` `onRefresh` so pull-to-refresh refetches the active tab:

```tsx
onRefresh={() => { if (tab === 'users') { load(range); } else { setReloadToken(x => x + 1); } }}
```

- [ ] **Step 3: Show trip metric info in a bottom sheet**

Add a second info sheet for trip metrics, just after the existing `<InfoSheet … />` (line ~395). Reuse the existing `BottomSheet` shell:

```tsx
<BottomSheet visible={tripInfoKey !== null} onClose={() => setTripInfoKey(null)}>
  {tripInfoKey && TRIP_METRIC_INFO[tripInfoKey] && (
    <>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{tripInfoKey}</Text>
        <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setTripInfoKey(null)} hitSlop={HIT} activeOpacity={0.7}>
          <Ionicons name="close" size={18} color={C.label} />
        </TouchableOpacity>
      </View>
      <View style={styles.sheetBody}>
        <Text style={styles.infoSectionLabel}>WHAT IT COUNTS</Text>
        <Text style={styles.infoText}>{TRIP_METRIC_INFO[tripInfoKey].what}</Text>
        <Text style={[styles.infoSectionLabel, { marginTop: 18 }]}>WHEN IT'S RECORDED</Text>
        <Text style={styles.infoText}>{TRIP_METRIC_INFO[tripInfoKey].when}</Text>
      </View>
      <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={() => setTripInfoKey(null)} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Got it</Text>
        </TouchableOpacity>
      </View>
    </>
  )}
</BottomSheet>
```

- [ ] **Step 4: Update the header subtitle to reflect the active tab (optional polish)**

The header subtitle currently always reads "Demo & admins excluded · {range}". Leave it — it's accurate for both tabs (trip RPCs apply the same exclusion). No change needed.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Visual verification on the simulator**

Open the app as an admin → Settings → Analytics.
- Confirm the `Users | Trips` toggle appears under the range chips.
- `Users` tab: unchanged from before.
- `Trips` tab: shows Overview tiles (with sparklines where data exists), the two funnels, the rates grid, and four breakdown cards. Change the range chips (e.g. "Last 30 days") and confirm the Trips numbers refetch and update. Pull-to-refresh works. Tapping a trip tile opens the info sheet.
- If there are zero trips in range, cards show their empty states (no crash).

Use the `visual-verify` skill (or `mcp__expo__automation_take_screenshot`) to capture the Trips tab.

- [ ] **Step 7: Commit**

```bash
git add src/screens/AnalyticsDashboardScreen.tsx
git commit -m "feat(analytics): add Users/Trips toggle and Trips dashboard tab"
```

---

## Deployment checklist (after all tasks)

1. **DB:** migration `20260608000000_trips_analytics_rpcs.sql` applied to the remote Supabase project (Task 1, Step 2).
2. **Edge function:** `analytics-trips` created and deployed via the Supabase dashboard (Task 2, Step 3). It reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (already present for `analytics-dashboard`).
3. **Client:** JS-only change — ships via OTA / next web deploy. No native rebuild, so `PRE_BUILD_CHECKLIST.md` is not triggered. If shipping to SwellyoLove, follow the `git push love main --force` step in `CLAUDE.md`.
4. **Access:** only `users.role = 'admin'` can see the toggle (entry point already gated in Settings) and the function enforces it server-side.

## Self-review notes

- **Spec coverage:** every Phase-1 metric in `trips-analytics-plan.html` maps to a task — overview tiles (Task 5), lifecycle + demand funnels (Tasks 1/5), status/style/budget/destination breakdowns (Tasks 1/5), and the six rates incl. ghost trips and median response (Task 1 `trips_breakdowns_and_rates`). Phase 2/3 explicitly deferred.
- **Type consistency:** `TripCounter`/`NamedCount`/`TripOverviewKey` defined once in the service (Task 3) and imported by the view (Task 5); `Counter` in the edge function (Task 2) is structurally identical. `OVERVIEW_KEYS` order matches between RPC columns (Task 1), edge function (Task 2), and tiles (Task 5).
- **No placeholders:** all SQL, TS, and TSX is complete and runnable; no TODO/TBD.
- **Risk isolation:** the only edit to live code is `AnalyticsDashboardScreen.tsx` (additive toggle) and the token extraction (behavior-preserving, verified in Task 4 Step 3). The live `analytics-dashboard` function and its RPCs are untouched.
```
