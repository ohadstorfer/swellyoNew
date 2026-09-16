-- Waiver PDFs are capped at 10 MB (Figma 15258-74979: "Swellyo supports PDF
-- waivers up to 10 MB"). Ohad, 15 Sep: enforce it, don't just say it.
--
-- ── WHERE THE CHECK LIVES ───────────────────────────────────────────────────
-- Not in a storage policy: an INSERT policy on storage.objects runs before the
-- upload's size is known, so `metadata->>'size'` cannot be trusted there. And
-- not the bucket's `file_size_limit` (15 MB): the bucket also holds traveler
-- documents and insurance photos, which keep their own limit.
--
-- Instead, on the two rows that POINT at a waiver file:
--   · operator_settings.default_waiver_path          (the template)
--   · organized_trip_operator_documents.storage_path  (kind = 'waiver')
-- The file is always uploaded before the row is written, so by then storage
-- has recorded its real size. A row pointing at a file over 10 MB is refused,
-- whatever the client claims. An unreferenced upload is inert: nothing reads it.
--
-- Fires only when the path CHANGES. Existing rows are never re-checked (checked
-- live 15 Sep: every waiver on file is well under 1 MB anyway).
--
-- The template's `default_waiver_size_bytes` is also set from storage here, so
-- the stored size is the real one rather than what the phone reported.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent.

create or replace function public.waiver_file_size_bytes(p_path text)
returns bigint
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select (o.metadata->>'size')::bigint
    from storage.objects o
   where o.bucket_id = 'group-trip-documents'
     and o.name = p_path
$$;

revoke execute on function public.waiver_file_size_bytes(text) from public, anon, authenticated;

comment on function public.waiver_file_size_bytes(text) is
  'Real byte size of a group-trip-documents object, from storage metadata. '
  'Trigger helper for the 10 MB waiver limit; not callable by clients.';


-- ── Default waiver on operator_settings ───────────────────────────────────
create or replace function public.guard_default_waiver_size()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_size bigint;
begin
  if new.default_waiver_path is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.default_waiver_path is not distinct from old.default_waiver_path then
    return new;
  end if;

  v_size := public.waiver_file_size_bytes(new.default_waiver_path);

  if v_size is not null and v_size > 10485760 then
    raise exception 'Waiver PDFs can be up to 10 MB.'
      using errcode = 'check_violation';
  end if;

  -- The real size, not the client's.
  if v_size is not null then
    new.default_waiver_size_bytes := v_size;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_default_waiver_size on public.operator_settings;
create trigger trg_guard_default_waiver_size
  before insert or update of default_waiver_path on public.operator_settings
  for each row execute function public.guard_default_waiver_size();

revoke execute on function public.guard_default_waiver_size() from public, anon, authenticated;


-- ── A trip's waiver ───────────────────────────────────────────────────────
create or replace function public.guard_trip_waiver_size()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_size bigint;
begin
  if new.kind <> 'waiver' or new.storage_path is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.storage_path is not distinct from old.storage_path then
    return new;
  end if;

  v_size := public.waiver_file_size_bytes(new.storage_path);

  if v_size is not null and v_size > 10485760 then
    raise exception 'Waiver PDFs can be up to 10 MB.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_trip_waiver_size on public.organized_trip_operator_documents;
create trigger trg_guard_trip_waiver_size
  before insert or update of storage_path on public.organized_trip_operator_documents
  for each row execute function public.guard_trip_waiver_size();

revoke execute on function public.guard_trip_waiver_size() from public, anon, authenticated;
