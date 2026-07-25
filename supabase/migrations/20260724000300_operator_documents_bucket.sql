-- Operator Trips — private storage bucket for trip documents.
--
-- These are the most sensitive files Swellyo holds. Rules:
--   * bucket is PRIVATE. Never flip `public` to true.
--   * two key shapes in one bucket:
--       <trip_id>/<user_id>/<document_id>.<ext>   traveler uploads
--       <trip_id>/operator/<document_id>.<ext>    operator materials (waiver)
--   * reads use a ~60s signed URL minted per view, never a public URL.
--   * documents never enter the image/video pipeline (no thumbnails, no Lambda).
--
-- Spec: docs/specs/operator-trips/documents-storage.md

-- ── 1. Bucket. 15 MB cap, images + PDF only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-trip-documents', 'group-trip-documents', false, 15728640,
        array['image/jpeg','image/png','image/heic','application/pdf'])
on conflict (id) do update
  set public            = false,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Access predicate, written once.
--   Traveler path  <trip_id>/<user_id>/... : the owner, or any host of the trip.
--   Operator path  <trip_id>/operator/...  : any host or participant of the trip
--                                            (travelers must be able to read the waiver).
--   The regex guard matters: without it a malformed path makes the ::uuid cast
--   raise instead of returning false.
create or replace function public.can_access_group_document(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    when object_path ~ '^[0-9a-fA-F-]{36}/operator/' then
      public.is_trip_host(((storage.foldername(object_path))[1])::uuid)
      or public.is_trip_participant(((storage.foldername(object_path))[1])::uuid)
    when object_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/' then
      ((storage.foldername(object_path))[2])::uuid = auth.uid()
      or public.is_trip_host(((storage.foldername(object_path))[1])::uuid)
    else false
  end;
$$;

-- Called from inside a storage policy, so it runs as the CALLING role:
-- `authenticated` must keep EXECUTE. Do not add it to a blanket revoke pass.
revoke execute on function public.can_access_group_document(text) from public, anon;
grant  execute on function public.can_access_group_document(text) to authenticated;

-- ── 3. Policies on storage.objects. No policy for anon, on purpose.
--   The purge job uses the service role, which bypasses RLS — the only
--   privileged path.

-- INSERT: a traveler writes only into their own folder.
drop policy if exists "group docs: traveler uploads own" on storage.objects;
create policy "group docs: traveler uploads own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-trip-documents'
  and name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|heic|pdf)$'
  and ((storage.foldername(name))[2])::uuid = auth.uid()
);

-- INSERT: only a host writes operator materials.
drop policy if exists "group docs: host uploads operator materials" on storage.objects;
create policy "group docs: host uploads operator materials"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-trip-documents'
  and name ~ '^[0-9a-fA-F-]{36}/operator/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|heic|pdf)$'
  and public.is_trip_host(((storage.foldername(name))[1])::uuid)
);

-- SELECT: also gates createSignedUrl — Supabase checks SELECT before it signs.
drop policy if exists "group docs: traveler or host reads" on storage.objects;
create policy "group docs: traveler or host reads"
on storage.objects for select to authenticated
using (bucket_id = 'group-trip-documents'
       and public.can_access_group_document(name));

-- DELETE: traveler removes their own; host's reject deletes the file.
-- Operator materials are immutable, so hosts only (not participants).
drop policy if exists "group docs: traveler or host deletes" on storage.objects;
create policy "group docs: traveler or host deletes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'group-trip-documents'
  and case
    when name ~ '^[0-9a-fA-F-]{36}/operator/' then
      public.is_trip_host(((storage.foldername(name))[1])::uuid)
    else public.can_access_group_document(name)
  end
);

-- No UPDATE policy on purpose. Objects are immutable: replace = delete + new id.
