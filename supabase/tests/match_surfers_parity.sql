-- Read-only sanity / parity checks for match_surfers against live data.
-- Replace the placeholder uuid with a real surfer user_id, and use destinations
-- you know exist in the data. Run in the Supabase SQL Editor.

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
  for r in select * from match_surfers('00000000-0000-0000-0000-000000000000'::uuid, p_destination_country := 'Indonesia') loop
    assert r.match_score > 0, 'dest score must be > 0';
    assert r.country_match = true, 'dest country_match must be true';
    assert r.days_in_destination = r.match_score, 'dest score == days';
  end loop;
  select count(*) into n from match_surfers('00000000-0000-0000-0000-000000000000'::uuid, p_destination_country := 'Indonesia');
  assert n <= 3, 'page size <= 3';
  raise notice 'PARITY INVARIANTS PASSED';
end $$;
