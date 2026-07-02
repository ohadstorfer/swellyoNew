-- explore_feed: sort by participant_count DESC (busiest trips first) instead of
-- created_at DESC. Keyset cursor becomes the composite (participant_count,
-- created_at, id) tuple — participant_count alone isn't unique, so created_at/id
-- stay as tie-breakers to keep pagination stable within a given count.
--
-- participant_count is a live, trigger-maintained column (trg_sync_participant_count
-- on group_trip_participants, see 20260531000004) — unlike created_at it can change
-- between two page fetches. Rows can therefore move across page boundaries between
-- requests; this is an inherent tradeoff of sorting by a mutable field and isn't
-- worked around here. It also means the client's isAppend() id-prefix check
-- (src/screens/trips/exploreDeckPagination.ts) can see a reorder on a realtime-
-- triggered refetch and reset deck scroll to card 0 — a pre-existing UX fallback,
-- not a new bug introduced here.
--
-- REFERENCE COPY — applied manually via the Supabase SQL editor (never `db push`).
-- Adds a new p_cursor_participant_count param, so DROP + CREATE (not just REPLACE)
-- and re-grant, same pattern as 20260616120000.

DROP FUNCTION IF EXISTS public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric);

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
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')
    AND (
      p_cursor_participant_count IS NULL
      OR gt.participant_count < p_cursor_participant_count
      OR (gt.participant_count = p_cursor_participant_count AND gt.created_at < p_cursor)
      OR (gt.participant_count = p_cursor_participant_count AND gt.created_at = p_cursor AND gt.id < p_cursor_id)
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

REVOKE EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric, int) TO authenticated;

CREATE INDEX IF NOT EXISTS group_trips_status_participants_created_id_idx
  ON public.group_trips (status, participant_count DESC, created_at DESC, id DESC);
