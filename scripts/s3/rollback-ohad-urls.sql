-- Revert the Ohad canary: point his rows back at the Supabase originals (still
-- present — nothing was deleted). One-statement-per-table instant rollback.
update surfers set
  profile_image_url = 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/profile-images/ecaaa678-974a-4641-895a-12cf12e74599/profile-1782408078765.jpg',
  cover_image_url   = 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/profile-images/ecaaa678-974a-4641-895a-12cf12e74599/cover-1778290756037.jpg'
where user_id = 'ecaaa678-974a-4641-895a-12cf12e74599';

update group_trips set
  hero_image_url = 'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/trip-images/ecaaa678-974a-4641-895a-12cf12e74599/hero-1783171731990.jpg'
where id = '5c042bf4-18af-496c-a3e1-262bfa0a3efc';
