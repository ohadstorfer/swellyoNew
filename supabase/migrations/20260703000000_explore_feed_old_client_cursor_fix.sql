-- explore_feed: fix infinite-loop pagination for shipped (pre-participant-sort)
-- clients. Supersedes 20260701010000_explore_feed_sort_by_participants.sql.
--
-- INCIDENT (reported 2026-07-03, live since 2026-07-01): 20260701010000 gated the
-- whole keyset predicate on `p_cursor_participant_count IS NULL` — but shipped
-- production builds only send the old (p_cursor, p_cursor_id) pair, so for every
-- real user the cursor was IGNORED: page 2 returned the same rows as page 1, the
-- limit+1 probe always said "more", and the Explore deck appended the same trips
-- forever ("carousel loops"). Only dev bundles (which send the 7th param) paged
-- correctly, which is why it passed verification.
--
-- Fix: gate the cursor on `p_cursor IS NULL` and, when the participant-count
-- member of the tuple is missing (old clients), reconstruct it server-side from
-- the cursor row itself (LATERAL lookup by p_cursor_id). Old and new clients now
-- produce identical, terminating pages. If the cursor row was deleted between
-- pages, the lookup is NULL, every comparison is NULL, and the feed just ends —
-- acceptable (pull-to-refresh restarts it).
--
-- Same signature as 20260701010000 ⇒ CREATE OR REPLACE, grants preserved.
-- REFERENCE COPY — applied to prod 2026-07-03 via MCP execute_sql (never `db push`).

CREATE OR REPLACE FUNCTION public.explore_feed(
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
  cost_per_person numeric, budget_min numeric, budget_max numeric,
  max_participants int, participant_count int, created_at timestamptz,
  destination jsonb, host_name text, host_avatar text, member_avatars text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT gt.id, gt.host_id, gt.status, gt.hosting_style, gt.title, gt.hero_image_url,
         gt.start_date, gt.end_date, gt.dates_set_in_stone, gt.date_months,
         gt.cost_per_person, gt.budget_min, gt.budget_max,
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
  -- Effective participant-count cursor: shipped (pre-2026-07) clients send only
  -- (created_at, id) — reconstruct the missing tuple member from the cursor row
  -- so their pagination stays correct under the participant_count ordering.
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
    -- Month filter (mirrors JS tripInMonth, OR'd across selected months): a trip
    -- matches if its date_months overlaps the set, OR a firm start..end range
    -- covers any selected month. No dates ⇒ matches nothing. Off when NULL/empty.
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
    -- Budget filter (mirrors JS tripInBudget, "below"/"above" OR'd): collapse the
    -- trip into a [lo, hi] band, then test the selected threshold bound(s).
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
