-- ⚠️ DRAFT — reconcile against live def before applying; RLS changes are
-- high-risk, apply table-by-table with before/after pg_policies diff + realtime +
-- visibility verification. (This file carries the WS5 Part A sargable pre-filter;
-- the function itself is NOT yet applied to prod — apply the whole file as a unit.)
-- ============================================================================
-- match_surfers: in-DB surfer matching (filter + score + rank + limit)
--
-- Faithful port of the swelly-trip-planning-copy edge function /find-matches
-- (general path = total-days score; destination path = matched-country-days
-- score, area-first sort). Returns only the page (<= p_limit) plus total_count.
--
-- Parity reference: supabase/functions/swelly-trip-planning-copy/index.ts
-- Spec: docs/superpowers/specs/2026-06-05-matching-scale-rpc-design.md
--
-- WS5 Part A (2026-06-17): a sargable `prefiltered` CTE narrows on indexable
-- columns (age range, exact surf_level_category / surfboard_type sets) BEFORE the
-- fuzzy mc_* fns + per-row JSONB scoring run. The fuzzy fns still run in `criteria`
-- (reading FROM prefiltered) so semantics are IDENTICAL — the pre-filter only
-- removes rows that could never pass the corresponding exact-set hard filter.
-- Scoring + ORDER BY are untouched; the parity suite must still pass byte-for-byte.
-- Supporting indexes: supabase/migrations/20260617120000_match_surfers_indexes.sql
-- ============================================================================

-- ---------- helpers ----------

-- Board type normalization (mirror normalizeBoardTypeInline; unknown returns original v).
create or replace function mc_norm_board(v text) returns text language sql immutable as $$
  select case lower(regexp_replace(coalesce(v,''), '\s+', '_', 'g'))
    when 'midlength' then 'mid_length' when 'mid_length' then 'mid_length'
    when 'long_board' then 'longboard' when 'longboard' then 'longboard'
    when 'short_board' then 'shortboard' when 'shortboard' then 'shortboard'
    when 'softtop' then 'soft_top'   when 'soft_top' then 'soft_top'
    else v
  end
$$;

-- surfboard_type filter (mirror passesCriteriaInline surfboard_type branch).
create or replace function mc_board_pass(p_boards text[], user_board text)
returns boolean language sql immutable as $$
  select case
    when p_boards is null or array_length(p_boards,1) is null then true
    when user_board is null or mc_norm_board(user_board) = '' then false
    else mc_norm_board(user_board) = any (select mc_norm_board(b) from unnest(p_boards) b)
  end
$$;

-- country_from filter (mirror countryFromMatchInline).
create or replace function mc_country_from_match(requested text[], user_country text)
returns boolean language sql immutable as $$
  select case
    when requested is null or array_length(requested,1) is null then true
    when user_country is null or btrim(user_country) = '' then false
    else exists (
      select 1 from unnest(requested) r,
        lateral (select lower(btrim(user_country)) as u, lower(btrim(r)) as rc) x
      where x.u = x.rc
         or (x.rc in ('united states','usa') and (x.u like '%united states%' or x.u like '%usa%'))
         or (x.rc in ('uk','united kingdom') and (x.u like '%united kingdom%' or x.u ~ '\yuk\y'))
         or position(x.rc in x.u) > 0
         or position(x.u in x.rc) > 0
    )
  end
$$;

-- Extract the country string from a destination element (mirror getCountryFromUserDestInline).
create or replace function mc_dest_country(d jsonb) returns text language sql immutable as $$
  select case
    when d ? 'country' then btrim(d->>'country')
    when d ? 'destination_name' then btrim(split_part(d->>'destination_name', ',', 1))
    when jsonb_typeof(d) = 'string' then btrim(split_part(d #>> '{}', ',', 1))
    else ''
  end
$$;

-- Destination country match for one element (mirror countryMatchesRequestInline).
create or replace function mc_dest_country_match(p_request text, user_country text, user_state text)
returns boolean language sql immutable as $$
  select case
    when p_request is null or user_country is null or btrim(user_country) = '' then false
    else exists (
      select 1 from unnest(string_to_array(p_request, ',')) tok,
        lateral (select lower(btrim(tok)) as r, lower(btrim(user_country)) as uc,
                        lower(btrim(coalesce(user_state,''))) as us) x,
        lateral (select case when x.r like 'united states - %'
                        then btrim(substr(x.r, length('united states - ') + 1)) else '' end as reqstate) y
      where x.r <> '' and (
            x.uc = x.r
         or (x.r in ('usa','united states') and (x.uc like '%united states%' or x.uc like '%usa%'))
         or (x.r in ('uk','united kingdom') and (x.uc like '%united kingdom%' or x.uc ~ '\yuk\y'))
         or (y.reqstate <> '' and (x.uc like '%united states%' or x.uc = 'usa') and x.us <> ''
             and (x.us = y.reqstate or position(y.reqstate in x.us) > 0 or position(x.us in y.reqstate) > 0))
         or x.uc ~ ('\y' || regexp_replace(x.r, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\y')
      )
    )
  end
$$;

-- Area match for one element (mirror hasRequestedAreaInArrayInline).
create or replace function mc_area_match(d jsonb, requested_area text)
returns boolean language sql immutable as $$
  select case
    when requested_area is null or btrim(requested_area) = '' then false
    when d ? 'country' then exists (
      select 1 from jsonb_array_elements_text(coalesce(d->'area','[]'::jsonb)) a,
        lateral (select lower(a) la, lower(requested_area) lr) z
      where z.la = z.lr or position(z.lr in z.la) > 0 or position(z.la in z.lr) > 0
    )
    when jsonb_typeof(d) = 'string' then exists (
      select 1 from unnest(string_to_array(d #>> '{}', ',')) with ordinality t(p, idx),
        lateral (select lower(btrim(p)) lp, lower(requested_area) lr) z
      where idx > 1 and (z.lp = z.lr or position(z.lr in z.lp) > 0 or position(z.lp in z.lr) > 0)
    )
    when d ? 'destination_name' then exists (
      select 1 from unnest(string_to_array(d->>'destination_name', ',')) with ordinality t(p, idx),
        lateral (select lower(btrim(p)) lp, lower(requested_area) lr) z
      where idx > 1 and (z.lp = z.lr or position(z.lr in z.lp) > 0 or position(z.lp in z.lr) > 0)
    )
    else false
  end
$$;

-- surf_level_category filter (mirror passesCriteriaInline surf_level_category branch).
create or replace function mc_surf_level_pass(p_categories text[], user_category text, user_level int)
returns boolean language plpgsql immutable as $$
declare
  cats text[]; nums int[]; minlvl int; allowed int[];
  uc text := lower(coalesce(user_category,'')); single boolean; by_cat boolean; by_num boolean;
begin
  if p_categories is null or array_length(p_categories,1) is null then return true; end if;
  select array_agg(lower(btrim(c))) into cats from unnest(p_categories) c where btrim(c) <> '';
  if cats is null or array_length(cats,1) is null then return true; end if;
  select array_agg(n) into nums from (
    select case x when 'beginner' then 1 when 'intermediate' then 2 when 'advanced' then 3 when 'pro' then 4 end n
    from unnest(cats) x) q where n is not null;
  if nums is null then allowed := '{}';
  elsif array_length(nums,1) = 1 then allowed := nums;
  else select min(n) into minlvl from unnest(nums) n;
       allowed := array(select g from generate_series(1,4) g where g >= minlvl);
  end if;
  single := array_length(cats,1) = 1;
  by_cat := uc <> '' and uc = any(cats);
  by_num := user_level is not null and user_level = any(allowed);
  if single then return by_cat or (uc = '' and by_num); else return by_cat or by_num; end if;
end $$;

-- ---------- main function ----------

create or replace function match_surfers(
  p_requesting_user_id uuid,
  p_excluded_ids       uuid[]  default '{}',
  p_destination_country text   default null,
  p_area               text    default null,
  p_country_from       text[]  default null,
  p_surfboard_type     text[]  default null,
  p_surf_level_category text[] default null,
  p_age_min            int     default null,
  p_age_max            int     default null,
  p_limit              int     default 3
) returns table (
  user_id uuid, name text, profile_image_url text, country_from text,
  surfboard_type text, surf_level int, travel_experience text, age int,
  destinations_array jsonb, match_score int, days_in_destination int,
  matched_areas text[], country_match boolean, area_match boolean, total_count bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select s.user_id, s.name, s.profile_image_url, s.country_from, s.surfboard_type,
           s.surf_level, s.surf_level_category, s.travel_experience, s.age, s.destinations_array
    from surfers s
    where s.user_id <> p_requesting_user_id
      and (s.is_demo_user is null or s.is_demo_user = false)
      and (p_excluded_ids is null or array_length(p_excluded_ids,1) is null or s.user_id <> all(p_excluded_ids))
  ),
  -- WS5 sargable pre-filter: narrow on INDEXABLE columns before the fuzzy mc_*
  -- fns + JSONB scoring. Each clause here is a *necessary condition* of the
  -- corresponding exact-set hard filter in `criteria`, so it can only remove rows
  -- that `criteria` would have rejected anyway (no row that should match is lost):
  --   * age_min/age_max are already exactly what `criteria` checks (sargable).
  --   * surf_level_category = any(...) : when the requested set is given, a row
  --     whose category is not in the set can still pass mc_surf_level_pass ONLY via
  --     the numeric (surf_level) ladder. Because we keep the FULL mc_surf_level_pass
  --     in `criteria`, we must NOT drop those numeric-only matches here -> so the
  --     category equality is applied only as a fast path guarded by an OR on the
  --     numeric fallback (see note). To stay provably semantics-identical, this
  --     CTE drops a row only when it could not pass on EITHER the category OR the
  --     numeric path. surfboard_type has no numeric fallback, so its exact-set
  --     check is an unconditional necessary condition.
  prefiltered as (
    select b.* from base b
    where (p_age_min is null or (b.age is not null and b.age >= p_age_min))
      and (p_age_max is null or (b.age is not null and b.age <= p_age_max))
      -- surfboard_type: exact-set is a hard necessary condition (mc_board_pass
      -- returns false when no board matches; there is no numeric fallback).
      -- Mirror mc_norm_board on BOTH sides (the fn normalizes e.g. 'mid length'
      -- -> 'mid_length', 'long_board' -> 'longboard') so normalization differences
      -- can't drop a row the fuzzy fn would accept. mc_board_pass also rejects a
      -- user whose normalized board is '' -> that exclusion is left to `criteria`.
      and (
        p_surfboard_type is null
        or array_length(p_surfboard_type,1) is null
        or mc_norm_board(b.surfboard_type::text) = any (
             select mc_norm_board(x) from unnest(p_surfboard_type) x
           )
      )
      -- surf_level_category: keep numeric-ladder matches. Row survives if its
      -- category is in the set OR it still has a surf_level that the ladder could
      -- accept. We DON'T recompute the ladder here (that lives in
      -- mc_surf_level_pass) — we only require "category in set OR has a numeric
      -- level", which is a necessary condition for any pass when a set is given.
      and (
        p_surf_level_category is null
        or array_length(p_surf_level_category,1) is null
        -- mirror mc_surf_level_pass's lower(btrim(...)) on BOTH sides so a row with
        -- category 'Advanced' vs request 'advanced' is not wrongly dropped when it
        -- has no numeric level to fall back on.
        or lower(btrim(coalesce(b.surf_level_category,''))) = any (
             select lower(btrim(c)) from unnest(p_surf_level_category) c
           )
        or b.surf_level is not null
      )
  ),
  criteria as (
    select b.* from prefiltered b
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
      ), false) as d_area
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
    total_count
  from ranked
  order by
    case when is_dest and p_area is not null and btrim(p_area) <> '' and d_area then 0 else 1 end,
    the_score desc
  limit greatest(coalesce(p_limit,3), 0)
$$;

-- ---------- access hardening ----------
-- CREATE grants EXECUTE to PUBLIC by default, which would let `anon` (the public
-- client key) call this SECURITY DEFINER fn and read surfer PII bypassing RLS.
-- Revoke the implicit PUBLIC grant, then grant only signed-in users.
revoke execute on function match_surfers(uuid, uuid[], text, text, text[], text[], text[], int, int, int)
  from public, anon;
grant execute on function match_surfers(uuid, uuid[], text, text, text[], text[], text[], int, int, int)
  to authenticated;

-- Pin helper search_path (clears the function_search_path_mutable advisor warnings).
alter function mc_norm_board(text)                      set search_path = public;
alter function mc_board_pass(text[], text)              set search_path = public;
alter function mc_country_from_match(text[], text)      set search_path = public;
alter function mc_dest_country(jsonb)                   set search_path = public;
alter function mc_dest_country_match(text, text, text)  set search_path = public;
alter function mc_area_match(jsonb, text)               set search_path = public;
alter function mc_surf_level_pass(text[], text, int)    set search_path = public;
