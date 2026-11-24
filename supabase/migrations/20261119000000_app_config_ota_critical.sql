-- Remote app config, readable anonymously. First key: ota_critical.
--
-- ota_critical: the app compares it with CRITICAL_INDEX (src/ota/criticalIndex.ts).
-- Server value higher → a critical OTA exists → the launch waits for it.
-- Only raise it AFTER the OTA with the matching CRITICAL_INDEX is published
-- for both platforms. See docs/OTA_CRITICAL_UPDATES.md.
--
-- Writes: service role / SQL editor only (no insert/update/delete policies).

create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists "app_config readable by everyone" on public.app_config;
create policy "app_config readable by everyone"
  on public.app_config
  for select
  to anon, authenticated
  using (true);

revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

insert into public.app_config (key, value)
values ('ota_critical', '0'::jsonb)
on conflict (key) do nothing;
