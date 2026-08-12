-- Operator setup, steps 5 and 6: the insurance certificate, and agreeing to
-- Swellyo's terms.
--
-- ⚠️ THE DEFAULTS UPLOAD POLICY IS WIDENED HERE. It was written for the waiver
-- and hard-codes `\.pdf$`. An insurance certificate is very often a PHOTO of a
-- paper certificate, so the regex now accepts the same extensions the bucket
-- itself allows (jpg|jpeg|png|heic|pdf). Without this the upload fails with a
-- storage RLS violation that says nothing about file types.
--
-- WHY INSURANCE HAS NO HASH, WHERE THE WAIVER DOES. The waiver is COPIED onto
-- every trip and a traveler agrees to that exact file, so the hash is what
-- proves the PDF they agreed to is the PDF we still hold. Insurance is a
-- certificate Swellyo holds about the operator — nobody agrees to it, nothing
-- is derived from it, and a hash would be ceremony.
--
-- WHY `terms_version` EXISTS BEFORE THE TERMS DO. There is no terms document
-- yet; the client stores a placeholder version string. When real terms are
-- published the version changes, and every operator on an older version has an
-- unfinished setup step again — which is the entire point of recording it.
-- Adding the column now costs nothing; adding it later means a backfill that
-- cannot tell who agreed to what.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent: safe to re-run.

alter table public.operator_settings
  add column if not exists insurance_path        text,
  add column if not exists insurance_name        text,
  add column if not exists insurance_mime        text,
  add column if not exists insurance_size_bytes  integer,
  add column if not exists insurance_uploaded_at timestamptz,
  add column if not exists terms_accepted_at     timestamptz,
  add column if not exists terms_version         text;

comment on column public.operator_settings.insurance_path is
  'Storage object under defaults/<user_id>/<uuid>.<ext> in group-trip-documents. '
  'Photo or PDF. Held about the operator; never copied onto a trip, unlike the waiver.';

comment on column public.operator_settings.terms_version is
  'Which version of Swellyo''s operator terms was accepted. A placeholder until '
  'real terms are published; changing it makes every operator re-accept.';

do $$
begin
  -- All-or-nothing, same shape as the waiver constraint: a path with no
  -- timestamp is a row that cannot say when it was provided.
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_insurance_complete_check') then
    alter table public.operator_settings
      add constraint operator_settings_insurance_complete_check
      check (insurance_path is null or insurance_uploaded_at is not null);
  end if;

  -- An acceptance with no version is unusable: it cannot answer "did they agree
  -- to the CURRENT terms", which is the only question this data is ever asked.
  if not exists (select 1 from pg_constraint
                  where conname = 'operator_settings_terms_version_check') then
    alter table public.operator_settings
      add constraint operator_settings_terms_version_check
      check (terms_accepted_at is null or terms_version is not null);
  end if;
end $$;


-- ── Widen the defaults upload policy to images ────────────────────────────
-- Replaces the waiver-only `\.pdf$`. SELECT and DELETE are untouched: they
-- already match on the prefix alone and never looked at the extension.
drop policy if exists "group docs: operator uploads own default" on storage.objects;
create policy "group docs: operator uploads own default"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-trip-documents'
  and name ~ '^defaults/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|heic|pdf)$'
  and ((storage.foldername(name))[2])::uuid = (select auth.uid())
);
