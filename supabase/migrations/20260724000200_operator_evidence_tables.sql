-- Operator Trips — the four evidence tables.
--
-- "Done" for a requirement is ALWAYS derived from these rows. There is no
-- per-traveler state table (decided 2026-07-23):
--   upload      -> group_trip_documents        (approved_at / rejected_at)
--   acknowledge -> group_trip_acknowledgements (row exists)
--   medical     -> group_trip_medical_forms    (completed_at)
--   pay         -> the payment ledger          (not built yet)
--
-- Every table keys on trip_id + user_id like every other group_trip_* child
-- table, and FKs auth.users(id) — same as group_trip_participants.
--
-- Specs: documents-storage.md, approval-review.md, waiver-medical.md

-- ══════════════════════════════════════════════════════════════════
-- 1. Traveler uploads: passport, insurance, visa, flight tickets.
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.group_trip_documents (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.group_trips(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  requirement_id   uuid not null references public.group_trip_requirements(id) on delete cascade,
  storage_path     text not null,          -- <trip_id>/<user_id>/<document_id>.<ext>
  mime_type        text not null,
  byte_size        integer not null,
  uploaded_at      timestamptz not null default now(),

  -- review. Reject deletes the FILE and keeps this row; re-upload replaces it.
  approved_at      timestamptz,
  approved_by      uuid references auth.users(id) on delete set null,
  rejected_at      timestamptz,
  approbation_note text,                   -- operator's note: on reject, optional on approve

  -- typed fields that survive the file being purged
  full_name        text,
  nationality      text,
  expiry_date      date,

  file_deleted_at  timestamptz,            -- set by the 30-day purge; the row stays

  constraint gtd_not_both_states check (approved_at is null or rejected_at is null)
);

-- One live document per (trip, traveler, requirement) — stops double counting.
create unique index if not exists uq_gtd_trip_user_requirement
  on public.group_trip_documents (trip_id, user_id, requirement_id);

create index if not exists idx_gtd_pending_review
  on public.group_trip_documents (trip_id)
  where approved_at is null and rejected_at is null;

alter table public.group_trip_documents enable row level security;
revoke all on public.group_trip_documents from anon, authenticated;
grant  select, insert, delete on public.group_trip_documents to authenticated;

drop policy if exists gtd_select on public.group_trip_documents;
create policy gtd_select on public.group_trip_documents
  for select to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

drop policy if exists gtd_insert on public.group_trip_documents;
create policy gtd_insert on public.group_trip_documents
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_participant(trip_id));

-- Traveler removes/replaces their own; host's reject goes through the RPC.
drop policy if exists gtd_delete on public.group_trip_documents;
create policy gtd_delete on public.group_trip_documents
  for delete to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

-- No UPDATE policy on purpose: approve / reject are SECURITY DEFINER RPCs.

-- ══════════════════════════════════════════════════════════════════
-- 2. Operator-published materials. Waiver first; itineraries later.
--    Versioned and append-only, so an agreement always points at the
--    exact text the traveler saw.
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.group_trip_operator_documents (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.group_trips(id) on delete cascade,
  -- nullable + set null: a published document must outlive its author's account.
  created_by    uuid references auth.users(id) on delete set null,
  kind          text not null check (kind in ('waiver')),
  version       integer not null check (version > 0),
  body_text     text,
  storage_path  text,                      -- <trip_id>/operator/<id>.<ext>
  published_at  timestamptz not null default now(),
  unique (trip_id, kind, version),
  constraint op_doc_has_content check (body_text is not null or storage_path is not null)
);

create index if not exists idx_gtod_trip_kind
  on public.group_trip_operator_documents (trip_id, kind, version desc);

alter table public.group_trip_operator_documents enable row level security;
revoke all on public.group_trip_operator_documents from anon, authenticated;
grant  select, insert on public.group_trip_operator_documents to authenticated;

drop policy if exists gtod_select on public.group_trip_operator_documents;
create policy gtod_select on public.group_trip_operator_documents
  for select to authenticated
  using (public.is_trip_host(trip_id) or public.is_trip_participant(trip_id));

drop policy if exists gtod_insert on public.group_trip_operator_documents;
create policy gtod_insert on public.group_trip_operator_documents
  for insert to authenticated
  with check (public.is_trip_host(trip_id));

-- No UPDATE / DELETE policy: published versions are immutable.

-- ══════════════════════════════════════════════════════════════════
-- 3. Acknowledgements — the waiver and any custom "I agree" item.
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.group_trip_acknowledgements (
  id                   uuid primary key default gen_random_uuid(),
  requirement_id       uuid not null references public.group_trip_requirements(id) on delete cascade,
  trip_id              uuid not null references public.group_trips(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  agreed_name          text not null,      -- the name shown on screen at agree time
  agreed_at            timestamptz not null default now(),
  -- waiver only: the exact version agreed to. restrict = a version somebody
  -- agreed to can never be deleted.
  operator_document_id uuid references public.group_trip_operator_documents(id) on delete restrict,
  agreed_version       integer
);

create unique index if not exists uq_ack_opdoc_user
  on public.group_trip_acknowledgements (operator_document_id, user_id)
  where operator_document_id is not null;

create unique index if not exists uq_ack_req_user
  on public.group_trip_acknowledgements (requirement_id, user_id)
  where operator_document_id is null;

create index if not exists idx_ack_trip on public.group_trip_acknowledgements (trip_id);

alter table public.group_trip_acknowledgements enable row level security;
revoke all on public.group_trip_acknowledgements from anon, authenticated;
grant  select, insert on public.group_trip_acknowledgements to authenticated;

drop policy if exists ack_select on public.group_trip_acknowledgements;
create policy ack_select on public.group_trip_acknowledgements
  for select to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

drop policy if exists ack_insert on public.group_trip_acknowledgements;
create policy ack_insert on public.group_trip_acknowledgements
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_participant(trip_id));

-- No UPDATE / DELETE policy: that is what makes an agreement immutable.

-- ══════════════════════════════════════════════════════════════════
-- 4. Medical form. Per trip, never copied to the profile.
--    Rows, never files. Operator reads; operator never writes or exports.
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.group_trip_medical_forms (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.group_trips(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  allergies        text,   allergies_none   boolean not null default false,
  dietary          text,   dietary_none     boolean not null default false,
  injuries         text,   injuries_none    boolean not null default false,
  medications      text,   medications_none boolean not null default false,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (trip_id, user_id),
  constraint medical_text_len check (
    coalesce(length(allergies), 0)   <= 1000 and
    coalesce(length(dietary), 0)     <= 1000 and
    coalesce(length(injuries), 0)    <= 1000 and
    coalesce(length(medications), 0) <= 1000
  )
);

create index if not exists idx_gtmf_trip on public.group_trip_medical_forms (trip_id);

-- SECURITY INVOKER on purpose — see the note in 20260724000100.
create or replace function public.touch_group_trip_medical_forms()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$ begin new.updated_at := now(); return new; end $$;

revoke execute on function public.touch_group_trip_medical_forms() from public, anon, authenticated;

drop trigger if exists trg_touch_group_trip_medical_forms on public.group_trip_medical_forms;
create trigger trg_touch_group_trip_medical_forms
  before update on public.group_trip_medical_forms
  for each row execute function public.touch_group_trip_medical_forms();

alter table public.group_trip_medical_forms enable row level security;
revoke all on public.group_trip_medical_forms from anon, authenticated;
grant  select, insert, update on public.group_trip_medical_forms to authenticated;
-- deliberately no DELETE grant, for anyone.

drop policy if exists medical_traveler_select on public.group_trip_medical_forms;
create policy medical_traveler_select on public.group_trip_medical_forms
  for select to authenticated using (user_id = auth.uid());

drop policy if exists medical_operator_select on public.group_trip_medical_forms;
create policy medical_operator_select on public.group_trip_medical_forms
  for select to authenticated using (public.is_trip_host(trip_id));

drop policy if exists medical_traveler_insert on public.group_trip_medical_forms;
create policy medical_traveler_insert on public.group_trip_medical_forms
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_participant(trip_id));

drop policy if exists medical_traveler_update on public.group_trip_medical_forms;
create policy medical_traveler_update on public.group_trip_medical_forms
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Operator has read only. No operator insert / update / delete policy. Ever.

-- Dashboard counts. security_invoker so RLS still applies to the caller.
create or replace view public.group_trip_medical_flags
with (security_invoker = true) as
select trip_id,
       count(*) filter (where coalesce(length(trim(injuries)), 0)    > 0) as injuries_reported,
       count(*) filter (where coalesce(length(trim(allergies)), 0)   > 0) as allergies_reported,
       count(*) filter (where coalesce(length(trim(dietary)), 0)     > 0) as dietary_reported,
       count(*) filter (where coalesce(length(trim(medications)), 0) > 0) as medications_reported,
       count(*) filter (where completed_at is not null)                   as forms_completed
from public.group_trip_medical_forms
group by trip_id;

-- Supabase's default privileges grant ALL on new tables/views in public to
-- anon + authenticated. Views are not covered by the table revokes above, so
-- revoke explicitly or anon holds grants on a medical view.
revoke all    on public.group_trip_medical_flags from anon, public;
grant  select on public.group_trip_medical_flags to   authenticated;
