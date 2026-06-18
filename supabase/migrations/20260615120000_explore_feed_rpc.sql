-- explore_feed: one-round-trip Explore list (trips + host name/avatar + member
-- avatars + count), keyset paginated. SECURITY DEFINER but reads only public data
-- (group_trips RLS is USING(true); surfers RLS is USING(true); host name/avatar
-- already public). The visibility clause future-proofs against private/friends
-- trips going live.
--
-- REFERENCE COPY — applied manually via the Supabase SQL editor (never `supabase db push`).
--
-- ⚠️ DRAFT — reconcile against live explore_feed def before applying. The LIVE
--    prod function is the 3-arg form WITH a `member_avatars` column and a
--    `visibility` filter (added by migration 20260616120000, which the 3-arg block
--    below mirrors). This file ADDS a 6-arg overload that is the live body PLUS
--    three month/budget filter params. Diff the body against the live definition
--    before running; only the month/budget params + WHERE clauses are net-new
--    (Workstream 2 Task 2.4).
--
-- Month/budget filters are now pushed INTO the query so they cover the whole
-- catalogue, not just the ~page already loaded client-side. The predicates mirror
-- the old JS tripInMonth / tripInBudget in src/screens/trips/TripsScreen.tsx
-- exactly (kept in sync by src/screens/trips/__tests__/exploreFilterPredicates.test.ts):
--   • p_months   text[]   — selected "YYYY-MM" chips. A trip matches if its
--       date_months overlaps the set, OR a firm start..end range covers any of
--       them (month string between start_date and end_date, both truncated to
--       'YYYY-MM'). Trips with no dates match no month filter. NULL/empty ⇒ off.
--   • p_budget_min / p_budget_max numeric — the inclusive budget threshold bounds
--       derived from the "below"/"above" $1000 chips (numeric to match the
--       cost_per_person / budget_min / budget_max columns). The client collapses
--       each trip into a [lo, hi] band (flat cost_per_person ⇒ zero-width band;
--       else budget_min/budget_max with single-sided fallback). Then:
--         - "below" chip selected ⇒ pass when band_lo <= threshold  → p_budget_max
--         - "above" chip selected ⇒ pass when band_hi >= threshold  → p_budget_min
--       Both chips OR together. A trip with no band matches no budget filter.
--       When neither budget bound is passed the budget gate is off.
--
-- INDEX NOTE: no new index is needed. The keyset/order index
-- (group_trips_status_created_id_idx) still drives the scan; the month/budget
-- predicates are residual filters over the same status='active' rows. date_months
-- is text[] so a GIN index could help IF month filtering ever dominates at scale,
-- but at current catalogue size it isn't warranted (left as a future option).

-- ---------------------------------------------------------------------------
-- LIVE 3-arg form (canonical — kept intact for unshipped/older dev builds that
-- still call the 3-arg signature). Mirrors prod after migration 20260616120000.
-- ---------------------------------------------------------------------------
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
      p_cursor IS NULL
      OR gt.created_at < p_cursor
      OR (gt.created_at = p_cursor AND gt.id < p_cursor_id)
    )
  ORDER BY gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- 6-arg overload: the LIVE body above PLUS month/budget filters (Task 2.4).
-- Same columns (member_avatars + destination), same visibility filter, same
-- SECURITY DEFINER + search_path pin — only the three filter params and their
-- two WHERE blocks are added.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.explore_feed(
  p_limit int DEFAULT 10,
  p_cursor timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_months text[] DEFAULT NULL,
  p_budget_min numeric DEFAULT NULL,
  p_budget_max numeric DEFAULT NULL
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
      p_cursor IS NULL
      OR gt.created_at < p_cursor
      OR (gt.created_at = p_cursor AND gt.id < p_cursor_id)
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
    -- p_budget_max ⇒ "below" (band_lo <= bound); p_budget_min ⇒ "above"
    -- (band_hi >= bound). A trip with no band matches nothing. Off when both NULL.
    AND (
      (p_budget_min IS NULL AND p_budget_max IS NULL)
      OR (
        -- band exists: cost_per_person (zero-width) OR budget_min/max present
        (gt.cost_per_person IS NOT NULL OR gt.budget_min IS NOT NULL OR gt.budget_max IS NOT NULL)
        AND (
          -- "below": band low end <= threshold
          (p_budget_max IS NOT NULL AND
             COALESCE(gt.cost_per_person, gt.budget_min, gt.budget_max) <= p_budget_max)
          -- "above": band high end >= threshold
          OR (p_budget_min IS NOT NULL AND
             COALESCE(gt.cost_per_person, gt.budget_max, gt.budget_min) >= p_budget_min)
        )
      )
    )
  ORDER BY gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

-- The 3-arg signature stays callable by clients that haven't shipped the new
-- args yet; the 6-arg overload is what the updated client calls. REVOKE/GRANT the
-- NEW signature (an overload is a distinct function — needs its own grant).
REVOKE EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid, text[], numeric, numeric) TO authenticated;

CREATE INDEX IF NOT EXISTS group_trips_status_created_id_idx
  ON public.group_trips (status, created_at DESC, id DESC);
