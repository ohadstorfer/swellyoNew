-- Fire-and-forget thumbnail generation on every image upload. pg_net queues the
-- request and returns immediately, so the upload is never blocked (background).
-- Mirrors the project's existing pg_net pattern (cron / notifications).
--
-- APPLIED to prod 2026-06-25 via MCP execute_sql (remote migration history frozen).
-- The function lives in `public` (not `storage`): even the `postgres` role lacks
-- CREATE on the `storage` schema, which is owned by supabase_storage_admin. The
-- trigger itself is still ON storage.objects.
--
-- PREREQ (done): Vault secret `thumbnail_secret` holds the same value as the
-- edge function's THUMBNAIL_SECRET env. The function is deployed with
-- --no-verify-jwt, so x-thumb-secret is the sole gate (no Authorization needed).
create extension if not exists pg_net;

create or replace function public.enqueue_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = public, storage, extensions, pg_temp
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'thumbnail_secret';

  -- timeout_milliseconds := 30000: ImageScript resize runs 4-12s, so the 5s
  -- pg_net default would cut the connection (work still completes, but the
  -- response is recorded as a timeout). 30s lets pg_net record the real status.
  perform net.http_post(
    url     := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/generate-thumbnail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-thumb-secret', coalesce(v_secret, '')
    ),
    body    := jsonb_build_object('bucket', NEW.bucket_id, 'path', NEW.name),
    timeout_milliseconds := 30000
  );
  return NEW;
end;
$$;

-- Not PostgREST-callable (matches the project's SECDEF hardening).
revoke execute on function public.enqueue_thumbnail() from public, anon, authenticated;

drop trigger if exists trg_enqueue_thumbnail on storage.objects;
create trigger trg_enqueue_thumbnail
  after insert on storage.objects
  for each row
  when (
    NEW.bucket_id in ('profile-images','trip-images','surftrip-images','lifestyle-thumbnails')
    and coalesce(NEW.metadata->>'mimetype','') like 'image/%'
  )
  execute function public.enqueue_thumbnail();
