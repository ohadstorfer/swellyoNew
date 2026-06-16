-- my_trips_feed: the My Trips list (the caller's participant trips + pending
-- join-request trips) enriched with host name/avatar + member avatars + count in
-- ONE round-trip — the My Trips analogue of explore_feed. Replaces the previous
-- 4-query path (listMyTripsByBucket's 2 queries + getTripCardMeta's 2 queries).
--
-- Bucketing (approved / pending / past) stays in JS (fetchMyTripsFeed) because it
-- depends on date_months month-arithmetic; the RPC just returns every relevant
-- row tagged with `membership` so the client can bucket without re-querying.
--
-- SECURITY DEFINER + auth.uid(): the function reads the CALLER's rows only
-- (auth.uid() reflects the caller's JWT even under SECURITY DEFINER). It takes no
-- user-id parameter on purpose — a user cannot ask for someone else's trip list.
-- Definer rights also let it surface member avatars for pending-request trips the
-- caller isn't a participant of yet (same public social proof explore_feed shows).
--
-- REFERENCE COPY — applied manually via the Supabase SQL editor (never `db push`).

CREATE OR REPLACE FUNCTION public.my_trips_feed()
RETURNS TABLE (
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric,
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
    -- Trips the caller is a participant of (host or member).
    SELECT gt.*, 'participant'::text AS membership
    FROM public.group_trips gt
    JOIN public.group_trip_participants p
      ON p.trip_id = gt.id AND p.user_id = (SELECT uid FROM me)
    UNION ALL
    -- Trips the caller has a pending join request for AND isn't already in.
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
         t.cost_per_person, t.budget_min, t.budget_max,
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

-- Keyset/lookup support for the two driving joins (no-ops if already present).
CREATE INDEX IF NOT EXISTS group_trip_participants_user_trip_idx
  ON public.group_trip_participants (user_id, trip_id);
CREATE INDEX IF NOT EXISTS group_trip_join_requests_requester_status_idx
  ON public.group_trip_join_requests (requester_id, status);
