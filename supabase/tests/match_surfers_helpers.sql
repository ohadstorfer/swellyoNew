-- Deterministic literal-input assertions for the match_surfers helpers.
-- Run in Supabase SQL Editor. Each assert raises on failure; clean run = all pass.
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
