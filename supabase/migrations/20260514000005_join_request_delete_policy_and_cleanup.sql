-- Allow the host or the requester to delete their join_request row.
--
-- Why: when a host removes a participant (or a member self-leaves), we want to
-- drop the corresponding join_request row so a future "Request to join" can
-- succeed. Without a DELETE policy, the table-level RLS blocks all client
-- deletes (PostgreSQL default for RLS-enabled tables without a matching
-- policy). Today the table only has INSERT/SELECT/UPDATE policies.
--
-- The policy is symmetric to the existing SELECT policy: requester or trip
-- host can act on the row.

drop policy if exists "join_requests host or requester can delete"
  on public.group_trip_join_requests;

create policy "join_requests host or requester can delete"
  on public.group_trip_join_requests for delete
  to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = (select host_id from public.group_trips where id = trip_id)
  );

-- One-time cleanup of approved-but-orphaned rows. Anyone whose request says
-- "approved" but who is no longer in group_trip_participants was either
-- removed by the host (pre-fix) or left (pre-fix) and got stranded. Deleting
-- the row lets them re-request. Safe — only touches rows where the user is
-- demonstrably no longer a participant.
delete from public.group_trip_join_requests j
 where j.status = 'approved'
   and not exists (
     select 1 from public.group_trip_participants p
      where p.trip_id = j.trip_id
        and p.user_id = j.requester_id
   );
