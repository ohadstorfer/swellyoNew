-- My Trips: show trips where the user is active STAFF, not only participant /
-- pending request.
--
-- Why: 21 Oct 2026 test — "Under my trips I couldn't see it as a staff
-- member." Staff live in organized_trip_staff, and a staff member is usually
-- NOT a row in group_trip_participants, so my_trips_feed never returned their
-- trip.
--
-- How: one more UNION branch, membership = 'staff'. Staff who are also
-- participants (or have a pending request) keep their existing row — no
-- duplicates. Revoked staff and pending invites (user_id NULL) are left out.
--
-- Safe for apps already installed: fetchMyTripsFeed only reads
-- membership = 'participant' / 'pending_request', so an older app simply
-- ignores 'staff' rows. The app update that buckets 'staff' like
-- 'participant' is in src/services/trips/groupTripsService.ts.
--
-- Same signature, SECURITY DEFINER and search_path as the live function
-- (read from prod 2026-10-23). CREATE OR REPLACE keeps the grants; they are
-- restated below anyway.
--
-- Undo: re-run this file without the third UNION ALL branch.

create or replace function public.my_trips_feed()
returns table(
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric,
  budget_currency text, max_participants integer, participant_count integer,
  created_at timestamp with time zone, destination jsonb, host_name text, host_avatar text,
  member_avatars text[], membership text, member_status text
)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  WITH me AS (SELECT auth.uid() AS uid),
  trips AS (
    SELECT gt.*, 'participant'::text AS membership, p.status AS member_status
    FROM public.group_trips gt
    JOIN public.group_trip_participants p
      ON p.trip_id = gt.id AND p.user_id = (SELECT uid FROM me)
    UNION ALL
    SELECT gt.*, 'pending_request'::text AS membership, NULL::text AS member_status
    FROM public.group_trips gt
    JOIN public.group_trip_join_requests jr
      ON jr.trip_id = gt.id
     AND jr.requester_id = (SELECT uid FROM me)
     AND jr.status = 'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.group_trip_participants p2
      WHERE p2.trip_id = gt.id AND p2.user_id = (SELECT uid FROM me)
    )
    UNION ALL
    SELECT gt.*, 'staff'::text AS membership, NULL::text AS member_status
    FROM public.group_trips gt
    WHERE EXISTS (
      SELECT 1 FROM public.organized_trip_staff st
      WHERE st.trip_id = gt.id
        AND st.user_id = (SELECT uid FROM me)
        AND st.revoked_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_trip_participants p3
      WHERE p3.trip_id = gt.id AND p3.user_id = (SELECT uid FROM me)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.group_trip_join_requests jr3
      WHERE jr3.trip_id = gt.id AND jr3.requester_id = (SELECT uid FROM me)
        AND jr3.status = 'pending'
    )
  )
  SELECT t.id, t.host_id, t.status, t.hosting_style, t.title, t.hero_image_url,
         t.start_date, t.end_date, t.dates_set_in_stone, t.date_months,
         t.cost_per_person, t.budget_min, t.budget_max, t.budget_fx_rate,
         t.budget_currency,
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
                AND pp.status = 'active'
              ORDER BY (pp.user_id = t.host_id) DESC, pp.user_id
              LIMIT 4
            ) sub) AS member_avatars,
         t.membership, t.member_status
  FROM trips t
  LEFT JOIN public.surfers s ON s.user_id = t.host_id;
$function$;

revoke all on function public.my_trips_feed() from public, anon;
grant execute on function public.my_trips_feed() to authenticated, service_role;
