-- Passport APIS fields on organized_trip_travelers_documents.
--
-- WHY: the operator books flights for the group. An airline booking needs the
-- APIS / SSR DOCS field set, not a picture. Before this migration the row held
-- only full_name / nationality / expiry_date, so the operator had to open the
-- passport image to read the rest. With these columns they book from text and
-- never open the file.
--
-- The passport NUMBER is the one field that is identity-theft-grade on its own,
-- so it is stored encrypted (AES-256-GCM, key lives in Edge Function secrets as
-- DOCUMENT_ENCRYPTION_KEY -- NOT in this database) and it is wiped by the same
-- 30-day purge that deletes the file. Every other typed field survives the
-- purge on purpose, so a repeat traveler does not retype them.
--
-- Note on `passport_number_enc` privileges: it is deliberately left readable by
-- `authenticated`. Postgres column-level REVOKE does not override a table-level
-- GRANT -- hiding one column would mean revoking table SELECT and re-granting
-- every other column by name, which silently breaks the next time someone adds
-- a column. Ciphertext without the key is useless, so that trade is not worth
-- taking. The key never touches the database.
--
-- Spec: docs/specs/operator-trips/documents-storage.md

alter table public.organized_trip_travelers_documents
  -- Name split. Airlines need surname and given names separately, and a
  -- mismatch against the passport is the #1 cause of change fees. Uppercase
  -- A-Z and spaces only: the client transliterates accents (MUÑOZ -> MUNOZ)
  -- before it gets here, because that is what a GDS accepts.
  add column if not exists surname         text,
  add column if not exists given_names     text,
  add column if not exists date_of_birth   date,
  add column if not exists sex             text,
  -- ISO 3166-1 alpha-3, as printed in the MRZ. Often differs from nationality
  -- (a dual national travelling on the other passport).
  add column if not exists issuing_country text,
  -- "v1:<base64(iv || ciphertext||tag)>". Written and read only by the
  -- group-document-passport Edge Function. Wiped by purge-group-documents.
  add column if not exists passport_number_enc text;

-- `full_name` stays. Passports use the split fields; the other upload kinds
-- (insurance, visa, flight tickets) have no MRZ and keep using full_name.
comment on column public.organized_trip_travelers_documents.full_name is
  'Legacy/non-passport documents only. Passports use surname + given_names.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'otd_surname_format') then
    alter table public.organized_trip_travelers_documents
      add constraint otd_surname_format
      check (surname is null or surname ~ '^[A-Z][A-Z ]*$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'otd_given_names_format') then
    alter table public.organized_trip_travelers_documents
      add constraint otd_given_names_format
      check (given_names is null or given_names ~ '^[A-Z][A-Z ]*$');
  end if;

  -- M / F / X. The MRZ uses '<' for unspecified; the client maps that to 'X'.
  if not exists (select 1 from pg_constraint where conname = 'otd_sex_values') then
    alter table public.organized_trip_travelers_documents
      add constraint otd_sex_values
      check (sex is null or sex in ('M', 'F', 'X'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'otd_issuing_country_iso3') then
    alter table public.organized_trip_travelers_documents
      add constraint otd_issuing_country_iso3
      check (issuing_country is null or issuing_country ~ '^[A-Z]{3}$');
  end if;

  -- Sane range only. `current_date` cannot appear here -- a CHECK constraint
  -- accepts only IMMUTABLE expressions and current_date is STABLE. "Not in the
  -- future" is enforced in the group-document-passport function instead.
  if not exists (select 1 from pg_constraint where conname = 'otd_dob_sane') then
    alter table public.organized_trip_travelers_documents
      add constraint otd_dob_sane
      check (date_of_birth is null
             or date_of_birth between date '1900-01-01' and date '2100-01-01');
  end if;
end $$;

-- No new grants. The table already carries `select, insert, delete` for
-- `authenticated` and no UPDATE grant at all -- the typed fields are written by
-- the group-document-passport Edge Function under the service role, which is
-- what keeps the encrypted column out of client hands on the write side too.
