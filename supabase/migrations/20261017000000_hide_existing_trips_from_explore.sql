-- Hide every trip that existed on 2026-10-17 from the Explore feed.
-- DATA ONLY, no schema change. APPLIED to prod 2026-10-17 via execute_sql.
--
-- Uses the existing visibility setting: 'link_only' trips are left out by
-- explore_feed (it keeps `visibility IS NULL OR 'public'`), but members, the
-- trip page and invite links keep working, and the host's visibility sheet
-- shows the truth. No trigger on group_trips reacts to visibility, so this
-- sends no notifications.
--
-- UNDO (puts these 21 back on Explore):
--   update public.group_trips set visibility = 'public' where id in (<the ids below>);

update public.group_trips set visibility = 'link_only'
where status = 'active' and (visibility is null or visibility = 'public')
  and id in (
    'cf6d43b4-551b-4c1b-a451-76ad6ce74f07', -- Maldives Barrels
    '1ce7c3d1-d875-49b3-b530-a52973302e19', -- Swellyo California
    '23c2cbfa-58db-47b2-b99c-d3cea64ea5c8', -- Maldives bay
    '50c7ad77-60ec-4253-bada-b79b31ed2cb5', -- Nicatime
    '25a4115b-070d-4b5f-875b-2fc9ded535c0', -- Baja Weekend Mission
    'f8c7b7f5-012d-47ad-8454-54c2949beeca', -- Philippines
    'e7f318c0-8888-4766-8118-ca893478000b', -- Bali loves waves
    'f58f7917-baa1-4573-86ff-4e8ac00ee5d9', -- Madeira Magic
    '2ee747ee-84bc-45bf-9f79-43d028481c54', -- Annie's bday trip
    '46296e43-fbd6-4a52-ab97-02a42f103f81', -- Tropical surf trip
    '00939020-01de-4d22-8ca9-92f61b02b7b6', -- Vibing in Sri Lanka
    'e3d5b9bf-a5d3-4f8f-a60e-cc6fdda4840d', -- Saladita Rules!
    '9d79e128-1aa0-4da4-8e01-0f9dde42c013', -- Scp
    'a923b064-f8ad-4737-a74e-02e2dca70780', -- Surf fun and love
    '63b56dd3-01a4-4fd9-858d-811015a16110', -- Sri Lanka Surf
    'b2cd7d2b-fc3a-41ba-8555-1eb31c7cbc8a', -- Barrels-o-fun 4 MB
    '187a16ba-29a1-43ee-a43e-2dfa0f0eacd9', -- Shsh
    'c4a6634e-ed34-4ee6-8ab7-072c70354a0a', -- Bali
    '56dfe2ed-1e29-4ec5-8f88-b210090d73ac', -- Ffg
    '46cd0d80-ca28-472b-8c2c-bfadf7e17edb', -- La ku ka racha
    '6765ef22-f1c2-443f-8b6a-8547664d908d'  -- Booming Beginners
  );
