-- Add client_id column for idempotent message sends (offline outbox).
-- The client generates a UUID before sending. Retries that land on the server
-- a second time collide on the unique constraint below and are absorbed as
-- no-ops via ON CONFLICT DO NOTHING, so duplicate rows cannot be created on
-- flaky networks.
--
-- Constraint design note: we use a PLAIN unique constraint (not a partial
-- unique index with WHERE client_id IS NOT NULL). Partial indexes work for
-- Postgres ON CONFLICT inference only when the INSERT passes a matching WHERE
-- predicate, which supabase-js/PostgREST's .upsert() does not emit. A plain
-- unique constraint works here because Postgres treats NULL as distinct in
-- uniqueness, so legacy rows with NULL client_id are unconstrained while new
-- rows with non-null client_id stay unique per sender.

alter table public.messages
  add column if not exists client_id uuid;

-- If a prior version of this migration shipped a partial unique index, drop
-- it — the constraint below replaces it and Supabase's .upsert() can only
-- infer through a regular unique constraint.
drop index if exists public.messages_sender_client_id_idx;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_sender_client_id_key'
  ) then
    alter table public.messages
      add constraint messages_sender_client_id_key unique (sender_id, client_id);
  end if;
end $$;

comment on column public.messages.client_id is
  'Client-generated UUID for idempotent sends. Paired with unique constraint messages_sender_client_id_key to absorb retries as no-ops via ON CONFLICT DO NOTHING.';

comment on constraint messages_sender_client_id_key on public.messages is
  'Idempotency key for outbox sends. See messages.client_id column comment.';
