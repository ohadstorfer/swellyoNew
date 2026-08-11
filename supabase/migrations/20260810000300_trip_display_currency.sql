-- Trip currency display — "Booking.com method": show local, charge USD.
--
-- Two changes, both additive:
--   1. surfers.display_currency — the traveler's chosen display currency.
--      NULL means "Auto" (derive from country_from). Never used for money,
--      only for what a price LOOKS like.
--   2. explore_feed / my_trips_feed return budget_currency.
--
-- Why (2) is here at all: the trip CARD lists come from these two RPCs, whose
-- RETURNS TABLE is a hand-maintained column list. They already return
-- budget_fx_rate but NOT budget_currency, so a card cannot tell whether a trip
-- was priced in ₪ or € — it can only convert, never show the operator's real
-- typed price. Trip DETAIL uses select('*') and already has the column, so the
-- tell when this migration is skipped is "detail shows ₪4,500, card shows
-- ≈₪4,501".
--
-- ⚠️ Both function bodies below were copied from the LIVE definitions
-- (pg_get_functiondef, 2026-08-10), not from the repo — live has historically
-- been ahead of the repo. The ONLY edits are the two added budget_currency
-- lines in each. Diff before re-running this on any other environment.
--
-- ⚠️ RETURNS TABLE changes need DROP + CREATE, not CREATE OR REPLACE. DROP
-- re-grants EXECUTE to PUBLIC on recreate, so the REVOKE/GRANT block at the
-- bottom is load-bearing, not decoration — without it these become
-- anon-callable.

-- ---------------------------------------------------------------------------
-- 1. surfers.display_currency
-- ---------------------------------------------------------------------------

ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS display_currency text;

COMMENT ON COLUMN public.surfers.display_currency IS
  'Traveler''s chosen display currency (ISO 4217). NULL = Auto, derived from country_from. Display only — all stored money stays USD.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surfers_display_currency_check'
  ) THEN
    ALTER TABLE public.surfers
      ADD CONSTRAINT surfers_display_currency_check
      CHECK (display_currency IS NULL OR display_currency IN (
        'USD','ILS','EUR','GBP','AUD','NZD','CAD','CHF','BRL','JPY','SEK','NOK','DKK','ZAR'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. explore_feed — add budget_currency
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.explore_feed(integer, timestamp with time zone, uuid, text[], numeric, numeric, integer);

CREATE FUNCTION public.explore_feed(
  p_limit integer DEFAULT 10,
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id uuid DEFAULT NULL::uuid,
  p_months text[] DEFAULT NULL::text[],
  p_budget_min numeric DEFAULT NULL::numeric,
  p_budget_max numeric DEFAULT NULL::numeric,
  p_cursor_participant_count integer DEFAULT NULL::integer
)
 RETURNS TABLE(id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text, start_date date, end_date date, dates_set_in_stone boolean, date_months text[], cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric, budget_currency text, max_participants integer, participant_count integer, created_at timestamp with time zone, destination jsonb, host_name text, host_avatar text, member_avatars text[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. my_trips_feed — add budget_currency
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.my_trips_feed();

CREATE FUNCTION public.my_trips_feed()
 RETURNS TABLE(id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text, start_date date, end_date date, dates_set_in_stone boolean, date_months text[], cost_per_person numeric, budget_min numeric, budget_max numeric, budget_fx_rate numeric, budget_currency text, max_participants integer, participant_count integer, created_at timestamp with time zone, destination jsonb, host_name text, host_avatar text, member_avatars text[], membership text, member_status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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

-- ---------------------------------------------------------------------------
-- 4. Re-lock EXECUTE. DROP+CREATE hands EXECUTE back to PUBLIC — without this
--    block both feeds become anon-callable. Matches the live ACL captured
--    before this migration: {postgres, authenticated, service_role}.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.explore_feed(integer, timestamp with time zone, uuid, text[], numeric, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.explore_feed(integer, timestamp with time zone, uuid, text[], numeric, numeric, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.explore_feed(integer, timestamp with time zone, uuid, text[], numeric, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.explore_feed(integer, timestamp with time zone, uuid, text[], numeric, numeric, integer) TO service_role;

REVOKE ALL ON FUNCTION public.my_trips_feed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_trips_feed() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_trips_feed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_trips_feed() TO service_role;
