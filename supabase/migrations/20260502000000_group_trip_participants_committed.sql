-- Trip commitment: each participant (host included) can self-mark as committed.
-- Surfaced as a small badge on their avatar in the trip detail screen so others
-- can see who's actually in vs. just curious.

alter table public.group_trip_participants
  add column if not exists committed boolean not null default false;

drop policy if exists "group_trip_participants user updates self" on public.group_trip_participants;
create policy "group_trip_participants user updates self"
  on public.group_trip_participants for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
