-- Rejecting a document deletes its file. Let the row say so at that moment.
--
-- `operator_reject_document` marks the row and the CLIENT removes the object
-- (the host holds the storage DELETE policy; the RPC cannot reach the storage
-- backend). Nothing then stamped `file_deleted_at` — only the nightly
-- `purge-group-documents` job did, on its next run. So for up to a day the row
-- claimed a file that was already gone: the review screen offered to open it
-- and Supabase Storage answered "Object not found" into the operator's face.
-- Ohad, 5 August 2026: "es mala UX porque no dice nada al respecto."
--
-- This is the missing half. The client calls it AFTER `storage.remove()`
-- succeeds, and only then.
--
-- ── Why the order is not a detail ────────────────────────────────────────────
--
-- The purge's third case sweeps `rejected_at is not null and file_deleted_at is
-- null` — rejected rows whose client-side delete never landed. That means a
-- stamp written BEFORE the object is actually gone does not merely record
-- something untrue: it hides the orphan from the only job that would ever have
-- removed it, permanently. Stamp last, or not at all. A missing stamp costs a
-- day of a stale row; a premature one costs a passport photo living in the
-- bucket forever.
--
-- Authorisation matches `operator_reject_document` exactly (`is_trip_host`), so
-- whoever can reject can record the consequence. Nothing else is writable here.
--
-- Spec: docs/specs/operator-trips/documents-storage.md §8

create or replace function public.operator_mark_document_file_deleted(
  p_document_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare d record;
begin
  select * into d from public.organized_trip_travelers_documents where id = p_document_id;
  if d is null then raise exception 'document not found'; end if;
  if not public.is_trip_host(d.trip_id) then raise exception 'not your trip'; end if;

  -- REJECTED ROWS ONLY.
  --
  -- Not a formality: `file_deleted_at` is what excludes a row from the purge.
  -- Allowing it on a live document would let a host quietly opt one out of the
  -- 30-day sweep while its file sits in the bucket — the exact failure this
  -- column exists to prevent. A rejected row is the one case where the file is
  -- known to be on its way out.
  if d.rejected_at is null then
    raise exception 'document % is not rejected', p_document_id;
  end if;

  -- `coalesce` so a retry (or a purge that got there first) never rewrites the
  -- original timestamp. When the file went is a retention fact, not a log line.
  update public.organized_trip_travelers_documents
     set file_deleted_at = coalesce(file_deleted_at, now())
   where id = p_document_id;
end $$;

-- SECURITY DEFINER functions in `public` are PostgREST-callable by anon unless
-- told otherwise, and CREATE OR REPLACE re-grants PUBLIC every time. Both lines
-- have to follow the function, every time it is recreated.
revoke execute on function public.operator_mark_document_file_deleted(uuid) from public, anon;
grant  execute on function public.operator_mark_document_file_deleted(uuid) to authenticated;
