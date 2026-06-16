-- explore_feed: one-round-trip Explore list (trips + host name/avatar + count),
-- keyset paginated. SECURITY DEFINER but reads only public data (group_trips RLS
-- is USING(true); surfers RLS is USING(true); host name/avatar already public).
-- The visibility clause future-proofs against private/friends trips going live.
--
-- REFERENCE COPY — applied manually via the Supabase SQL editor (never `supabase db push`).

CREATE OR REPLACE FUNCTION public.explore_feed(
  p_limit int DEFAULT 10,
  p_cursor timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric,
  max_participants int, participant_count int, created_at timestamptz,
  destination jsonb, host_name text, host_avatar text
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
         s.name AS host_name, s.profile_image_url AS host_avatar
  FROM public.group_trips gt
  LEFT JOIN public.surfers s ON s.user_id = gt.host_id
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')
    AND (
      p_cursor IS NULL
      OR gt.created_at < p_cursor
      OR (gt.created_at = p_cursor AND gt.id < p_cursor_id)
    )
  ORDER BY gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS group_trips_status_created_id_idx
  ON public.group_trips (status, created_at DESC, id DESC);
