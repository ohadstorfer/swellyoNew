-- Ohad canary (images-to-s3 phase 0): point ONLY his rows at swellyo-images S3.
-- Reversible via rollback-ohad-urls.sql. The client read helpers derive the
-- __<size>.jpg / __1280w.jpg variants from these source URLs on the fly.
update surfers set
  profile_image_url = 'https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/ecaaa678-974a-4641-895a-12cf12e74599/profile-1782408078765.jpg',
  cover_image_url   = 'https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/ecaaa678-974a-4641-895a-12cf12e74599/cover-1778290756037.jpg'
where user_id = 'ecaaa678-974a-4641-895a-12cf12e74599';

update group_trips set
  hero_image_url = 'https://swellyo-images.s3.us-east-1.amazonaws.com/trip-images/ecaaa678-974a-4641-895a-12cf12e74599/hero-1783171731990.jpg'
where id = '5c042bf4-18af-496c-a3e1-262bfa0a3efc';
