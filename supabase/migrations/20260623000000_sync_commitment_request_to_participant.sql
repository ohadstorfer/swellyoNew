-- Commitment approve/decline ran as the host, but RLS on
-- group_trip_participants only allows a user to UPDATE their OWN row
-- ("group_trip_participants user updates self": auth.uid() = user_id). So the
-- host's client-side update of the *member's* participant row was silently
-- filtered out (0 rows, no error) — commitment_status never flipped, the
-- existing _sync_group_trip_participant_committed trigger never set
-- `committed`, and the trip's "Committed to trip" stayed 0/N.
--
-- Mirror the join-request pattern: the host is allowed to UPDATE the
-- commitment *request* row (policy "gtcr update host or self supersede"), so do
-- the privileged participant write from a SECURITY DEFINER trigger on the
-- request table instead of from the client. The participant's `committed`
-- boolean is then flipped by the pre-existing
-- _sync_group_trip_participant_committed trigger.

create or replace function public._sync_commitment_request_to_participant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only when the host's decision actually changes the request status.
  if new.status is distinct from old.status then
    update public.group_trip_participants p
    set commitment_status = case
          when new.status = 'approved' then 'approved'
          when new.status = 'declined' then 'none'   -- declined → can re-submit
          when new.status = 'pending'  then 'pending'
          else p.commitment_status
        end,
        commitment_decided_at = coalesce(new.decided_at, now()),
        commitment_decided_by = new.decided_by
    where p.trip_id = new.trip_id
      and p.user_id = new.user_id;
  end if;
  return new;
end;
$$;

-- Definer fn on a public table: keep it off the PostgREST surface.
revoke execute on function public._sync_commitment_request_to_participant() from public, anon, authenticated;

drop trigger if exists trg_sync_commitment_request_to_participant
  on public.group_trip_commitment_requests;

create trigger trg_sync_commitment_request_to_participant
  after update on public.group_trip_commitment_requests
  for each row
  execute function public._sync_commitment_request_to_participant();
