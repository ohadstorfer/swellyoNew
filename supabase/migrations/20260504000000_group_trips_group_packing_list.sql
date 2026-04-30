-- Group packing list (admin-edited, shared) + per-item claims (who's bringing what)
-- group_packing_list on the trip is the master list (admin-only edits).
--   Shape: [{ name: text, single: boolean }]
-- Claims live in their own table to allow multi-user claims, JOINs to surfers
-- for avatar/name display, and per-row RLS.

alter table public.group_trips
  add column if not exists group_packing_list jsonb not null default '[]'::jsonb;

create table if not exists public.group_trip_group_packing_claims (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,
  item_name text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (trip_id, item_name, user_id)
);

create index if not exists group_packing_claims_trip_idx
  on public.group_trip_group_packing_claims(trip_id);
create index if not exists group_packing_claims_trip_item_idx
  on public.group_trip_group_packing_claims(trip_id, item_name);

alter table public.group_trip_group_packing_claims enable row level security;

drop policy if exists "group_packing_claims_read" on public.group_trip_group_packing_claims;
create policy "group_packing_claims_read"
  on public.group_trip_group_packing_claims for select
  to authenticated using (true);

drop policy if exists "group_packing_claims_insert_self_participant" on public.group_trip_group_packing_claims;
create policy "group_packing_claims_insert_self_participant"
  on public.group_trip_group_packing_claims for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.group_trip_participants p
       where p.trip_id = group_trip_group_packing_claims.trip_id
         and p.user_id = auth.uid()
    )
  );

drop policy if exists "group_packing_claims_delete_self" on public.group_trip_group_packing_claims;
create policy "group_packing_claims_delete_self"
  on public.group_trip_group_packing_claims for delete
  to authenticated
  using (auth.uid() = user_id);

-- Enforce single-claim items: if the item is single in the trip's master list
-- and a claim already exists, reject the insert. Avoids race conditions.
create or replace function public.enforce_group_packing_single_claim()
returns trigger
language plpgsql
as $$
declare
  is_single boolean := false;
  existing_claims integer := 0;
begin
  select coalesce((
    select (i->>'single')::boolean
      from public.group_trips t,
           jsonb_array_elements(t.group_packing_list) as i
     where t.id = new.trip_id
       and i->>'name' = new.item_name
     limit 1
  ), false)
  into is_single;

  if is_single then
    select count(*)
      into existing_claims
      from public.group_trip_group_packing_claims
     where trip_id = new.trip_id
       and item_name = new.item_name;
    if existing_claims > 0 then
      raise exception 'Item % is single-claim and already taken', new.item_name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_group_packing_single_claim on public.group_trip_group_packing_claims;
create trigger trg_enforce_group_packing_single_claim
  before insert on public.group_trip_group_packing_claims
  for each row execute function public.enforce_group_packing_single_claim();

-- When the master list changes, drop any claims pointing to items that were
-- removed/renamed. Items still present keep their claims.
create or replace function public.prune_group_packing_claims_on_list_change()
returns trigger
language plpgsql
as $$
begin
  if new.group_packing_list is distinct from old.group_packing_list then
    delete from public.group_trip_group_packing_claims c
     where c.trip_id = new.id
       and not exists (
         select 1
           from jsonb_array_elements(new.group_packing_list) as i
          where i->>'name' = c.item_name
       );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prune_group_packing_claims on public.group_trips;
create trigger trg_prune_group_packing_claims
  after update on public.group_trips
  for each row execute function public.prune_group_packing_claims_on_list_change();
