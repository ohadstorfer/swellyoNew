-- explore_feed: return the two fields the Explore card's pills need
-- (Figma 17779:51089) — the trip's surf levels and its vibe.
--
--   target_surf_levels text[]   "Intermediate - Adv"
--   trip_vibes         text[]   "Surf-focused"
--
-- The body is the LIVE definition as of 12 Oct 2026 (read with
-- pg_get_functiondef, not from the repo — the two have drifted before), with
-- exactly two changes: the two columns at the END of RETURNS TABLE and of the
-- SELECT list. Filters, ordering, cursor and limit are untouched.
--
-- Why DROP + CREATE: Postgres will not CREATE OR REPLACE a function whose
-- return type changes. Both statements run in ONE transaction, so there is no
-- moment at which a shipped build calls a function that is not there.
--
-- Shipped builds are unaffected: the columns are appended, and the client
-- spreads the row, so two extra keys are simply ignored.
--
-- Why the REVOKE/GRANT: a recreated function is executable by PUBLIC again.
-- The live one was authenticated + service_role only (it is SECURITY DEFINER),
-- and it must come out of this the same.

begin;

drop function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer);

create function public.explore_feed(
  p_limit integer default 10,
  p_cursor timestamp with time zone default null,
  p_cursor_id uuid default null,
  p_months text[] default null,
  p_budget_min numeric default null,
  p_budget_max numeric default null,
  p_cursor_participant_count integer default null
)
returns table(
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric,
  budget_currency text, max_participants integer, participant_count integer,
  created_at timestamp with time zone, destination jsonb, host_name text, host_avatar text,
  member_avatars text[],
  target_surf_levels text[], trip_vibes text[]
)
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  SELECT gt.id, gt.host_id, gt.status, gt.hosting_style, gt.title, gt.hero_image_url,
         gt.start_date, gt.end_date, gt.dates_set_in_stone, gt.date_months,
         gt.cost_per_person, gt.budget_min, gt.budget_max, gt.budget_fx_rate,
         gt.budget_currency,
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
              ORDER BY (p.user_id = gt.host_id) DESC, p.user_id LIMIT 4) sub) AS member_avatars,
         gt.target_surf_levels, gt.trip_vibes
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
$function$;

revoke all on function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer) from public, anon;
grant execute on function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
