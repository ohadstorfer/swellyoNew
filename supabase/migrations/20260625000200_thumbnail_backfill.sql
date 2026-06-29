-- One-time: enqueue thumbnail generation for every existing image already in the
-- source buckets. Safe to re-run (the edge fn is idempotent). pg_net queues the
-- requests; they drain in the background.
--
-- Run AFTER 20260625000000 (bucket) + 20260625000100 (trigger/secrets) and the
-- generate-thumbnail edge fn are deployed.
--
-- For very large buckets, run in keyset batches instead of all at once:
--   ... and o.name > '<last-name>' order by o.name limit 500;
select net.http_post(
  url     := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/generate-thumbnail',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-thumb-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'thumbnail_secret')
  ),
  body    := jsonb_build_object('bucket', o.bucket_id, 'path', o.name),
  timeout_milliseconds := 30000
)
from storage.objects o
where o.bucket_id in ('profile-images','trip-images','surftrip-images','lifestyle-thumbnails')
  and coalesce(o.metadata->>'mimetype','') like 'image/%'
  and o.name not like '%/cover-%';
