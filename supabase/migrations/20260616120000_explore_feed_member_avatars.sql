-- explore_feed: add member_avatars (up to 4 participant avatars, host first) so
-- the Explore card's social-proof cluster shows real faces instead of a generic
-- people icon. Member avatars can't be read by the client on Explore (RLS hides
-- participants of trips you're not in), so the SECURITY DEFINER RPC surfaces them
-- — same public social proof as the already-exposed host avatar + count.
--
-- Adding a column to a RETURNS TABLE changes the return type, so CREATE OR REPLACE
-- is rejected: DROP + CREATE, then re-apply the REVOKE/GRANT. The index from
-- 20260615120000 is left untouched.
--
-- REFERENCE COPY — applied manually via the Supabase SQL editor (never `db push`).
-- Supersedes 20260615120000_explore_feed_rpc.sql.

DROP FUNCTION IF EXISTS public.explore_feed(int, timestamptz, uuid);

CREATE FUNCTION public.explore_feed(
  p_limit int DEFAULT 10,
  p_cursor timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
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
         (SELECT array_agg(sub.av)
            FROM (
              SELECT s2.profile_image_url AS av
              FROM public.group_trip_participants p
              JOIN public.surfers s2 ON s2.user_id = p.user_id
              WHERE p.trip_id = gt.id AND s2.profile_image_url IS NOT NULL
              ORDER BY (p.user_id = gt.host_id) DESC, p.user_id
              LIMIT 4
            ) sub) AS member_avatars
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
