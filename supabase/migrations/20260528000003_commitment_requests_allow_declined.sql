-- Allow the host to decline a pending commitment request.
-- The audit log gains a 'declined' terminal status alongside 'approved' and 'superseded'.
-- The participant row falls back to commitment_status='none' on decline so the
-- member can re-submit later — only the audit row records the decision.

alter table public.group_trip_commitment_requests
  drop constraint if exists group_trip_commitment_requests_status_check;

alter table public.group_trip_commitment_requests
  add constraint group_trip_commitment_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'superseded'));
