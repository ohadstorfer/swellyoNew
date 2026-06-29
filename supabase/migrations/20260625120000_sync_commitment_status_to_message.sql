-- Commitment status "flash" on chat open.
--
-- approve/decline writes the new status back onto the original chat message's
-- commitment_metadata (groupTripsService step 3), but messages-table RLS only
-- lets the *sender* update their row. The host (a non-sender) is silently
-- filtered out, so the message row keeps the old status forever. Every fresh
-- server fetch therefore returns the stale status, and the bubble flashes the
-- wrong state on open before the client-side hydration patch corrects it.
--
-- Fix at the source: extend the existing SECURITY DEFINER trigger on the request
-- table (which already does the privileged participant write) to also patch the
-- linked message's commitment_metadata.status. Definer rights bypass the RLS
-- block. The pre-existing AFTER UPDATE broadcast trigger on messages then pushes
-- the corrected status to any open chat live. (send-push is INSERT-only, so this
-- update fires no notification.)

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

    -- Mirror the new status onto the linked chat message so every client reads
    -- the truth straight from the row (kills the open-chat status flash).
    if new.message_id is not null then
      update public.messages m
      set commitment_metadata = jsonb_set(
            coalesce(m.commitment_metadata, '{}'::jsonb),
            '{status}',
            to_jsonb(new.status::text),
            true
          )
      where m.id = new.message_id
        and coalesce(m.commitment_metadata->>'status', '') is distinct from new.status::text;
    end if;
  end if;
  return new;
end;
$$;

-- Definer fn on a public table: keep it off the PostgREST surface.
revoke execute on function public._sync_commitment_request_to_participant() from public, anon, authenticated;

-- Trigger already exists (20260623000000); CREATE OR REPLACE above is enough.

-- One-time backfill: fix messages whose stored status drifted from the request
-- table before this trigger patched messages. Fires the broadcast trigger per
-- row (harmless); send-push is INSERT-only so no notifications go out.
update public.messages m
set commitment_metadata = jsonb_set(
      coalesce(m.commitment_metadata, '{}'::jsonb),
      '{status}',
      to_jsonb(r.status::text),
      true
    )
from public.group_trip_commitment_requests r
where r.message_id = m.id
  and r.status is not null
  and coalesce(m.commitment_metadata->>'status', '') is distinct from r.status::text;
