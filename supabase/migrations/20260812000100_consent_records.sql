-- Consent records — the two ticks we currently take and never keep.
--
-- Phase 4c + 4d of docs/specs/operator-trips/refunds-and-merchant-of-record.md.
--
-- Both tables copy the WAIVER's shape (`group_trip_acknowledgements` +
-- `operator_requirement_acknowledge`), on purpose. That is the one part of this
-- codebase that already records consent defensibly: a versioned document, a
-- SHA-256 of the exact bytes agreed to, and an IP + user-agent captured
-- SERVER-SIDE from `request.headers` rather than trusted from the client. A
-- second pattern would mean two things to keep defensible instead of one.
--
-- ⚠️ EVERY WRITE GOES THROUGH A SECURITY DEFINER RPC. Neither table grants
-- INSERT to `authenticated`. A client-side insert could forge its own IP and
-- user-agent, which is the only reason those columns are worth having.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent: safe to re-run.


-- ═══════════════════════════════════════════════════════════════════════════
-- A. Swellyo's own Terms of Service — the signup tick
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Today `WelcomeScreen.tsx` writes `agreedToTerms` to AsyncStorage and nothing
-- else. A reinstall erases the only proof we have that anybody agreed to
-- anything, and there is no version, so "did they accept the CURRENT terms?"
-- has never been answerable.
--
-- A LEDGER, NOT TWO COLUMNS ON `surfers`. `agreements-and-terms.md` §8
-- proposed `surfers.terms_accepted_at` + `terms_version`, which is what
-- `operator_settings` does for the operator agreement. Rejected here: two
-- columns can hold ONE acceptance, and the question this data exists to answer
-- is "which versions has this person accepted, from where, and when" — the
-- history IS the evidence. A column would also need a sync path and could then
-- drift from the row that proves it.
--
-- WHY `document_hash` IS NULLABLE AND EMPTY FOR NOW. The terms live at a URL
-- (swellyo.com/terms-and-conditions) and are not versioned bytes we hold, so
-- there is nothing to hash yet. The column exists so that the day the lawyer's
-- text is published as a versioned document (Phase 4b), hashing it is a
-- one-line change and not a migration on a table with history in it.
create table if not exists public.user_terms_acceptances (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  -- Room for the privacy policy or a future traveler agreement without a
  -- second table. CHECKed rather than free text so a typo cannot create a
  -- silent third category nothing queries.
  document           text not null default 'platform_terms'
                     check (document in ('platform_terms')),
  version            text not null,
  document_url       text,
  document_hash      text,
  ip_address         text,
  user_agent         text,
  consent_electronic boolean not null default true,
  -- When the box was ticked ON THE DEVICE. Client-claimed and clamped to
  -- now() by the RPC: the tick happens BEFORE sign-in, so the server cannot
  -- witness it. Kept separate from `recorded_at` rather than blended into one
  -- "timestamp" that would quietly mix a witnessed fact with a claimed one.
  agreed_at          timestamptz,
  -- When the server received it. This one we can stand behind.
  recorded_at        timestamptz not null default now()
);

-- One row per user per version. Re-opening the app must not add a second
-- identical acceptance, and the RPC's ON CONFLICT relies on this index.
create unique index if not exists uq_user_terms_user_doc_version
  on public.user_terms_acceptances (user_id, document, version);

alter table public.user_terms_acceptances enable row level security;
revoke all on public.user_terms_acceptances from anon, authenticated;
grant select on public.user_terms_acceptances to authenticated;

drop policy if exists user_terms_select_own on public.user_terms_acceptances;
create policy user_terms_select_own on public.user_terms_acceptances
for select to authenticated
using (user_id = (select auth.uid()));

comment on table public.user_terms_acceptances is
  'Append-only record of a user accepting Swellyo''s terms. Written only by '
  'record_terms_acceptance(), which captures IP and user-agent server-side.';


create or replace function public.record_terms_acceptance(
  p_version      text,
  p_document_url text        default null,
  p_agreed_at    timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_headers json;
  v_ip      text;
  v_ua      text;
  v_version text := nullif(trim(p_version), '');
  v_id      uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  -- An acceptance with no version cannot answer the only question it is ever
  -- asked, so it is refused rather than stored as a row that looks like proof.
  if v_version is null then raise exception 'a terms version is required'; end if;

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ip := coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip');
  v_ua := v_headers ->> 'user-agent';

  insert into public.user_terms_acceptances
    (user_id, document, version, document_url, ip_address, user_agent,
     consent_electronic, agreed_at)
  values
    (v_uid, 'platform_terms', v_version, p_document_url, v_ip, v_ua, true,
     -- A device clock set to next year must not date the acceptance into the
     -- future. Earlier than now() is kept as-is: it is the honest claim.
     --
     -- ⚠️ NOT `least(coalesce(p_agreed_at, now()), now())`. NULL means the
     -- caller does not KNOW when the tick happened, and must stay NULL —
     -- `recorded_at` is then the only date, which is the truth. Postgres'
     -- LEAST also silently IGNORES NULL inputs, so `least(null, now())`
     -- returns now() and would have turned "unknown" into "just now" without
     -- anyone noticing. Same trap `operator_traveler_amount_due` documents
     -- for GREATEST.
     case when p_agreed_at is null then null else least(p_agreed_at, now()) end)
  on conflict (user_id, document, version) do nothing
  returning id into v_id;

  -- ON CONFLICT DO NOTHING returns no row, so the second call for the same
  -- version lands here. Idempotent by design: the client calls this on every
  -- boot until it succeeds once.
  if v_id is null then
    select a.id into v_id
      from public.user_terms_acceptances a
     where a.user_id = v_uid and a.document = 'platform_terms' and a.version = v_version;
  end if;

  return v_id;
end $$;

revoke execute on function public.record_terms_acceptance(text, text, timestamptz)
  from public, anon;
grant  execute on function public.record_terms_acceptance(text, text, timestamptz)
  to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- B. The per-trip cancellation policy — the tick before checkout
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS IS OURS AND NOT STRIPE'S. Stripe Checkout offers
-- `consent_collection[terms_of_service]`, which records consent on the session
-- — but it can only point at ONE global terms URL set in the Dashboard. It
-- cannot show the policy frozen on THIS trip, which is the thing being agreed
-- to. `custom_text[submit][message]` (already live) DISPLAYS the policy and
-- records nothing. So the evidence that a traveler was shown these exact terms
-- and accepted them has to be collected before the session exists, by us.
--
-- WHY A NEW TABLE AND NOT `group_trip_acknowledgements`. That table is keyed to
-- a REQUIREMENT (`requirement_id` not null) — a waiver or a form the operator
-- added to the trip. A cancellation policy is not a requirement; it is a term
-- of sale attached to a payment, and every trip has one whether or not the
-- operator built a checklist.
create table if not exists public.organized_trip_policy_consents (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references public.group_trips(id) on delete cascade,
  user_id            uuid not null references auth.users(id)         on delete cascade,
  -- The frozen policy as the SERVER read it at consent time — preset, rules,
  -- notes. Copied, not referenced: a reference would let a later edit of the
  -- trip rewrite what somebody agreed to, which is the exact failure the
  -- freeze-at-publish rule exists to prevent.
  policy_snapshot    jsonb not null,
  -- The words that were on the screen. `policy_snapshot` says what the data
  -- was; this says what the human READ, and they are not the same claim.
  shown_text         text not null,
  -- SHA-256 of `shown_text`, computed server-side by the RPC. The client never
  -- supplies it — a hash you accept from the party you may later be arguing
  -- with proves nothing.
  document_hash      text not null,
  ip_address         text,
  user_agent         text,
  consent_electronic boolean not null default true,
  created_at         timestamptz not null default now()
);

create index if not exists idx_policy_consents_trip_user
  on public.organized_trip_policy_consents (trip_id, user_id, created_at desc);

-- DELIBERATELY NOT UNIQUE on (trip_id, user_id). Append-only: if the policy
-- text ever changes the traveler is asked again, and both ticks are evidence.
-- The client only asks when no consent matches the CURRENT policy, so this
-- does not grow per payment.

alter table public.organized_trip_policy_consents enable row level security;
revoke all on public.organized_trip_policy_consents from anon, authenticated;
grant select on public.organized_trip_policy_consents to authenticated;

drop policy if exists policy_consents_select_own on public.organized_trip_policy_consents;
create policy policy_consents_select_own on public.organized_trip_policy_consents
for select to authenticated
using (user_id = (select auth.uid()));

-- The operator and staff who can see payment status. `payments.view_status`,
-- the same capability that opens the refund history — this row is what they
-- would hand over to fight a chargeback, so it belongs to the same audience.
drop policy if exists policy_consents_select_staff on public.organized_trip_policy_consents;
create policy policy_consents_select_staff on public.organized_trip_policy_consents
for select to authenticated
using (public.trip_staff_can(trip_id, 'payments.view_status'));

comment on table public.organized_trip_policy_consents is
  'A traveler accepting the cancellation policy frozen on a trip, taken before '
  'the Stripe Checkout session is created. Written only by '
  'record_trip_policy_consent(). This is the chargeback evidence.';


create or replace function public.record_trip_policy_consent(
  p_trip_id    uuid,
  p_shown_text text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_trip    record;
  v_headers json;
  v_ip      text;
  v_ua      text;
  v_text    text := nullif(trim(p_shown_text), '');
  v_id      uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if v_text is null then raise exception 'nothing was shown to consent to'; end if;
  -- Status-agnostic on purpose: the deposit is paid DURING onboarding, before
  -- the participant row is active. Requiring 'active' would refuse consent on
  -- the one payment this most needs to cover.
  if not public.is_trip_participant(p_trip_id) then
    raise exception 'not on this trip';
  end if;

  select t.cancellation_preset, t.cancellation_rules, t.cancellation_notes
    into v_trip
    from public.group_trips t
   where t.id = p_trip_id;

  -- `not found`, NOT `v_trip is null`. A record variable tests as NULL when
  -- EVERY field is null, so the obvious version would report a real trip whose
  -- three cancellation columns happen to be empty as "trip not found". It is
  -- only saved today by `cancellation_rules` carrying a NOT NULL default.
  if not found then raise exception 'trip not found'; end if;
  -- NULL preset is "not specified", not "no refunds" — there is nothing to
  -- agree to, and storing a consent to an empty policy would be a row that
  -- reads like proof of terms that never existed.
  if v_trip.cancellation_preset is null then
    raise exception 'this trip has no cancellation policy';
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ip := coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip');
  v_ua := v_headers ->> 'user-agent';

  insert into public.organized_trip_policy_consents
    (trip_id, user_id, policy_snapshot, shown_text, document_hash,
     ip_address, user_agent, consent_electronic)
  values
    (p_trip_id, v_uid,
     jsonb_build_object(
       'preset', v_trip.cancellation_preset,
       'rules',  coalesce(v_trip.cancellation_rules, '[]'::jsonb),
       'notes',  v_trip.cancellation_notes
     ),
     v_text,
     encode(digest(v_text, 'sha256'), 'hex'),
     v_ip, v_ua, true)
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.record_trip_policy_consent(uuid, text) from public, anon;
grant  execute on function public.record_trip_policy_consent(uuid, text) to authenticated;
