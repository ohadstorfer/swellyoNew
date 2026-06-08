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
