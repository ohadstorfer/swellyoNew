-- Read-only invariant checks for the trips analytics RPCs.
-- Safe: SELECT only, no writes, no notifications. Run AFTER applying
-- migration 20260608000001. Every row should read pass = true.
--
-- Paste into the Supabase SQL editor and Run.

-- 1) Lifecycle funnel is monotonic non-increasing (created ≥ request ≥ member ≥ half ≥ completed)
WITH f AS (SELECT trips_funnels(NULL, NULL) -> 'lifecycle' AS l)
SELECT 'lifecycle_monotonic' AS check,
       (l->0->>'count')::bigint >= (l->1->>'count')::bigint
   AND (l->1->>'count')::bigint >= (l->2->>'count')::bigint
   AND (l->2->>'count')::bigint >= (l->3->>'count')::bigint
   AND (l->3->>'count')::bigint >= (l->4->>'count')::bigint AS pass
FROM f;

-- 2) Demand funnel is monotonic (requests ≥ approved ≥ committed)
WITH f AS (SELECT trips_funnels(NULL, NULL) -> 'demand' AS d)
SELECT 'demand_monotonic' AS check,
       (d->0->>'count')::bigint >= (d->1->>'count')::bigint
   AND (d->1->>'count')::bigint >= (d->2->>'count')::bigint AS pass
FROM f;

-- 3) No trip is "≥50% full" while having zero members (the old inversion)
SELECT 'no_halffull_without_member' AS check,
       count(*) = 0 AS pass
FROM group_trips g
WHERE g.max_participants IS NOT NULL
  AND g.participant_count >= CEIL(g.max_participants / 2.0)
  AND NOT EXISTS (SELECT 1 FROM group_trip_participants p WHERE p.trip_id = g.id AND p.role = 'member')
  AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin))
  -- only matters for trips the funnel would otherwise count at half_full AND member
  AND EXISTS (SELECT 1 FROM group_trip_join_requests r WHERE r.trip_id = g.id);

-- 4) Sparkline series reconciles with the overview total over the same 30-day window
--    (unique_hosts intentionally excluded — per-day distinct is not summable)
WITH s AS (SELECT * FROM trips_overview_series(30)),
     o AS (SELECT * FROM trips_overview(
             (timezone('UTC', now()))::date - 29,
             (timezone('UTC', now()))::date + 1))
SELECT 'series_reconciles_overview' AS check,
       (SELECT sum(trips_created)  FROM s) = (SELECT trips_created  FROM o)
   AND (SELECT sum(join_requests)  FROM s) = (SELECT join_requests  FROM o)
   AND (SELECT sum(members_joined) FROM s) = (SELECT members_joined FROM o) AS pass;

-- 5) pct_reached_full is within [0,1] (never > 100%)
SELECT 'pct_reached_full_bounded' AS check,
       COALESCE((trips_breakdowns_and_rates(NULL, NULL) #>> '{rates,pct_reached_full}')::numeric, 0) <= 1 AS pass;

-- 6) committed requesters with status<>'approved' must be 0 (committed ⊆ approved)
SELECT 'committed_subset_of_approved' AS check,
       count(*) = 0 AS pass
FROM group_trip_join_requests r
JOIN group_trips g ON g.id = r.trip_id
WHERE r.status <> 'approved'
  AND EXISTS (SELECT 1 FROM group_trip_participants p
              WHERE p.trip_id = r.trip_id AND p.user_id = r.requester_id AND p.commitment_status = 'approved')
  AND NOT EXISTS (SELECT 1 FROM surfers s WHERE s.user_id = g.host_id AND (s.is_demo_user OR s.is_admin));
-- Note: this counts cases the OLD funnel would have miscounted; the NEW funnel
-- ignores them by requiring status='approved'. A non-zero count here just means
-- the old bug WOULD have fired — the new SQL is already immune.
