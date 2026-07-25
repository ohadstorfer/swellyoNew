-- Operator Trips — waiver legal-record fields.
--
-- Adds the audit-trail fields an electronic waiver needs to be defensible.
-- See docs/specs/operator-trips/waiver-legal-record.md. All columns are
-- nullable and additive — the tables are empty and no client code writes them
-- yet. Not legal advice; jurisdiction + retention still need a lawyer.

-- ── 1. Audit fields on the signature row.
alter table public.group_trip_acknowledgements
  add column if not exists ip_address         text,     -- x-forwarded-for at agree time (chain kept as-is)
  add column if not exists user_agent         text,     -- device/browser/OS that agreed
  add column if not exists consent_electronic boolean;   -- agreed to sign electronically

-- ── 2. Tamper-evidence hash on the exact version signed.
--   We already keep the bytes append-only; the hash is belt-and-suspenders.
--   Text waivers are hashed server-side by the trigger below. PDF waivers
--   (storage_path only) carry a hash supplied by the client at insert.
alter table public.organized_trip_operator_documents
  add column if not exists document_hash text;

create or replace function public.set_operator_document_hash()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  if new.document_hash is null and new.body_text is not null then
    new.document_hash := encode(digest(new.body_text, 'sha256'), 'hex');
  end if;
  return new;
end $$;

revoke execute on function public.set_operator_document_hash() from public, anon, authenticated;

drop trigger if exists trg_set_operator_document_hash on public.organized_trip_operator_documents;
create trigger trg_set_operator_document_hash
  before insert on public.organized_trip_operator_documents
  for each row execute function public.set_operator_document_hash();

-- ── 3. Capture IP + user-agent SERVER-SIDE in the acknowledge RPC.
--   Reading them from request.headers (set by PostgREST) is more trustworthy
--   than trusting client-passed values — the client cannot forge them here.
--   When called outside PostgREST (e.g. a SQL console) request.headers is unset
--   and these resolve to null, which is fine.
create or replace function public.operator_requirement_acknowledge(
  p_requirement_id uuid,
  p_full_name      text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r        record;
  v_doc    record;
  v_id     uuid;
  v_headers json;
  v_ip     text;
  v_ua     text;
begin
  select * into r from public.organized_trip_requirements where id = p_requirement_id;
  if r is null then raise exception 'requirement not found'; end if;
  if r.req_type <> 'acknowledge' then
    raise exception 'requirement % is not an acknowledge item', p_requirement_id;
  end if;
  if not public.is_trip_participant(r.trip_id) then
    raise exception 'not on this trip';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'a name is required';
  end if;

  if r.kind = 'waiver' then
    select od.* into v_doc
      from public.organized_trip_operator_documents od
     where od.trip_id = r.trip_id and od.kind = 'waiver'
     order by od.version desc limit 1;
    if v_doc is null then raise exception 'no waiver has been published yet'; end if;
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ip := coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip');
  v_ua := v_headers ->> 'user-agent';

  insert into public.group_trip_acknowledgements
    (requirement_id, trip_id, user_id, agreed_name, operator_document_id, agreed_version,
     ip_address, user_agent, consent_electronic)
  values
    (r.id, r.trip_id, auth.uid(), trim(p_full_name), v_doc.id, v_doc.version,
     v_ip, v_ua, true)  -- consent_electronic: they used the e-flow and tapped agree.
                        -- Split into an explicit disclosure step if the lawyer wants it.
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.operator_requirement_acknowledge(uuid, text) from public, anon;
grant  execute on function public.operator_requirement_acknowledge(uuid, text) to authenticated;
