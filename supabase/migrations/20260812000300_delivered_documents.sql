-- Documents the OPERATOR hands to a traveler — tickets, itineraries,
-- confirmations, a packing list.
--
-- Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part B.
--
-- ── The one rule this table exists to enforce ───────────────────────────────
-- "Operator uploads to the wallet" is two features, and only one of them is
-- safe:
--
--   DELIVERY  — the operator gives the traveler a document the operator issued.
--               Safe. This table.
--   FULFILMENT — the operator provides a document the TRAVELER owes: their
--               passport, their signed waiver, their medical form.
--               Not built, and there is no column here that could express it.
--
-- The second one destroys the evidence. Every requirement record answers "did
-- this person provide this, and when". An operator-signed waiver is not a
-- waiver, it is a liability with a signature on it; a passport somebody else
-- uploaded proves nothing about who chose to hand it over. So this table has
-- NO `requirement_id`, and nothing about it can ever satisfy a requirement.
-- The absence of that column is the feature.
--
-- ── Why not extend organized_trip_operator_documents ────────────────────────
-- That table holds the operator's OWN paperwork — their default waiver, their
-- liability insurance certificate — which travelers must never see. Adding a
-- recipient to it would put "documents nobody may read" and "documents
-- delivered to a named traveler" behind one policy, and the first mistake in
-- that predicate leaks the insurance certificate to the whole trip. Different
-- audiences, different tables.

create table if not exists public.organized_trip_delivered_documents (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.group_trips(id) on delete cascade,
  -- NULL = everybody on the trip. A named user = that traveler only.
  --
  -- Nullable rather than two tables, because "who is this for" is the only
  -- difference between the two cases and every read path wants them merged
  -- into one list anyway.
  recipient_id  uuid references auth.users(id) on delete cascade,
  uploaded_by   uuid not null references auth.users(id),
  title         text not null check (length(btrim(title)) between 1 and 200),
  note          text check (note is null or length(note) <= 1000),
  storage_path  text not null,
  size_bytes    integer check (size_bytes is null or size_bytes >= 0),
  delivered_at  timestamptz not null default now(),
  -- Withdrawing hides the row from the traveler and keeps it for us, the same
  -- way a refund keeps its row: "they were given this, then it was taken back"
  -- is a different fact from "they were never given anything", and only one of
  -- them survives a delete.
  withdrawn_at  timestamptz
);

create index if not exists otdd_trip_idx
  on public.organized_trip_delivered_documents(trip_id);
create index if not exists otdd_recipient_idx
  on public.organized_trip_delivered_documents(trip_id, recipient_id)
  where withdrawn_at is null;

comment on table public.organized_trip_delivered_documents is
  'Documents the operator DELIVERS to travelers. Never a requirement fulfilment '
  '— there is deliberately no requirement_id. See the migration header.';

comment on column public.organized_trip_delivered_documents.recipient_id is
  'NULL = delivered to everyone on the trip. Set = that traveler only.';

-- ══════════════════════════════════════════════════════════════════
-- RLS — the whole risk of this feature lives here
-- ══════════════════════════════════════════════════════════════════

alter table public.organized_trip_delivered_documents enable row level security;

-- Traveler read. Three conditions, and dropping any one of them is a leak:
--   1. they are actually on this trip,
--   2. the document is addressed to everyone OR to them specifically,
--   3. it has not been withdrawn.
-- Staff with roster.view read everything, withdrawn rows included, because for
-- them the withdrawal is part of the record rather than something to hide.
drop policy if exists otdd_select on public.organized_trip_delivered_documents;
create policy otdd_select on public.organized_trip_delivered_documents
  for select to authenticated
  using (
    public.trip_staff_can(trip_id, 'roster.view')
    or (
      public.is_trip_participant(trip_id)
      and withdrawn_at is null
      and (recipient_id is null or recipient_id = auth.uid())
    )
  );

-- Write is staff-only, and travelers are given no insert policy at all. That
-- is the one-directional rule from the spec, held in the database rather than
-- in a screen: there is no request a traveler's client can make that puts a
-- row in here, whatever the UI does.
drop policy if exists otdd_insert on public.organized_trip_delivered_documents;
create policy otdd_insert on public.organized_trip_delivered_documents
  for insert to authenticated
  with check (
    public.trip_staff_can(trip_id, 'trip.edit')
    and uploaded_by = auth.uid()
  );

drop policy if exists otdd_update on public.organized_trip_delivered_documents;
create policy otdd_update on public.organized_trip_delivered_documents
  for update to authenticated
  using      (public.trip_staff_can(trip_id, 'trip.edit'))
  with check (public.trip_staff_can(trip_id, 'trip.edit'));

-- No delete policy, deliberately. Withdrawing is an update; removing the row
-- outright would erase the fact that a document was ever handed over.

-- ══════════════════════════════════════════════════════════════════
-- Storage
-- ══════════════════════════════════════════════════════════════════

-- Reuses the existing documents bucket under a `delivered/` prefix. The bucket
-- is private and its policies are path-based, so the prefix is what separates
-- these from traveler uploads — see 20260807000100 section 4 for why forgetting
-- storage while getting the table right is the classic hole here.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'group-trip-documents') then

    drop policy if exists otdd_storage_read on storage.objects;
    create policy otdd_storage_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'group-trip-documents'
        and (storage.foldername(name))[1] = 'delivered'
        and exists (
          select 1 from public.organized_trip_delivered_documents d
           where d.storage_path = storage.objects.name
             and (
               public.trip_staff_can(d.trip_id, 'roster.view')
               or (
                 public.is_trip_participant(d.trip_id)
                 and d.withdrawn_at is null
                 and (d.recipient_id is null or d.recipient_id = auth.uid())
               )
             )
        )
      );

    drop policy if exists otdd_storage_write on storage.objects;
    create policy otdd_storage_write on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'group-trip-documents'
        and (storage.foldername(name))[1] = 'delivered'
        -- The trip id is the second path segment: delivered/<trip_id>/<file>.
        -- Checked here so a file cannot be parked in the bucket before its row
        -- exists, which is the window a traveler could otherwise read through.
        and public.trip_staff_can(
              ((storage.foldername(name))[2])::uuid, 'trip.edit')
      );

  end if;
end $$;
