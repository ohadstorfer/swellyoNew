-- Remaining Flow A fields that previously lived only in wizard state.
-- Additive, nullable, no RLS change. surf_style is also collected by Flow B.
-- visibility (public|friends|private) is stored but not yet enforced in queries.

alter table public.group_trips
  add column if not exists surf_style text,
  add column if not exists accommodation_status text, -- 'booked' | 'notyet'
  add column if not exists visibility text default 'public'; -- 'public' | 'friends' | 'private'
