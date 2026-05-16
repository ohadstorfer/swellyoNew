-- Track when the requester saw the host's decision (approved/declined) so we
-- can show the "You're in!" / "Not a match this time" overlay exactly once,
-- on the first app open after the decision.
--
-- Why an RPC and not just an UPDATE: the existing RLS policy
--   "join_requests requester can withdraw"
-- restricts requester UPDATEs to status='withdrawn'. Loosening that policy is
-- a security bug — a requester could set status='approved' on their own row,
-- and the approval trigger would auto-add them as a participant.
--
-- A SECURITY DEFINER RPC narrows the surface to exactly the seen_decision_at
-- update and enforces ownership inside the function.

alter table public.group_trip_join_requests
  add column if not exists seen_decision_at timestamptz;

comment on column public.group_trip_join_requests.seen_decision_at is
  'Set when the requester closes the post-decision overlay. NULL = decision not yet surfaced to the user.';

-- Partial index for the AppContent boot query: "find this user''s unseen
-- decisions." Skips rows that are pending/withdrawn (decision not relevant)
-- and rows already seen.
create index if not exists idx_join_requests_unseen_decision
  on public.group_trip_join_requests (requester_id)
  where status in ('approved', 'declined') and seen_decision_at is null;

create or replace function public.mark_join_decision_seen(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.group_trip_join_requests
     set seen_decision_at = now()
   where id = p_request_id
     and requester_id = auth.uid()
     and status in ('approved', 'declined')
     and seen_decision_at is null;
end;
$$;

grant execute on function public.mark_join_decision_seen(uuid) to authenticated;

comment on function public.mark_join_decision_seen(uuid) is
  'Requester-only RPC that flips seen_decision_at to now(). No-op for unauthorized callers, non-decision rows, or rows already seen.';
