-- Multi-currency pricing fix: the Explore + My Trips card lists come from the
-- explore_feed / my_trips_feed RPCs, whose RETURNS TABLE did NOT include the new
-- budget_fx_rate column — so trip CARDS fell back to $ for Israeli viewers even
-- though trip DETAIL (select *) showed ₪ correctly. Add budget_fx_rate to both
-- RPCs' RETURNS TABLE + inner SELECT so the frozen ILS rate reaches the cards.
--
-- Adding a column to RETURNS TABLE changes the return type, so CREATE OR REPLACE
-- is illegal here — must DROP + CREATE. DROP drops grants and CREATE re-adds the
-- default PUBLIC grant, so REVOKE/GRANT is reapplied (matches each fn's history).
--
-- Bodies are byte-for-byte the current live definitions (verified via
-- pg_get_functiondef 2026-07-07) with ONLY the budget_fx_rate lines added.
-- REFERENCE COPY — apply manually in the Supabase SQL editor (never `db push`).

-- ---------------------------------------------------------------------------
-- explore_feed (7-arg)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric, int);

CREATE FUNCTION public.explore_feed(
  p_limit int DEFAULT 10,
  p_cursor timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_months text[] DEFAULT NULL,
  p_budget_min numeric DEFAULT NULL,
  p_budget_max numeric DEFAULT NULL,
  p_cursor_participant_count int DEFAULT NULL
)
RETURNS TABLE (
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric,
  max_participants int, participant_count int, created_at timestamptz,
  destination jsonb, host_name text, host_avatar text, member_avatars text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT gt.id, gt.host_id, gt.status, gt.hosting_style, gt.title, gt.hero_image_url,
         gt.start_date, gt.end_date, gt.dates_set_in_stone, gt.date_months,
         gt.cost_per_person, gt.budget_min, gt.budget_max, gt.budget_fx_rate,
         gt.max_participants, gt.participant_count, gt.created_at,
         (SELECT jsonb_build_object('name', d.name, 'short_label', d.short_label,
                   'country', d.country, 'admin_level_1', d.admin_level_1,
                   'lat', d.lat, 'lng', d.lng)
            FROM public.group_trip_destinations d WHERE d.trip_id = gt.id) AS destination,
         s.name AS host_name, s.profile_image_url AS host_avatar,
         (SELECT array_agg(sub.av) FROM (
              SELECT s2.profile_image_url AS av FROM public.group_trip_participants p
              JOIN public.surfers s2 ON s2.user_id = p.user_id
              WHERE p.trip_id = gt.id AND s2.profile_image_url IS NOT NULL
              ORDER BY (p.user_id = gt.host_id) DESC, p.user_id LIMIT 4) sub) AS member_avatars
  FROM public.group_trips gt
  LEFT JOIN public.surfers s ON s.user_id = gt.host_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      p_cursor_participant_count,
      (SELECT g2.participant_count FROM public.group_trips g2 WHERE g2.id = p_cursor_id)
    ) AS pc
  ) cur
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')
    AND (
      p_cursor IS NULL
      OR gt.participant_count < cur.pc
      OR (gt.participant_count = cur.pc AND gt.created_at < p_cursor)
      OR (gt.participant_count = cur.pc AND gt.created_at = p_cursor AND gt.id < p_cursor_id)
    )
    AND (
      p_months IS NULL OR array_length(p_months, 1) IS NULL
      OR gt.date_months && p_months
      OR (
        gt.start_date IS NOT NULL AND gt.end_date IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM unnest(p_months) AS m(ym)
          WHERE m.ym >= to_char(gt.start_date, 'YYYY-MM')
            AND m.ym <= to_char(gt.end_date, 'YYYY-MM')
        )
      )
    )
    AND (
      (p_budget_min IS NULL AND p_budget_max IS NULL)
      OR (
        (gt.cost_per_person IS NOT NULL OR gt.budget_min IS NOT NULL OR gt.budget_max IS NOT NULL)
        AND (
          (p_budget_max IS NOT NULL AND
             COALESCE(gt.cost_per_person, gt.budget_min, gt.budget_max) <= p_budget_max)
          OR (p_budget_min IS NOT NULL AND
             COALESCE(gt.cost_per_person, gt.budget_max, gt.budget_min) >= p_budget_min)
        )
      )
    )
  ORDER BY gt.participant_count DESC, gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- my_trips_feed (0-arg)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_trips_feed();

CREATE FUNCTION public.my_trips_feed()
RETURNS TABLE (
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric,
  max_participants int, participant_count int, created_at timestamptz,
  destination jsonb, host_name text, host_avatar text, member_avatars text[],
  membership text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  trips AS (
    SELECT gt.*, 'participant'::text AS membership
    FROM public.group_trips gt
    JOIN public.group_trip_participants p
      ON p.trip_id = gt.id AND p.user_id = (SELECT uid FROM me)
    UNION ALL
    SELECT gt.*, 'pending_request'::text AS membership
    FROM public.group_trips gt
    JOIN public.group_trip_join_requests jr
      ON jr.trip_id = gt.id
     AND jr.requester_id = (SELECT uid FROM me)
     AND jr.status = 'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.group_trip_participants p2
      WHERE p2.trip_id = gt.id AND p2.user_id = (SELECT uid FROM me)
    )
  )
  SELECT t.id, t.host_id, t.status, t.hosting_style, t.title, t.hero_image_url,
         t.start_date, t.end_date, t.dates_set_in_stone, t.date_months,
         t.cost_per_person, t.budget_min, t.budget_max, t.budget_fx_rate,
         t.max_participants, t.participant_count, t.created_at,
         (SELECT jsonb_build_object('name', d.name, 'short_label', d.short_label,
                   'country', d.country, 'admin_level_1', d.admin_level_1,
                   'lat', d.lat, 'lng', d.lng)
            FROM public.group_trip_destinations d WHERE d.trip_id = t.id) AS destination,
         s.name AS host_name, s.profile_image_url AS host_avatar,
         (SELECT array_agg(sub.av)
            FROM (
              SELECT s2.profile_image_url AS av
              FROM public.group_trip_participants pp
              JOIN public.surfers s2 ON s2.user_id = pp.user_id
              WHERE pp.trip_id = t.id AND s2.profile_image_url IS NOT NULL
              ORDER BY (pp.user_id = t.host_id) DESC, pp.user_id
              LIMIT 4
            ) sub) AS member_avatars,
         t.membership
  FROM trips t
  LEFT JOIN public.surfers s ON s.user_id = t.host_id;
$$;

REVOKE EXECUTE ON FUNCTION public.my_trips_feed() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.my_trips_feed() TO authenticated;
