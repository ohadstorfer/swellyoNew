-- Geo-tiered ordering in match_surfers: rank candidates who surfed near the
-- requested spot first. Tier 1 = destination in the requested geohash-5 cell or
-- a neighbor (~5 km); Tier 2 = geohash-4 cell/neighbor (~40 km) OR inside the
-- region bounds when the requested place is an administrative area; Tier 3 =
-- everything else (today's behavior). Geo only reorders — the filter set,
-- scores, and total_count are unchanged. All new params default to NULL, so
-- existing callers keep today's ordering (geo_tier = 3 for everyone).
--
-- The caller (swelly-trip-planning-copy /find-matches) geocodes the requested
-- area and passes bucket arrays (requested cell + its 8 neighbors) and bounds.
--
-- Signature changes (new params) → must DROP the old function first, then
-- re-grant explicitly (recreate re-adds PUBLIC EXECUTE; this project revokes it).

drop function if exists public.match_surfers(uuid, uuid[], text, text, text[], text[], text[], integer, integer, integer);

create function public.match_surfers(
  p_requesting_user_id uuid,
  p_excluded_ids uuid[] default '{}'::uuid[],
  p_destination_country text default null,
  p_area text default null,
  p_country_from text[] default null,
  p_surfboard_type text[] default null,
  p_surf_level_category text[] default null,
  p_age_min integer default null,
  p_age_max integer default null,
  p_limit integer default 3,
  p_geo_bucket5s text[] default null,  -- requested geohash-5 + 8 neighbors
  p_geo_bucket4s text[] default null,  -- requested geohash-4 + 8 neighbors
  p_geo_is_region boolean default false,
  p_geo_sw_lat double precision default null,
  p_geo_sw_lng double precision default null,
  p_geo_ne_lat double precision default null,
  p_geo_ne_lng double precision default null
)
returns table(
  user_id uuid, name text, profile_image_url text, country_from text,
  surfboard_type text, surf_level integer, travel_experience text, age integer,
  destinations_array jsonb, match_score integer, days_in_destination integer,
  matched_areas text[], country_match boolean, area_match boolean,
  geo_tier integer, total_count bigint
)
language sql stable security definer
set search_path to 'public'
as $function$
  with base as (
    select s.user_id, s.name, s.profile_image_url, s.country_from, s.surfboard_type,
           s.surf_level, s.surf_level_category, s.travel_experience, s.age, s.destinations_array
    from surfers s
    where s.user_id <> p_requesting_user_id
      and (s.is_demo_user is null or s.is_demo_user = false)
      and (p_excluded_ids is null or array_length(p_excluded_ids,1) is null or s.user_id <> all(p_excluded_ids))
  ),
  criteria as (
    select b.* from base b
    where mc_country_from_match(p_country_from, b.country_from)
      and mc_board_pass(p_surfboard_type, b.surfboard_type::text)
      and mc_surf_level_pass(p_surf_level_category, b.surf_level_category, b.surf_level)
      and (p_age_min is null or (b.age is not null and b.age >= p_age_min))
      and (p_age_max is null or (b.age is not null and b.age <= p_age_max))
  ),
  scored as (
    select c.*,
      (p_destination_country is not null and btrim(p_destination_country) <> '') as is_dest,
      coalesce((
        -- Guard non-numeric/fractional time_in_days: TS treats non-numbers as 0 and never
        -- throws; a bare ::int cast would error on e.g. "7.5". trunc()::int matches TS's
        -- integer day semantics for the expected (whole-number) data.
        select sum(case when jsonb_typeof(d->'time_in_days') = 'number'
                        then trunc((d->>'time_in_days')::numeric)::int else 0 end)
        from jsonb_array_elements(coalesce(c.destinations_array,'[]'::jsonb)) d
        where (p_destination_country is null or btrim(p_destination_country) = '')
           or mc_dest_country_match(p_destination_country, mc_dest_country(d), d->>'state')
      ), 0) as the_score,
      coalesce((
        select bool_or(mc_area_match(d, p_area))
        from jsonb_array_elements(coalesce(c.destinations_array,'[]'::jsonb)) d
        where mc_dest_country_match(p_destination_country, mc_dest_country(d), d->>'state')
      ), false) as d_area,
      -- Geo tier: best (lowest) tier across the surfer's geocoded destinations.
      -- NULL geo params → no rows promoted → tier 3 for everyone (today's order).
      coalesce((
        select min(
          case
            when not p_geo_is_region and p_geo_bucket5s is not null
                 and ud.geo_bucket_5 = any(p_geo_bucket5s) then 1
            when not p_geo_is_region and p_geo_bucket4s is not null
                 and ud.geo_bucket_4 = any(p_geo_bucket4s) then 2
            when p_geo_is_region
                 and p_geo_sw_lat is not null and p_geo_ne_lat is not null
                 and p_geo_sw_lng is not null and p_geo_ne_lng is not null
                 and ud.lat is not null and ud.lng is not null
                 and ud.lat between p_geo_sw_lat and p_geo_ne_lat
                 and (case when p_geo_sw_lng <= p_geo_ne_lng
                           then ud.lng between p_geo_sw_lng and p_geo_ne_lng
                           else ud.lng >= p_geo_sw_lng or ud.lng <= p_geo_ne_lng end) then 2
            else null
          end)
        from user_destinations ud
        where ud.user_id = c.user_id
      ), 3) as g_tier
    from criteria c
  ),
  filtered as (
    select * from scored
    where not is_dest          -- general: keep every criteria-passer
       or the_score > 0        -- destination: require matched days > 0
  ),
  ranked as (
    select *, count(*) over () as total_count from filtered
  )
  select
    user_id, name, profile_image_url, country_from,
    surfboard_type::text, surf_level, travel_experience::text, age,
    destinations_array,
    the_score as match_score,
    the_score as days_in_destination,
    case when is_dest and d_area and p_area is not null then array[p_area] else '{}'::text[] end as matched_areas,
    is_dest as country_match,
    (is_dest and d_area) as area_match,
    g_tier as geo_tier,
    total_count
  from ranked
  order by
    g_tier,
    case when is_dest and p_area is not null and btrim(p_area) <> '' and d_area then 0 else 1 end,
    the_score desc
  limit greatest(coalesce(p_limit,3), 0)
$function$;

-- Recreate re-grants PUBLIC EXECUTE — revoke per project policy; only the
-- edge function (service_role) calls this.
revoke execute on function public.match_surfers(uuid, uuid[], text, text, text[], text[], text[], integer, integer, integer, text[], text[], boolean, double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.match_surfers(uuid, uuid[], text, text, text[], text[], text[], integer, integer, integer, text[], text[], boolean, double precision, double precision, double precision, double precision) to service_role;
