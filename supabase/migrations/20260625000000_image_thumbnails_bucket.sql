-- Public bucket holding pre-generated static thumbnails. Read is public;
-- writes are service-role only (the generate-thumbnail edge fn). Replaces the
-- Supabase Storage Image Transformation endpoint (/render/image/...), whose
-- meter counts distinct origin images per cycle and does not scale with content.
--
-- APPLIED MANUALLY in the Supabase SQL editor (remote migration history is
-- frozen — never `supabase db push`).
insert into storage.buckets (id, name, public)
values ('image-thumbnails', 'image-thumbnails', true)
on conflict (id) do update set public = true;

-- Public read.
drop policy if exists "image-thumbnails public read" on storage.objects;
create policy "image-thumbnails public read"
  on storage.objects for select
  using (bucket_id = 'image-thumbnails');

-- No anon/authenticated write policy → only the service role (which bypasses
-- RLS) can write. The edge fn uses the service-role key.

-- Verify:
--   select id, public from storage.buckets where id = 'image-thumbnails';
--   -- Expected: image-thumbnails | t
