-- ============================================================================
-- match_surfers SMART SCENARIO SUITE
--
-- "Talks to Swelly behind the UI": each scenario is a realistic user ask, reduced
-- to the queryFilters Swelly would extract, then fired at the LIVE matching brain
-- (the match_surfers RPC — the same one swelly-trip-planning-copy /find-matches now
-- calls). Read-only: only SELECTs the SECURITY DEFINER function, writes nothing.
--
-- Requester defaults to ohad.storfer@gmail.com (resolved by email below) so results
-- exclude the requester, exactly like the app. Any invariant violation RAISES.
--
-- Run:
--   - Supabase SQL editor: paste & run. Watch the NOTICE lines; success ends with
--     "==================== ALL SCENARIOS PASSED ====================".
--   - psql: psql "$DB_URL" -f supabase/tests/match_surfers_scenarios.sql
--
-- Invariants checked per scenario:
--   * returned rows <= p_limit (page cap)
--   * total_count (count(*) over full match set) >= returned rows
--   * the requesting user never appears; excluded ids never appear
--   * every returned row satisfies the country_from / board / surf_level / age filters
--   * destination path  => country_match = true AND match_score > 0
--   * general path      => country_match = false AND area_match = false
--   * results sorted by score desc (skipped for dest+area, which sorts area-first)
--   * exclusion: excluding the top match removes it from the result set
-- ============================================================================

create or replace function pg_temp.ms_assert(
  p_scenario text, p_req uuid, p_excluded uuid[],
  p_dest text, p_area text, p_country_from text[], p_board text[], p_level text[],
  p_age_min int, p_age_max int, p_limit int
) returns void language plpgsql as $$
declare
  r record; n_page int := 0; n_total bigint := null; prev_score int := null;
  is_dest boolean := p_dest is not null and btrim(p_dest) <> '';
begin
  for r in select * from match_surfers(p_req, coalesce(p_excluded,'{}'), p_dest, p_area,
                                       p_country_from, p_board, p_level, p_age_min, p_age_max, p_limit)
  loop
    n_page := n_page + 1;
    if n_total is null then n_total := r.total_count; end if;
    if r.user_id = p_req then raise exception '[%] requester appeared in results', p_scenario; end if;
    if p_excluded is not null and array_length(p_excluded,1) is not null and r.user_id = any(p_excluded)
      then raise exception '[%] excluded id % appeared', p_scenario, r.user_id; end if;
    if not mc_country_from_match(p_country_from, r.country_from)
      then raise exception '[%] country_from filter violated: %', p_scenario, r.country_from; end if;
    if not mc_board_pass(p_board, r.surfboard_type::text)
      then raise exception '[%] board filter violated: %', p_scenario, r.surfboard_type; end if;
    if not mc_surf_level_pass(p_level, (select surf_level_category from surfers where user_id=r.user_id), r.surf_level)
      then raise exception '[%] surf_level filter violated (level=%)', p_scenario, r.surf_level; end if;
    if p_age_min is not null and (r.age is null or r.age < p_age_min)
      then raise exception '[%] age below min: %', p_scenario, r.age; end if;
    if p_age_max is not null and (r.age is null or r.age > p_age_max)
      then raise exception '[%] age above max: %', p_scenario, r.age; end if;
    if is_dest then
      if not r.country_match then raise exception '[%] dest path but country_match=false', p_scenario; end if;
      if r.match_score <= 0 then raise exception '[%] dest path but match_score<=0', p_scenario; end if;
    else
      if r.country_match then raise exception '[%] general path but country_match=true', p_scenario; end if;
      if r.area_match  then raise exception '[%] general path but area_match=true',  p_scenario; end if;
    end if;
    if (not is_dest or p_area is null) then
      if prev_score is not null and r.match_score > prev_score
        then raise exception '[%] not sorted by score desc (% > %)', p_scenario, r.match_score, prev_score; end if;
      prev_score := r.match_score;
    end if;
  end loop;
  if n_page > p_limit then raise exception '[%] returned % > limit %', p_scenario, n_page, p_limit; end if;
  if n_total is not null and n_total < n_page then raise exception '[%] total_count % < returned %', p_scenario, n_total, n_page; end if;
  raise notice '[OK] % | returned=% total_count=%', p_scenario, n_page, coalesce(n_total,0);
end $$;

do $$
declare
  me uuid;
  excl uuid; cnt int;
begin
  select id into me from auth.users where email = 'ohad.storfer@gmail.com';
  if me is null then raise exception 'requester user not found (adjust the email in this script)'; end if;

  -- General-match asks (no destination): filter only by criteria
  perform pg_temp.ms_assert('S1 general: Israeli shortboarders like me',         me, '{}', null,null, array['Israel'],        array['shortboard'], null,                  null,null, 3);
  perform pg_temp.ms_assert('S2 general: advanced/pro around my age (20-30)',     me, '{}', null,null, null,                  null,                array['advanced','pro'], 20,  30, 3);
  perform pg_temp.ms_assert('S3 general: surfers from the US',                    me, '{}', null,null, array['United States'],null,                null,                  null,null, 3);
  perform pg_temp.ms_assert('S7 general: single criterion (just shortboard)',     me, '{}', null,null, null,                  array['shortboard'], null,                  null,null, 3);

  -- Destination-match asks: country match + (optional) area
  perform pg_temp.ms_assert('S4 dest: Israeli who surfed El Salvador',            me, '{}', 'El Salvador',null, array['Israel'], null,            null,                  null,null, 3);
  perform pg_temp.ms_assert('S5 dest: anyone who surfed Indonesia',               me, '{}', 'Indonesia',  null, null,           null,            null,                  null,null, 3);
  perform pg_temp.ms_assert('S6 dest+area: Portugal / Ericeira (area-first sort)',me, '{}', 'Portugal','Ericeira', null,        null,            null,                  null,null, 3);

  -- Exclusion: take the top Indonesia match, exclude it, assert it disappears
  select user_id into excl from match_surfers(me,'{}','Indonesia',null,null,null,null,null,null,1);
  if excl is null then
    raise notice '[skip] S8 exclusion — no Indonesia match to exclude';
  else
    select count(*) into cnt from match_surfers(me, array[excl], 'Indonesia',null,null,null,null,null,null,100) where user_id = excl;
    if cnt <> 0 then raise exception '[S8 exclusion] excluded % still returned', excl; end if;
    raise notice '[OK] S8 exclusion: % correctly excluded from Indonesia results', excl;
  end if;

  raise notice '==================== ALL SCENARIOS PASSED ====================';
end $$;
