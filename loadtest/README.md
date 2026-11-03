# Swellyo load-test kit (local copy)

Replays the traffic of the 21 Oct 2026 group test (18 phones, production went
down) against a **local** copy of the database, so we can compare:

| Run | DB size | RLS policies | App traffic (`MIX`) | Expect |
|-----|---------|--------------|---------------------|--------|
| **A** | Nano 0.5 GB | old (`auth.uid()` per row) | `before` | should look like 21 Oct: slow, then timeouts |
| **B** | Micro 1 GB | new (`(select auth.uid())`) | `before` | the DB fixes alone |
| **C** | Micro 1 GB | new | `after` | today: DB fixes + the 21 Oct OTA |

Background: [docs/load-test-slowness-2026-10-21.md](../docs/load-test-slowness-2026-10-21.md).

## Safety rules

- Everything runs on your Mac, in Docker. **Nothing here talks to production**
  except one read-only step: `supabase db dump` (copies the table definitions,
  no rows).
- `scenario.js` refuses any `BASE_URL` that is not `127.0.0.1` / `localhost`.
- `seed.sql` refuses a DB that has real users in it.
- The production schema dump contains 3 webhook triggers with the production
  URL and a secret header. `prepare-schema.sh` strips them and
  `local-fixups.sql` stops if any production URL is left. Keep the dump in
  `/tmp/swellyo-loadtest/`, **never in the repo** (the repo is public).
- Never run `supabase start`, `db reset` or `db push` in the repo root. The
  repo's `supabase/migrations` folder is incomplete. Always use the throwaway
  folder `/tmp/swellyo-loadtest`.

## Files

| File | What it does |
|------|--------------|
| `scenario.js` | k6 script. One VU = one phone. Steps 20 → 50 → 100 VUs. |
| `seed.sql` | Fake data: 160 users, 6 trips × 20 members, chats, ~2,500 messages, operator data, notifications. |
| `local-fixups.sql` | Drops webhooks + cron jobs, adds Realtime policies + role timeouts, checks no prod URL is left. |
| `export-fixtures.sql` | Prints each fake user's trip / chat / trip-mate ids as JSON. |
| `mint-tokens.js` | Signs 2-hour local tokens for the fake users → `tokens.json`. |
| `prepare-schema.sh` | Cleans the production schema dump for local use. |
| `load.sh` | Loads schema + fix-ups + seed, writes `fixtures.json`. |
| `limit-db.sh` | Limits the DB container to Nano or Micro and sets production Postgres settings. |
| `lib.sh` | Small shared helpers. |
| `realtime-footprint.js` | Older, separate script (Realtime sockets). Not part of this kit. |

`tokens.json`, `fixtures.json` and `results/` are git-ignored.

## One-time setup

### 1. Docker Desktop

Install Docker Desktop for Mac (Apple silicon) and start it. In
**Settings → Resources** give it at least 4 CPUs, 6 GB memory and 1 GB swap
(swap matters: production swapped ~900 MB during the outage).

### 2. k6

Download `k6-v1.8.1-macos-arm64.zip` from the k6 GitHub releases page
(github.com/grafana/k6/releases, tag v1.8.1), unzip it, and copy the `k6`
binary onto your PATH (`~/.local/bin` already is - the Supabase CLI lives there):

```bash
cp <unzipped folder>/k6 ~/.local/bin/
k6 version   # k6 v1.8.1 ...
```

(A checked copy was also unzipped in the Claude session that made this kit;
its path is in that chat, not here.)

### 3. Throwaway Supabase project

```bash
mkdir -p /tmp/swellyo-loadtest && cd /tmp/swellyo-loadtest
supabase init
```

Edit `/tmp/swellyo-loadtest/supabase/config.toml`:

- `project_id = "swellyo-loadtest"`
- under `[db]`: `major_version = 17` (production is Postgres 17.6)
- under `[api]`: `max_rows = 1000` (Supabase default)

### 4. Copy the production schema (read-only)

`supabase db dump` runs `pg_dump` in Docker, so Docker must be running.
It reads table/function/policy definitions only, no rows.

Get the connection string: Dashboard → **Connect** → **Session pooler**.
Put your DB password in it (percent-encode special characters). Do not save
it in any file.

```bash
cd /tmp/swellyo-loadtest
supabase db dump --db-url 'postgresql://postgres.rfdhtvcmagsbxqntnepv:<PASSWORD>@<pooler-host>:5432/postgres' \
  -f /tmp/swellyo-loadtest/schema.sql
```

(Alternative: `supabase login` with the Swellyo account, then
`supabase link --project-ref rfdhtvcmagsbxqntnepv` and `supabase db dump -f schema.sql`
inside `/tmp/swellyo-loadtest`, then `supabase unlink`. Note: the CLI on this
Mac was logged in to a different account before, which gives 403 - the
`--db-url` way avoids that.)

Then, from the **repo root**:

```bash
bash loadtest/prepare-schema.sh      # writes /tmp/swellyo-loadtest/schema.local.sql
rm /tmp/swellyo-loadtest/schema.sql  # optional: it holds production secrets
```

### 5. Start the local stack

```bash
cd /tmp/swellyo-loadtest
supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta
supabase status -o env      # note ANON_KEY and JWT_SECRET (local values)
```

We skip the containers the test does not use. Kong (API gateway), PostgREST,
GoTrue (auth), Realtime and Storage stay on.

### 6. Load schema + fake data, make tokens (repo root)

```bash
bash loadtest/load.sh
export ANON_KEY='<ANON_KEY from supabase status>'
JWT_SECRET='<JWT_SECRET from supabase status>' node loadtest/mint-tokens.js
mkdir -p loadtest/results
```

`load.sh` prints how many errors the schema load had. A few are normal
(`already exists`, hosted-only roles). It stops if a main table is missing.

Quick check that auth and RLS work:

```bash
TOKEN=$(node -e "console.log(require('./loadtest/tokens.json')[1].access_token)")
curl -s http://127.0.0.1:54321/auth/v1/user -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" | head -c 200; echo
curl -s "http://127.0.0.1:54321/rest/v1/group_trips?select=id,title&limit=3" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN"; echo
```

Both should return JSON with fake data, not an error.

## Running the comparison

Before **every** run:

1. `bash loadtest/load.sh --seed-only` - resets the fake data (removes rows the last run wrote).
2. Set the RLS version you want (below).
3. `bash loadtest/limit-db.sh nano|micro` - sets the size **and restarts the DB**, so every run starts with a cold cache.
4. If the tokens are older than ~1.5 hours, run `mint-tokens.js` again.

RLS switch (needs `source loadtest/lib.sh` first in that terminal):

```bash
source loadtest/lib.sh
# old RLS (as on 21 Oct):
admin_psql -v ON_ERROR_STOP=1 < supabase/rollbacks/20261021000000_rls_auth_uid_initplan_rollback.sql
# new RLS (as in production now):
admin_psql -v ON_ERROR_STOP=1 < supabase/migrations/20261021000000_rls_auth_uid_initplan.sql
```

The dump comes with the **new** RLS. Each file refuses to run twice in a row,
so a "nothing to do / already" error just means you are already on that version.

### Run A - reproduce 21 Oct

```bash
bash loadtest/load.sh --seed-only
source loadtest/lib.sh && admin_psql -v ON_ERROR_STOP=1 < supabase/rollbacks/20261021000000_rls_auth_uid_initplan_rollback.sql
bash loadtest/limit-db.sh nano
k6 run -e ANON_KEY="$ANON_KEY" -e MIX=before -e RUN_LABEL=A loadtest/scenario.js
```

### Run B - DB fixes only

```bash
bash loadtest/load.sh --seed-only
source loadtest/lib.sh && admin_psql -v ON_ERROR_STOP=1 < supabase/migrations/20261021000000_rls_auth_uid_initplan.sql
bash loadtest/limit-db.sh micro
k6 run -e ANON_KEY="$ANON_KEY" -e MIX=before -e RUN_LABEL=B loadtest/scenario.js
```

### Run C - today's reality

```bash
bash loadtest/load.sh --seed-only
bash loadtest/limit-db.sh micro
k6 run -e ANON_KEY="$ANON_KEY" -e MIX=after -e RUN_LABEL=C loadtest/scenario.js
```

Useful options (`-e NAME=value`):

| Option | Default | Use |
|--------|---------|-----|
| `STEPS` | `20,50,100` | `STEPS=18` = exactly the 21 Oct group |
| `HOLD` | `3m` | time at each step |
| `RAMP` | `30s` | time to reach each step |
| `RATE_PER_MIN` | `25` | requests per phone per minute (`before` mix). 21 Oct: 17.4 average, 24.8 while active, ~33 at peak |
| `MAX_BURST` | `6` | most requests one phone sends at once |

Each run takes about `steps × (RAMP + HOLD)` - 11 minutes with the defaults.

## Reading the results

At the end k6 prints two tables and writes `loadtest/results/<RUN_LABEL>.json`.

- **Per step**: requests per second, p50 / p95 / p99 in ms, and `5xx %`
  (server errors + requests with no answer). Compare the same step across
  A, B and C. Healthy: p95 under 1000 ms and 5xx under 1%.
- **Per endpoint**: which requests got slow first. On 21 Oct the first to
  suffer were `conversation_members`, `my_trips_feed` and the
  `HEAD /notifications` bell count.
- The outage looks like: p95 jumps from ~100 ms to several seconds, then
  `5xx %` climbs (PostgREST `PGRST003` = no free DB connection, shows as 504).

While a run is going, in a second terminal:

```bash
docker stats $(docker ps --filter name=supabase_db_ --format '{{.Names}}')
# MEM USAGE close to the LIMIT = memory pressure (what killed production)

C=$(docker ps --filter name=supabase_db_ --format '{{.Names}}')
docker exec $C sh -c 'cat /sys/fs/cgroup/memory.swap.current 2>/dev/null || grep -E "^swap " /sys/fs/cgroup/memory.stat'
# bytes in swap; production reached ~900 MB

source loadtest/lib.sh && admin_psql -c "select state, count(*) from pg_stat_activity group by 1"
docker logs -f $(docker ps --filter name=supabase_rest_ --format '{{.Names}}') 2>&1 | grep -i pgrst003
```

k6 exits with a non-zero code when a threshold is crossed. That is only a
report, the run still finished.

## How the traffic was built

From production `edge_logs` (read-only), 2026-10-21 01:15–01:45 UTC:
18 signed-in users, 9,417 requests to `/rest/v1`, `/auth/v1/user` and
`/realtime/v1/api/broadcast`. Storage/media (~1,600 video/image fetches) and
anonymous traffic are left out. Each endpoint keeps the real query string
shape (select list, filters, order, limit). `scenario.js` lists them with
their real counts; 68 endpoints cover 98% of the traffic (rare writes like
join-request create/delete, staff invites and document uploads are left out).

`MIX=after` assumptions (named constants at the top of `scenario.js`):

- 85% of `GET /auth/v1/user` gone (`getSessionUser()` instead of `getUser()`).
- The "all my memberships" inbox query becomes the scoped one.
- Trip-detail refetches (trip, participants, roster profiles, join requests,
  updates, gear) drop 30% (300 ms coalescing in `useTripRealtime`).
- Same user behaviour, so the request rate per phone drops with the mix (~19% fewer requests).

## Known limits (read before trusting a number)

- **Closed loop.** A phone waits for its burst to finish before it thinks
  again. Real phones keep firing while the server is slow, so a real outage
  is a bit worse than what k6 shows once things slow down.
- **Your Mac is not a t4g.micro.** Its CPU and SSD are much faster than the
  production CPU and network disk. Swap on a Mac SSD hurts far less than on
  production, so Run A may degrade less sharply. Compare A/B/C to each other,
  not to production numbers.
- **Only the DB container is limited.** In production PostgREST, GoTrue and
  the gateway share the same 0.5 / 1 GB machine.
- **PostgREST pool size.** Local PostgREST uses its default pool; production's
  is not visible to us (we saw 13 PostgREST connections at rest).
- **No WebSockets.** Realtime subscriptions are not simulated; only the
  REST broadcast fallback (`/realtime/v1/api/broadcast`) is. Database
  triggers still send Realtime broadcasts locally, as in production.
- **Push and webhooks are off.** Notification rows still go into
  `notification_queue`, but nothing sends them (no cron locally).
- **Data size** is close to production (160 users, ~2,500 messages), not bigger.

## Fake travelers in "El Salvador 26" (production, live group test)

Spec: [AGENTS_TEST_SPEC.md](AGENTS_TEST_SPEC.md). Unlike everything above,
this test **writes to production**: 15 fake travelers ("agents") join the real
trip and chat in its real group chat while Ohad watches on his phone. Nothing is
cleaned up afterwards. **For now Jake and Moshe are kept out:** `setup.sql`
mutes the trip chat for them for 24 hours (undo snippet in its header), the
agents never answer or quote them, and gear requests are off by default
(`GEAR_REQUESTS=1..6` turns them on; each one notifies every trip admin,
co-operators included).

| File | What it does |
|------|--------------|
| `agents/setup.sql` | Run once (SQL editor or MCP). Refuses any trip other than "El Salvador 26". Adds 15 auth users (`agent01..15@loadtest.invalid`, ids `10ad7e57-0000-4000-8000-0000000000NN`), surfers with `is_demo_user = true`, raises `max_participants` to 25, adds them as active members with `trg_member_joined` off (no "X joined" pushes), checks the chat, mutes the chat for Jake and Moshe (`v_muted`). Prints a summary. Safe to run twice. The agent names are one array at the top. |
| `agents/lines.json` | ~190 scripted English lines in 10 topic threads, plus short replies, answers for real people, personal gear items and the 6 gear requests. |
| `agents-chat.js` | k6 script. One VU = one agent with its own token. Messages, replies, reactions, typing, read marks, answers to real people, gear, leaving and coming back, background reads. Strict write allowlist. |
| `run-agents.sh` | Asks for the JWT secret (hidden), signs 15 tokens in memory, runs k6. |

Order on the day:

```bash
# 1. agents/setup.sql in the SQL editor -> summary shows 15 / 15 / 15 / 15, trigger_enabled = O, muted_watchers = Jake + Moshe
./loadtest/run-agents.sh smoke   # 2 agents, ~75 s; both lines must end with ALL OK
./loadtest/run-agents.sh burst   # asks you to type "burst"; ~22 min
```

Burst timeline: minutes 0-3 five agents, 3-6 ten, 6-20 fifteen, then a
2-minute tail where agents only read. Each agent sends ~4 messages a minute
(override with env vars, for example `MSG_PER_MIN=3 ./loadtest/run-agents.sh burst`;
also `REACT_SHARE`, `RATE_PER_MIN`, `SLOW_MS`), leaves for 30-90 s every 3-6 min and catches up when it comes back.
A message from Ohad (`REAL_PEOPLE` in `agents-chat.js`) gets 1-3 agents
answering within 5-20 s (one reply, one or two reactions); anyone else is
ignored.

After the smoke run, check that the mute really works in production (the live
edge function can drift from the repo copy): the `send-push-notification`
logs must show `Skipping <Jake/Moshe id> — muted until ...` for the smoke
messages. If they do not, do not start the burst.

Both scripts print the UTC start and end time; write them down to line up the
screen recordings. Results go to `prod-results/agents-<mode>-<UTC stamp>.{json,log}`
(git-ignored).

What to read in the k6 summary:

- `rt_delivery_ms` (split by `sender:agent` / `sender:real`): time an agent
  receives a `new_message` minus the message's `created_at` (server clock vs
  the Mac clock, so it includes any clock skew).
- `own_delivery_ms`: agent sends -> gets its own message back on the socket.
- `catchup_ms`, `catchup_messages`: coming back from the background.
- `join_failed`, `server_errors`, `client_errors`, `http_req_duration` by `endpoint`.
- `gear_claims_full` is expected (items are already almost fully claimed).

Safety stops: any write outside the allowlist (checked before it is sent), a
401/403 on a write, a 60-second window with p95 > 2 s or > 5% errors that lasts
60 s, whole-run p95 / error thresholds, > 10% failed channel joins.

Expect real side effects: a push to every real chat member who is not muted
(now only Ohad) for every agent message (~60 a minute), a push to Ohad when an
agent reacts to his message, and a notification to the participants when a
gear claim succeeds.
