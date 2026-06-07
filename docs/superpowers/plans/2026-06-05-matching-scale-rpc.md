# Matching at Scale — `match_surfers` RPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production-equivalent surfer matching into a single Postgres function (`match_surfers`) that filters + scores + ranks + limits inside the DB and returns only the page, so cost no longer grows with table size — wired into the non-copy `TripPlanningChatScreen.tsx` for local testing.

**Architecture:** A `SECURITY DEFINER` SQL function reproduces the edge function's `/find-matches` logic exactly (two paths: "general" = total-days score; "destination" = matched-country-days score, area-first sort). Small `immutable` SQL/plpgsql helpers port the fuzzy country/area/level matching so they're independently testable. A thin client module calls it via `supabase.rpc` and maps rows to `MatchedUser`. Production edge-function cutover and a GIN index are explicit follow-ups, NOT in this plan.

**Tech Stack:** Postgres (Supabase), TypeScript, React Native/Expo, jest-expo.

**Parity reference:** `supabase/functions/swelly-trip-planning-copy/index.ts` (inlined find-matches), treated as current. Spec: `docs/superpowers/specs/2026-06-05-matching-scale-rpc-design.md`.

---

## File Structure

- Create: `supabase/migrations/20260605120000_match_surfers.sql` — helpers + `match_surfers`, grants.
- Create: `supabase/tests/match_surfers_helpers.sql` — deterministic literal-input assertions for the helpers.
- Create: `supabase/tests/match_surfers_parity.sql` — read-only sanity/parity queries against live data.
- Create: `src/services/matching/matchSurfersRpc.ts` — client RPC wrapper + row→`MatchedUser` mapper + general-path guard.
- Create: `src/services/matching/__tests__/matchSurfersRpc.test.ts` — jest test for the mapper + guard (rpc mocked).
- Modify: `src/screens/TripPlanningChatScreen.tsx` — swap `findMatchingUsersServer` for the RPC behind a toggle const.
- Modify: `src/services/matching/matchingService.ts` — revert the stray `.limit(MAX_MATCH_CANDIDATES)` edits on the dead path.

**How to run SQL** (no execute_sql MCP tool exposed): paste each `.sql` file into the Supabase **Dashboard → SQL Editor** and Run, or `psql "$DATABASE_URL" -f <file>`. Helper/assertion files raise an exception on failure, so **"runs with no error = pass."** The migration targets the same project the local app connects to.

---

## Task 1: Fuzzy-matching SQL helpers (TDD with literal inputs)

These pure functions port the edge function's fuzzy logic and are testable with literal inputs — no table needed.

**Files:**
- Create: `supabase/migrations/20260605120000_match_surfers.sql` (helpers section)
- Test: `supabase/tests/match_surfers_helpers.sql`

- [ ] **Step 1: Write the failing assertion test**

Create `supabase/tests/match_surfers_helpers.sql`:

```sql
-- Run in SQL Editor. Each assert raises on failure; clean run = all pass.
do $$
begin
  -- mc_norm_board
  assert mc_norm_board('Mid Length') = 'mid_length', 'board midlength';
  assert mc_norm_board('shortboard') = 'shortboard', 'board short';
  assert mc_norm_board('soft top') = 'soft_top', 'board softtop';

  -- mc_board_pass
  assert mc_board_pass(null, 'shortboard') = true, 'board no filter passes';
  assert mc_board_pass(array['mid_length'], 'midlength') = true, 'board normalized match';
  assert mc_board_pass(array['longboard'], 'shortboard') = false, 'board mismatch';
  assert mc_board_pass(array['longboard'], null) = false, 'board null surfer fails';

  -- mc_country_from_match
  assert mc_country_from_match(null, 'Brazil') = true, 'cf no filter';
  assert mc_country_from_match(array['Brazil'], 'brazil') = true, 'cf exact ci';
  assert mc_country_from_match(array['USA'], 'United States') = true, 'cf usa alias';
  assert mc_country_from_match(array['United Kingdom'], 'UK') = true, 'cf uk alias';
  assert mc_country_from_match(array['Spain'], 'Brazil') = false, 'cf mismatch';
  assert mc_country_from_match(array['Brazil'], null) = false, 'cf null fails';
  assert mc_country_from_match(array['Brazil'], '   ') = false, 'cf blank fails';

  -- mc_dest_country (extraction)
  assert mc_dest_country('{"country":"Indonesia","area":["Bali"]}'::jsonb) = 'Indonesia', 'dc new';
  assert mc_dest_country('{"destination_name":"Costa Rica, Pavones"}'::jsonb) = 'Costa Rica', 'dc legacy obj';
  assert mc_dest_country('"Sri Lanka, South"'::jsonb) = 'Sri Lanka', 'dc legacy string';

  -- mc_dest_country_match
  assert mc_dest_country_match('Indonesia', 'Indonesia', null) = true, 'dm exact';
  assert mc_dest_country_match('Indonesia, Philippines', 'Philippines', null) = true, 'dm multi';
  assert mc_dest_country_match('USA', 'United States', 'California') = true, 'dm usa';
  assert mc_dest_country_match('United States - California', 'USA', 'California') = true, 'dm usa-state';
  assert mc_dest_country_match('Spain', 'Indonesia', null) = false, 'dm mismatch';

  -- mc_area_match
  assert mc_area_match('{"country":"Indonesia","area":["Bali","Uluwatu"]}'::jsonb, 'Uluwatu') = true, 'am new';
  assert mc_area_match('{"country":"Indonesia","area":["Bali"]}'::jsonb, 'Mentawai') = false, 'am miss';
  assert mc_area_match('{"country":"Indonesia","area":["Bali"]}'::jsonb, null) = false, 'am null area';

  -- mc_surf_level_pass
  assert mc_surf_level_pass(null, 'beginner', 1) = true, 'sl no filter';
  assert mc_surf_level_pass(array['beginner'], 'beginner', null) = true, 'sl single cat match';
  assert mc_surf_level_pass(array['beginner'], null, 1) = true, 'sl single no-cat numeric';
  assert mc_surf_level_pass(array['advanced'], 'beginner', 1) = false, 'sl single mismatch';
  assert mc_surf_level_pass(array['intermediate','pro'], 'advanced', 3) = true, 'sl multi numeric >= min';
  assert mc_surf_level_pass(array['pro'], 'beginner', 1) = false, 'sl pro vs beginner';
  raise notice 'ALL HELPER ASSERTIONS PASSED';
end $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run the file in the SQL Editor.
Expected: FAIL — `function mc_norm_board(...) does not exist` (helpers not created yet).

- [ ] **Step 3: Implement the helpers**

Create `supabase/migrations/20260605120000_match_surfers.sql` with (helpers first):

```sql
-- ============ match_surfers helpers ============
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
```

- [ ] **Step 4: Run the assertions to verify they pass**

Run `supabase/tests/match_surfers_helpers.sql` in the SQL Editor.
Expected: PASS — ends with `NOTICE: ALL HELPER ASSERTIONS PASSED`, no exception.
If any assert fires, fix the corresponding helper and re-run before continuing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260605120000_match_surfers.sql supabase/tests/match_surfers_helpers.sql
git commit -m "feat(matching): add fuzzy-match SQL helpers for match_surfers"
```

---

## Task 2: The `match_surfers` function

**Files:**
- Modify: `supabase/migrations/20260605120000_match_surfers.sql` (append the function + grants)
- Test: `supabase/tests/match_surfers_parity.sql`

- [ ] **Step 1: Write the parity/sanity check (expected to fail first)**

Create `supabase/tests/match_surfers_parity.sql` (read-only; uses real data):

```sql
-- Replace :uid with a real requesting user_id (any surfer's user_id is fine).
-- A) Destination path: top-3 surfers with days in a known country, area-first then days desc.
select user_id, country_from, match_score, days_in_destination, country_match, area_match, total_count
from match_surfers(
  p_requesting_user_id := '00000000-0000-0000-0000-000000000000'::uuid,
  p_destination_country := 'Indonesia'
);

-- B) General path: filter by country_from, ranked by total days across all destinations.
select user_id, country_from, match_score, total_count
from match_surfers(
  p_requesting_user_id := '00000000-0000-0000-0000-000000000000'::uuid,
  p_country_from := array['Brazil']
);

-- C) Invariants that must hold (raises on violation):
do $$
declare r record; n int;
begin
  -- destination rows must all have positive score and country_match=true
  for r in select * from match_surfers('00000000-0000-0000-0000-000000000000'::uuid, p_destination_country := 'Indonesia') loop
    assert r.match_score > 0, 'dest score must be > 0';
    assert r.country_match = true, 'dest country_match must be true';
    assert r.days_in_destination = r.match_score, 'dest score == days';
  end loop;
  -- at most 3 rows (page size)
  select count(*) into n from match_surfers('00000000-0000-0000-0000-000000000000'::uuid, p_destination_country := 'Indonesia');
  assert n <= 3, 'page size <= 3';
  raise notice 'PARITY INVARIANTS PASSED';
end $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run the file.
Expected: FAIL — `function match_surfers(...) does not exist`.

- [ ] **Step 3: Implement the function**

Append to `supabase/migrations/20260605120000_match_surfers.sql`:

```sql
-- ============ match_surfers ============
-- Faithful port of swelly-trip-planning-copy find-matches (general + destination paths).
-- Returns only the page (<= p_limit) plus total_count of all qualifiers.
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
        select sum(coalesce((d->>'time_in_days')::int, 0))
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
    case when is_dest and p_area is not null and d_area then 0 else 1 end,
    the_score desc
  limit greatest(coalesce(p_limit,3), 0)
$$;

-- mc_board_pass depends on mc_norm_board; define here (after helpers, before/with function is fine).
create or replace function mc_board_pass(p_boards text[], user_board text)
returns boolean language sql immutable as $$
  select case
    when p_boards is null or array_length(p_boards,1) is null then true
    when user_board is null or mc_norm_board(user_board) = '' then false
    else mc_norm_board(user_board) = any (select mc_norm_board(b) from unnest(p_boards) b)
  end
$$;

grant execute on function match_surfers(uuid, uuid[], text, text, text[], text[], text[], int, int, int)
  to authenticated, anon;
```

> Note: `mc_board_pass` is referenced by `criteria`; ensure it is created before `match_surfers` runs. If your SQL editor complains, move the `mc_board_pass` block above the `match_surfers` block. (Functions are resolved at call time, so creation order within one migration only matters if you run partial selections.)

- [ ] **Step 4: Apply the migration, then run the parity check**

Apply the full migration file (SQL Editor or `supabase db push`). Then edit `match_surfers_parity.sql` replacing the placeholder uuid with a real surfer `user_id` and a destination country you know exists in the data, and run it.
Expected: query A returns ≤3 rows ordered by area-match then days; the `do $$` block ends with `NOTICE: PARITY INVARIANTS PASSED`.

- [ ] **Step 5: Spot-check parity against the live app**

In the production (copy) app, run a destination search (e.g. "surfers who've been to Indonesia") and note the 3 user_ids + order. Run query A with the same destination + your user_id. Confirm same users, same order. Repeat for a general (country_from only) search.
Expected: identical sets and order (ties may differ — acceptable per spec).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260605120000_match_surfers.sql supabase/tests/match_surfers_parity.sql
git commit -m "feat(matching): add match_surfers RPC (filter+score+rank+limit in DB)"
```

---

## Task 3: Client RPC wrapper + mapper (jest TDD)

**Files:**
- Create: `src/services/matching/matchSurfersRpc.ts`
- Test: `src/services/matching/__tests__/matchSurfersRpc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/matching/__tests__/matchSurfersRpc.test.ts`:

```ts
import { findMatchingUsersRpc, mapRpcRowToMatchedUser } from '../matchSurfersRpc';

jest.mock('../../../config/supabase', () => ({
  supabase: { rpc: jest.fn() },
  isSupabaseConfigured: () => true,
}));
import { supabase } from '../../../config/supabase';

const sampleRow = {
  user_id: 'u1', name: 'Ana', profile_image_url: null, country_from: 'Brazil',
  surfboard_type: 'shortboard', surf_level: 3, travel_experience: '5', age: 27,
  destinations_array: [{ country: 'Indonesia', area: ['Bali'], time_in_days: 14 }],
  match_score: 14, days_in_destination: 14, matched_areas: ['Bali'],
  country_match: true, area_match: true, total_count: 5,
};

describe('matchSurfersRpc', () => {
  beforeEach(() => (supabase.rpc as jest.Mock).mockReset());

  it('maps an rpc row to MatchedUser with reconstructed match_quality', () => {
    const m = mapRpcRowToMatchedUser(sampleRow);
    expect(m.user_id).toBe('u1');
    expect(m.match_score).toBe(14);
    expect(m.matched_areas).toEqual(['Bali']);
    expect(m.matchQuality).toEqual({ matchCount: 1, countryMatch: true, areaMatch: true, townMatch: false });
    expect(m.common_lifestyle_keywords).toEqual([]);
  });

  it('returns matches + totalCount from the first row', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [sampleRow], error: null });
    const res = await findMatchingUsersRpc({ destination_country: 'Indonesia' } as any, 'me');
    expect(res.totalCount).toBe(5);
    expect(res.matches).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledWith('match_surfers', expect.objectContaining({
      p_requesting_user_id: 'me', p_destination_country: 'Indonesia',
    }));
  });

  it('throws when general search has no meaningful filters', async () => {
    await expect(findMatchingUsersRpc({} as any, 'me')).rejects.toThrow(/destination_country or at least one query filter/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/matching/__tests__/matchSurfersRpc.test.ts`
Expected: FAIL — cannot find module `../matchSurfersRpc`.

- [ ] **Step 3: Implement the module**

Create `src/services/matching/matchSurfersRpc.ts`:

```ts
import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { TripPlanningRequest, MatchedUser } from '../../types/tripPlanning';

/** Mirror of hasMeaningfulQueryFiltersInline in the edge function. */
function hasMeaningfulQueryFilters(q: any): boolean {
  if (!q || typeof q !== 'object') return false;
  if (Array.isArray(q.country_from) && q.country_from.length > 0) return true;
  if (Array.isArray(q.surfboard_type) && q.surfboard_type.length > 0) return true;
  if (q.surf_level_category != null) return true;
  if (typeof q.age_min === 'number') return true;
  if (typeof q.age_max === 'number') return true;
  return false;
}

export function mapRpcRowToMatchedUser(r: any): MatchedUser {
  return {
    user_id: r.user_id,
    name: r.name ?? 'User',
    profile_image_url: r.profile_image_url ?? null,
    match_score: r.match_score ?? 0,
    matched_areas: r.matched_areas ?? [],
    common_lifestyle_keywords: [],
    common_wave_keywords: [],
    surfboard_type: r.surfboard_type ?? undefined,
    surf_level: r.surf_level ?? undefined,
    travel_experience: r.travel_experience ?? undefined,
    country_from: r.country_from ?? undefined,
    age: r.age ?? undefined,
    days_in_destination: r.days_in_destination ?? 0,
    destinations_array: r.destinations_array,
    matchQuality: {
      matchCount: 1,
      countryMatch: !!r.country_match,
      areaMatch: !!r.area_match,
      townMatch: false,
    } as any,
  };
}

export async function findMatchingUsersRpc(
  request: TripPlanningRequest,
  requestingUserId: string,
  excludedIds: string[] = []
): Promise<{ matches: MatchedUser[]; totalCount: number }> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured');
  const qf: any = (request as any).queryFilters || {};
  const dest = request.destination_country?.trim() || null;
  if (!dest && !hasMeaningfulQueryFilters(qf)) {
    throw new Error('Either destination_country or at least one query filter (e.g. country_from, age_min/age_max, surfboard_type, surf_level_category) is required for matching.');
  }
  const cat = qf.surf_level_category != null
    ? (Array.isArray(qf.surf_level_category) ? qf.surf_level_category : [qf.surf_level_category])
    : null;

  const { data, error } = await supabase.rpc('match_surfers', {
    p_requesting_user_id: requestingUserId,
    p_excluded_ids: excludedIds,
    p_destination_country: dest,
    p_area: request.area || null,
    p_country_from: Array.isArray(qf.country_from) && qf.country_from.length ? qf.country_from : null,
    p_surfboard_type: Array.isArray(qf.surfboard_type) && qf.surfboard_type.length ? qf.surfboard_type : null,
    p_surf_level_category: cat,
    p_age_min: typeof qf.age_min === 'number' ? qf.age_min : null,
    p_age_max: typeof qf.age_max === 'number' ? qf.age_max : null,
    p_limit: 3,
  });
  if (error) throw new Error(error.message);
  const rows: any[] = data || [];
  const totalCount = rows.length ? Number(rows[0].total_count) : 0;
  return { matches: rows.map(mapRpcRowToMatchedUser), totalCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/services/matching/__tests__/matchSurfersRpc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/matching/matchSurfersRpc.ts src/services/matching/__tests__/matchSurfersRpc.test.ts
git commit -m "feat(matching): add findMatchingUsersRpc client wrapper + mapper"
```

---

## Task 4: Wire the non-copy screen (manual validation)

**Files:**
- Modify: `src/screens/TripPlanningChatScreen.tsx:1139` (the `findMatchingUsersServer` call site)

- [ ] **Step 1: Add the import and toggle**

Near the top imports of `src/screens/TripPlanningChatScreen.tsx`, add:

```ts
import { findMatchingUsersRpc } from '../services/matching/matchSurfersRpc';

// Local-testing toggle: true = use the new in-DB match_surfers RPC (this screen only,
// production copy screen + edge function are untouched). Flip to false to fall back.
const USE_MATCH_SURFERS_RPC = true;
```

- [ ] **Step 2: Branch the match call**

Find the call at line ~1139:

```ts
const { matches: rawMatches, totalCount, messageIndex: backendMsgIndex } = await svc.findMatchingUsersServer(currentChatId, tripPlanningData, excludePrevious);
```

Replace with:

```ts
let rawMatches; let totalCount; let backendMsgIndex;
if (USE_MATCH_SURFERS_RPC) {
  // Build excluded ids from already-shown matches when paginating ("show more").
  const excludedIds = excludePrevious ? shownMatchUserIdsRef.current : [];
  const payload = tripPlanningData && typeof tripPlanningData === 'object'
    ? { ...tripPlanningData, queryFilters: tripPlanningData.queryFilters ?? tripPlanningData.query_filters ?? null }
    : tripPlanningData;
  const rpcRes = await findMatchingUsersRpc(payload, currentUser.id, excludedIds);
  rawMatches = rpcRes.matches;
  totalCount = rpcRes.totalCount;
  backendMsgIndex = undefined; // RPC path has no server-side message index (local testing only)
  shownMatchUserIdsRef.current = [...shownMatchUserIdsRef.current, ...rpcRes.matches.map((m: any) => m.user_id)];
} else {
  ({ matches: rawMatches, totalCount, messageIndex: backendMsgIndex } = await svc.findMatchingUsersServer(currentChatId, tripPlanningData, excludePrevious));
}
```

- [ ] **Step 3: Add the excluded-ids ref**

Near the other `useRef` declarations in the component, add:

```ts
const shownMatchUserIdsRef = useRef<string[]>([]);
```

And reset it when a new chat/search starts — find where the chat resets (e.g. new-chat handler) and add `shownMatchUserIdsRef.current = [];`. If unsure, reset it at the start of the same handler that calls the match block when `excludePrevious === false`:

```ts
if (!excludePrevious) shownMatchUserIdsRef.current = [];
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep TripPlanningChatScreen`
Expected: no output (no new errors in this file).

- [ ] **Step 5: Manual validation (the parity gate)**

Run the app locally (`npm start`) on the non-copy screen. For each scenario, compare against the production copy app:
- Destination only: "surfers who surfed Indonesia" → same 3 users, same order.
- Destination + area: "Uluwatu, Indonesia" → area matches sort first.
- Destination + country_from filter.
- General (no destination) with country_from / age filters.
- "Show more" returns the next batch, excluding already-shown.
- USA destination ("California") and a multi-country request.
Expected: same users + order as production (ties may differ).

- [ ] **Step 6: Commit**

```bash
git add src/screens/TripPlanningChatScreen.tsx
git commit -m "feat(matching): wire non-copy TripPlanning screen to match_surfers RPC (local test)"
```

---

## Task 5: Revert the stray legacy `.limit()`

The earlier `.limit(MAX_MATCH_CANDIDATES)` was added to the dead client `findMatchingUsers`; its comment now wrongly implies it helps production scale.

**Files:**
- Modify: `src/services/matching/matchingService.ts`

- [ ] **Step 1: Remove the constant and three `.limit` calls**

Delete the `MAX_MATCH_CANDIDATES` constant block (lines ~14-26) and remove the three appended lines:
- `.limit(MAX_MATCH_CANDIDATES); // Cap rows fetched ...`
- `.limit(MAX_MATCH_CANDIDATES); // Bound the unfiltered fallback scan` (x2)
Restore those query chains to their original terminators (`; ` on the prior `.or(...)` line as before).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "matching/matchingService"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/services/matching/matchingService.ts
git commit -m "revert(matching): drop stray .limit on dead client path"
```

---

## Self-Review

**Spec coverage:**
- Function filter+score+rank+limit+total_count → Task 2. ✅
- Two paths (general day-sum / destination matched-days, area-first) → Task 2 `scored`/`order by`. ✅
- Fuzzy country/area/level/board ports → Task 1 helpers + tests. ✅
- Client RPC + mapper + general-path guard → Task 3. ✅
- Non-copy screen wiring + in-memory pagination → Task 4. ✅
- `pending_deletion` NOT excluded (preserve edge behavior) → Task 2 `base` omits it (matches edge fn). ✅
- Legacy `.limit` cleanup → Task 5. ✅
- Out of scope (edge cutover, GIN index) → not in plan, per spec. ✅

**Placeholder scan:** No TBD/TODO; all code blocks complete. ✅

**Type/name consistency:** `match_surfers` arg names identical across Task 2 SQL, Task 3 `supabase.rpc` call, and grants. Return columns (`country_match`, `area_match`, `match_score`, `days_in_destination`, `total_count`) consistent between Task 2 `returns table`, Task 2 parity query, and Task 3 mapper. Helper names (`mc_norm_board`, `mc_board_pass`, `mc_country_from_match`, `mc_dest_country`, `mc_dest_country_match`, `mc_area_match`, `mc_surf_level_pass`) consistent between Task 1 definitions and Task 2 usage. ✅

**Known follow-ups (logged, not gaps):** GIN-indexed `destination_countries` column for very large tables; production edge-function cutover with live-source diff.
