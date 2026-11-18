-- Explore filters: budget slider, dates calendar, age range.
--
-- The Explore filter sheet drops its chips ("Below/Above $1k", three month
-- chips) for a budget range slider, a dates calendar and an age range.
-- explore_feed gets six new arguments, all defaulting to NULL (= filter off):
--   p_price_min / p_price_max  USD. The trip's price band must overlap them.
--   p_date_from / p_date_to    The trip's dates must overlap them.
--   p_age_min / p_age_max      A trip with no age limit always passes.
--
-- The old arguments (p_months, p_budget_min, p_budget_max) are kept with their
-- old meaning, so app builds already in the stores keep working unchanged.
--
-- Rebuilt from 20261112000000_explore_feed_search.sql (live matched it on
-- 2026-11-12). Diff against live before applying.

drop function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer, text);

create function public.explore_feed(
  p_limit integer DEFAULT 10,
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id uuid DEFAULT NULL::uuid,
  p_months text[] DEFAULT NULL::text[],
  p_budget_min numeric DEFAULT NULL::numeric,
  p_budget_max numeric DEFAULT NULL::numeric,
  p_cursor_participant_count integer DEFAULT NULL::integer,
  p_search text DEFAULT NULL::text,
  p_price_min numeric DEFAULT NULL::numeric,
  p_price_max numeric DEFAULT NULL::numeric,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_age_min integer DEFAULT NULL::integer,
  p_age_max integer DEFAULT NULL::integer
)
 RETURNS TABLE(id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text, start_date date, end_date date, dates_set_in_stone boolean, date_months text[], cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric, budget_currency text, max_participants integer, participant_count integer, created_at timestamp with time zone, destination jsonb, host_name text, host_avatar text, member_avatars text[], target_surf_levels text[], trip_vibes text[], stoke_certified boolean, ci_surf_conservation boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  -- Search words: normalized like the doc, at most 8, longest first. The
  -- longest one drives the trigram index; the rest are checked on those rows.
  WITH srch AS (
    SELECT array_agg('%' || w || '%' ORDER BY length(w) DESC) AS patterns
    FROM (
      SELECT DISTINCT w
      FROM unnest(string_to_array(public.search_normalize(left(p_search, 100)), ' ')) AS w
      WHERE w <> ''
      LIMIT 8
    ) words
  ),
  hits AS (
    SELECT sd.trip_id
    FROM public.group_trip_search_docs sd, srch
    WHERE srch.patterns IS NOT NULL
      AND sd.doc LIKE srch.patterns[1]
      AND sd.doc LIKE ALL (srch.patterns)
  )
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
         gt.target_surf_levels, gt.trip_vibes,
         gt.stoke_certified, gt.ci_surf_conservation
  FROM public.group_trips gt
  LEFT JOIN public.surfers s ON s.user_id = gt.host_id
  CROSS JOIN srch
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      p_cursor_participant_count,
      (SELECT g2.participant_count FROM public.group_trips g2 WHERE g2.id = p_cursor_id)
    ) AS pc
  ) cur
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')
    AND (srch.patterns IS NULL OR gt.id IN (SELECT hits.trip_id FROM hits))
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
    -- Budget slider (new clients): the trip's price band must OVERLAP the
    -- picked range. Either end may be NULL (slider at its end = no bound).
    AND (
      (p_price_min IS NULL AND p_price_max IS NULL)
      OR (
        (gt.cost_per_person IS NOT NULL OR gt.budget_min IS NOT NULL OR gt.budget_max IS NOT NULL)
        AND (p_price_max IS NULL OR
             COALESCE(gt.cost_per_person, gt.budget_min, gt.budget_max) <= p_price_max)
        AND (p_price_min IS NULL OR
             COALESCE(gt.cost_per_person, gt.budget_max, gt.budget_min) >= p_price_min)
      )
    )
    -- Dates calendar (new clients). A one-sided pick is a single day.
    -- Firm dates: the trip's days overlap the picked days.
    -- Loose dates (date_months only): a trip month overlaps a picked month.
    -- A trip with no dates never matches an active date filter.
    AND (
      (p_date_from IS NULL AND p_date_to IS NULL)
      OR (
        gt.start_date IS NOT NULL AND gt.end_date IS NOT NULL
        AND gt.start_date <= COALESCE(p_date_to, p_date_from)
        AND gt.end_date >= COALESCE(p_date_from, p_date_to)
      )
      OR (
        (gt.start_date IS NULL OR gt.end_date IS NULL)
        AND gt.date_months IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM unnest(gt.date_months) AS m(ym)
          WHERE m.ym >= to_char(COALESCE(p_date_from, p_date_to), 'YYYY-MM')
            AND m.ym <= to_char(COALESCE(p_date_to, p_date_from), 'YYYY-MM')
        )
      )
    )
    -- Age range. A trip with no age limit (NULL) is "all ages" and always
    -- passes; otherwise its range must overlap the picked one.
    AND (p_age_min IS NULL OR gt.age_max IS NULL OR gt.age_max >= p_age_min)
    AND (p_age_max IS NULL OR gt.age_min IS NULL OR gt.age_min <= p_age_max)
  ORDER BY gt.participant_count DESC, gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$function$;

-- Recreating a function re-grants EXECUTE to PUBLIC; match live grants.
revoke all on function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer, text, numeric, numeric, date, date, integer, integer) from public, anon;
grant execute on function public.explore_feed(integer, timestamptz, uuid, text[], numeric, numeric, integer, text, numeric, numeric, date, date, integer, integer) to authenticated, service_role;
