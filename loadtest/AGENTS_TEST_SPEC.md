# Spec: fake travelers in "El Salvador 26" (live group test)

Written 26 Oct 2026 from an interview with Ohad. Read with
[README.md](README.md) and `docs/load-test-slowness-2026-10-21.md`.

## Summary

Add 15 fake travelers ("agents") to the real operator trip **El Salvador 26**
in production. A k6 script drives them in a burst: they chat with each other,
reply, react, type, add and claim gear, and leave and come back like real
phones. Ohad (operator), Jake and Moshe (co-operators) watch on their phones
and record their screens. Claude measures the server, realtime delivery, push
delivery and crashes, then lines the measurements up with the recordings.

## Facts checked in production (26 Oct 2026)

| Thing | Value |
|---|---|
| Trip | `5c042bf4-18af-496c-a3e1-262bfa0a3efc`, "El Salvador 26", hosting_style `C`, payment_mode `managed`, 10–20 Jan 2027 |
| Capacity | `max_participants` = **6**, `participant_count` = 1 (only Ohad, since 27 Oct) |
| Host / operator | Ohad (`ecaaa678-974a-4641-895a-12cf12e74599`) |
| Staff | Jake + Moshe = `co_operator`; Diego Armando = `listed` (no account) |
| Active travelers | none. "sababa", "Demo Surfer 68560" and "Ganani" were removed silently on 27 Oct 2026 (one is a real person); Jake + Moshe rows were already `removed` |
| Trip chat | `5c88d382-39f9-4515-8c94-67137e722f89`, 3 active members (Ohad, Jake, Moshe), 26 messages |
| Members with a push token | **3 of 3** (Ohad, Jake, Moshe) — every chat message will push to them |
| Group gear items | 2 |
| `handle_new_auth_user` | exists in prod: creates `public.users` when an `auth.users` row is inserted |
| NOT NULL, no default | `surfers.user_id`, `surfers.name`, `users.email` |
| Hiding flag | `surfers.is_demo_user` (460 demo users already exist) |

## Decisions (from the interview)

1. **Trip:** the real "El Salvador 26". Raise `max_participants` 6 → 25 first
   (write down the old value).
2. **Joining:** inserted directly as `status = 'active'` with the service role.
   No waiver, documents or payment.
3. **Messages:** scripted, not LLM. English (the testers write in English).
4. **Push:** real. Ohad, Jake and Moshe get pushes for every message.
5. **Cleanup:** none. Fake users, their messages, reactions and gear stay.
6. **Load:** burst. 15 agents × ~4 messages per minute each (~60 per minute
   in the chat).
7. **Agent actions:** messages, replies, reactions, typing, read marks, gear
   (personal, claims, requests), leaving and coming back.
8. **App version:** ship today's fixes as an OTA (iOS + Android) **before** the
   test. Follow `PRE_BUILD_CHECKLIST.md`.
9. **Measure:** server, realtime latency, push latency, Sentry crashes.
10. **Reporting:** the three watchers record their screens and send the
    minutes where something looked wrong.
11. **Agents and real people:** agents reply to and react to messages that
    Ohad, Jake or Moshe write in the group. No @mentions, no DMs.
12. **Hiding:** set `is_demo_user = true`. That removes them from matching,
    crew search, invite candidates, Swelly and analytics. They stay visible
    inside the trip and its dashboard (intended), and in the DM name search
    (`UserSearchModal.tsx:80-85` has no filter — accepted).

## Requirements

### A. Setup (one SQL file, run once, idempotent)

`loadtest/agents/setup.sql`. Run it through the Supabase MCP or the SQL
editor. It must:

1. Refuse to run unless the trip id and title match the table above.
2. Insert 15 `auth.users` rows with fixed UUIDs (hard-coded in the file, so
   the run script knows them), emails `agent01@loadtest.invalid` …
   `agent15@loadtest.invalid`, `aud = 'authenticated'`,
   `role = 'authenticated'`, `email_confirmed_at = now()`, a random unusable
   `encrypted_password`, and `raw_app_meta_data = {"provider":"email","providers":["email"]}`.
   `on conflict do nothing`. Confirm that `public.users` rows appeared (the
   chat trigger needs them — `20260923000000_trip_chat_membership_sync.sql:175`).
3. Upsert 15 `surfers` rows: name (realistic first names, see open
   question 2), age, country_from, surfboard_type, surf_level,
   surf_level_category, `finished_onboarding = true`,
   `onboarding_completed_at = now()`, timezone, **`is_demo_user = true`**,
   no `expo_push_token`.
4. `update group_trips set max_participants = 25` for this trip only.
5. Insert 15 `group_trip_participants` rows (`role = 'member'`,
   `status = 'active'`) **with `trg_member_joined` disabled inside the same
   transaction** (see memory `reference_add_trip_participant_silently`), so
   the real travelers do not get 15 "X joined" notifications. Re-enable it in
   the same transaction.
6. Check that all 15 are now `conversation_members` of the trip chat with
   `left_at is null`. If not, call `sync_trip_chat_members(trip_id)`.
7. Do NOT fake payments, waivers or personal info. The ledger alarm watches
   payment events. The operator dashboard will show the agents as owing the
   deposit; that is fine for this test.
8. Print a summary: 15 users, 15 surfers, 15 active participants,
   participant_count, chat member count.

### B. Run script

`loadtest/run-agents.sh smoke|burst`, copied from `run-prod.sh`:

- Asks for the legacy JWT secret without echo (Ohad types it; Claude never
  sees it). Signs one HS256 token per agent id (`sub` = agent id, 90 min),
  in memory only, and passes them to k6 as one env var.
- `smoke`: 2 agents, 3 messages each, 1 reaction, 1 gear update, ~1 min.
- `burst`: the full test (section C).
- Writes `loadtest/prod-results/agents-<mode>-<UTC stamp>.{json,log}` and
  prints the UTC start time (for lining up with the screen recordings).

### C. Agent behavior (`loadtest/agents-chat.js`, k6)

One VU = one agent, pinned to its own token by VU number.

**Timeline (burst):** minutes 0–3: 5 agents. Minutes 3–6: 10. Minutes 6–20:
15. Then a 2-minute quiet tail where agents only read (to watch catch-up).

Each agent:

1. **Socket:** one realtime websocket with the channels the app opens
   (reuse `prod-chat.js`): `user-inbox:<me>` (private), `user-trips:<me>`,
   `trip:<trip>`, `messages:<conv>` and `reactions:<conv>` (private), and the
   notifications listener.
2. **Messages:** about 4 per minute (jittered, never two within 5 s). A
   `typing` broadcast `{userId, isTyping:true}` 1–3 s before each send.
   Insert exactly like the app (`messagingService.ts:1054-1081`): upsert into
   `messages` with `{conversation_id, sender_id, body, attachments: [],
   type: 'text', client_id}`, `on_conflict=sender_id,client_id`, then the
   `conversations.updated_at` update the app does (`:1109`).
3. **Lines:** `loadtest/agents/lines.json`, ~200 short surf-trip lines in
   threads (flights, boards, waves, food, packing, jokes). About 25% of
   messages are replies to a recent message (`reply_to_message_id` +
   `reply_to_snapshot`, frozen like the app does).
4. **Reactions:** about 1 in 3 messages from others, upsert into
   `message_reactions` (`:3591-3601`), emojis 🤙 🔥 😂 ❤️ 👍 🌊.
5. **Read marks:** 2 s after new messages arrive (debounced), update
   `conversation_members.last_read_message_id / last_read_at` and broadcast
   `read_receipt`, like `:2064-2119`.
6. **Real people:** when a message arrives whose sender is not an agent,
   1–3 random agents answer within 5–20 s: one reply with
   `reply_to_snapshot` and one or two reactions.
7. **Gear:**
   - every ~5 min: `update group_trip_participants set personal_gear_by_me`
     (own row, `groupTripsService.ts:1217`);
   - once per agent: upsert a claim into `group_trip_gear_claims`
     `{item_id, user_id, quantity: 1}` (`:2747`). A rejection because the
     item is full is expected: count it, don't fail;
   - at most 6 gear requests in the whole run: insert into
     `group_trip_gear_requests` (`:2825`). Each one notifies the operator.
8. **Leave and come back:** every 3–6 min, close the socket for 30–90 s (as
   if backgrounded), then reconnect, rejoin all channels and run the app's
   catch-up (messages updated since the last event plus the inbox sync from
   `prod-chat.js`).
9. **Background reads:** the "new app" read mix from `prod-chat.js`, scaled
   to one agent.

**Write allowlist** (anything else aborts before it is sent, same pattern as
`prod-chat.js`):
`POST messages` (only into this chat, `sender_id` = self),
`PATCH conversations` (only this chat, `updated_at`),
`POST message_reactions` (`user_id` = self),
`PATCH conversation_members` (self, this chat),
`PATCH group_trip_participants` (self, this trip, only `personal_gear_by_me`),
`POST group_trip_gear_claims` (self, items of this trip),
`POST group_trip_gear_requests` (self, this trip),
`POST /realtime/v1/api/broadcast` (`typing` / `read_receipt` on this chat).

**Safety stops:** rolling p95 > 2000 ms or > 5% errors for 60 s, > 10%
failed channel joins, any refused request. Ctrl+C at any time.

### D. Measurement

1. **Before (T-10 min):** DB compute (Micro), `pg_stat_activity` count,
   `net._http_response` size, Sentry issue list (empty baseline), a
   snapshot of `pg_stat_statements` for these tables (do NOT reset it in
   prod; diff after).
2. **During (k6):** per-request latency and errors by name; `rt_delivery_ms`
   = time an agent receives a `new_message` minus that message's
   `created_at` (server clock; note that the Mac clock is NTP-synced);
   channel join failures; reconnect catch-up time.
3. **During (Claude, every ~2 min through the MCP):** `pg_stat_activity`
   count, waiting connections, long queries. Read-only.
4. **Push:**
   - chat messages: no "sent" column exists. After the run, read the
     `send-push-notification` edge function logs for the window and match
     log time to `messages.created_at` (p50/p95);
   - gear notifications: `notification_queue.sent_at - created_at`.
5. **After:** Supabase API and Postgres logs for the window (5xx,
   PGRST003, timeouts), `pg_stat_statements` diff, Sentry issues in the
   window (through Chrome, like on 26 Oct), counts (messages, reactions,
   claims, requests, notifications).
6. **Watchers:** each records their screen, says the recording's start time
   in the chat, and afterwards sends the minutes where something looked
   wrong. Claude matches each minute to the metrics.

### E. Watcher checklist (send to Ohad, Jake, Moshe before the run)

- Chat tab of the trip: new messages arrive without reopening; nothing
  disappears; typing indicator; reactions appear; replies show the quote.
- Leave the app for 1 minute, come back: missed messages appear on their own.
- Send your own messages during the burst: they send right away, the
  composer never locks, agents reply.
- Push: arrives on the lock screen; in-app banner when you are on another tab;
  unread counts on the chats list.
- Trip page: roster with 15 travelers, role labels next to names in chat,
  gear list and claims update, the operator dashboard still opens.
- Any freeze, blank screen or crash: say the minute out loud on the
  recording.

### F. Report

`docs/agents-test-<date>.md`: setup, timeline, the numbers from D, every
watcher minute matched to metrics, problems found, and what to fix.
Update the SDSU checklist artifact if anything there changes.

## Edge cases

- **Trip full:** setup raises the cap first. If the insert still fails, stop.
- **Gear claim over the needed quantity:** expected 4xx, counted, not fatal.
- **Agent token expires (90 min):** the burst is ~22 min plus smoke; fine.
- **Realtime join refused:** the agent retries with backoff like the app;
  > 10% failed joins stops the run.
- **Push storm:** ~60 pushes per minute to 5 phones. iOS may group or
  throttle them; note what you see, it is part of the test.
- **Someone real joins mid-test:** nothing special; the agents treat them as
  a real person (rule C.6).
- **Ctrl+C mid-run:** nothing to clean up (cleanup is "leave everything").

## Before the test (blocking)

1. Commit today's work and ship the OTA (iOS + Android) through
   `PRE_BUILD_CHECKLIST.md`. Ohad, Jake and Moshe open the app twice to pick
   it up, and confirm the OTA id in Settings.
2. Answer the open questions below.
3. Run `setup.sql`, then `run-agents.sh smoke`, check the summary, then the
   burst.

## Files

| File | New / change |
|---|---|
| `loadtest/agents/setup.sql` | new |
| `loadtest/agents/lines.json` | new |
| `loadtest/agents-chat.js` | new (based on `prod-chat.js`) |
| `loadtest/run-agents.sh` | new (based on `run-prod.sh`) |
| `loadtest/README.md` | add a section for this test |
| `docs/agents-test-<date>.md` | new, after the run |

No app code changes. No migrations.

## Open questions

1. ~~Who are "sababa", "Demo Surfer 68560" and "Ganani"?~~ Resolved 27 Oct:
   one is a real person, so all three were set to `removed` (silently, same
   update as `operator_remove_traveler`, `left_by` = Ohad). No refunds were
   made: sababa and Demo Surfer keep their payment events as they were.
2. **Agent names and photos:** realistic first names ("Kai", "Lucía") or
   clearly fake ("Agent 03")? They stay forever in a real trip and in the DM
   name search. Photos: none (default avatar) or stock surf photos?
3. **The cap after the test:** with 19 active travelers, putting
   `max_participants` back to 6 leaves the trip "over capacity". Keep 25?
4. **Date and time:** when are the three of you free together? The run is
   ~25 min plus ~10 min of setup and smoke.
