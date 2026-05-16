-- Richer commitment flow on group_trip_participants.
--
-- The previous `committed` boolean was a self-toggle. The new model is an
-- admin-approved request: member submits details (items + optional note) →
-- request goes pending → host approves → status flips to 'approved' and the
-- `committed` boolean is kept in sync for any existing consumers.
--
-- Member can re-submit anytime, which moves status back to 'pending' until a
-- host approves again. Audit history lives in group_trip_commitment_requests.

alter table public.group_trip_participants
  add column if not exists commitment_status text not null default 'none',
  add column if not exists commitment_items jsonb not null default '[]'::jsonb,
  add column if not exists commitment_note text,
  add column if not exists commitment_requested_at timestamptz,
  add column if not exists commitment_decided_at timestamptz,
  add column if not exists commitment_decided_by uuid references auth.users(id) on delete set null;

alter table public.group_trip_participants
  drop constraint if exists group_trip_participants_commitment_status_check;

alter table public.group_trip_participants
  add constraint group_trip_participants_commitment_status_check
  check (commitment_status in ('none', 'pending', 'approved'));

-- Keep `committed` (legacy boolean) in sync with the new status. Approved
-- members are committed; anything else is not. We update via trigger rather
-- than a generated column so legacy callers writing `committed` directly
-- still work during the transition (their write loses to the trigger only
-- when commitment_status is also being set in the same UPDATE).
create or replace function public._sync_group_trip_participant_committed()
returns trigger
language plpgsql
as $$
begin
  if new.commitment_status is distinct from old.commitment_status then
    new.committed := (new.commitment_status = 'approved');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_group_trip_participant_committed
  on public.group_trip_participants;

create trigger trg_sync_group_trip_participant_committed
  before update on public.group_trip_participants
  for each row
  execute function public._sync_group_trip_participant_committed();

-- Index for the host's "who's pending?" lookups.
create index if not exists idx_group_trip_participants_pending_commitment
  on public.group_trip_participants (trip_id)
  where commitment_status = 'pending';

comment on column public.group_trip_participants.commitment_status is
  'Commitment lifecycle: none (default) | pending (member submitted, awaiting host) | approved (host approved).';
comment on column public.group_trip_participants.commitment_items is
  'Array of selected commitment categories, e.g. ["flight_booked", "insurance_sorted", "something_else"].';
comment on column public.group_trip_participants.commitment_note is
  'Optional free-text note the member added when submitting their commitment.';
