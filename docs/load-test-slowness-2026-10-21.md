# Load test slowness — 21 Oct 2026

What happened when 18 people used the app at the same time, why, what we
changed, and what is still open.

## 1. What happened

- **When:** 21 Oct 2026, 00:00–02:15 UTC (03:00–05:15 Israel time).
- **Who:** 18 testers, all on iOS build 50, mostly inside the same group trips.
- **What people felt:** the app was much slower than usual.
- **What the logs show:**

| Time (UTC)   | What we saw |
|--------------|-------------|
| 00:00–01:35  | Slow, but working. Some screens took 1–6 s (`conversation_members` ~5.7 s, `my_trips_feed` ~6.5 s, `HEAD /notifications` ~2.5 s). |
| 01:25–01:40  | Peak load: about 9 requests per second in total. |
| **01:40–01:55** | **Outage.** Median API response 125 s. 102 requests timed out (500/504). PostgREST error: `PGRST003 Timed out acquiring connection from connection pool`. |
| 01:55 onward | Recovered by itself, because people stopped using the app. |

## 2. Root cause

**The database ran out of memory.**

- The database was on the smallest size, **Nano: 0.5 GB RAM, 60 connections**,
  even though we pay for the Pro plan.
- During the test, Postgres needed about **1.67 GB** of memory. The extra went
  to **swap** (disk used as memory), which grew to about **900 MB**.
- CPU "User" time stayed near 0%. **IOwait** (CPU waiting for the disk) jumped
  to about 70% at 01:40 UTC, right when the outage started.
- Every query became slow, so the slow queries held all the connections, and
  every other request waited in line until it timed out.

My first guess was "CPU credits ran out". That was **wrong**. The dashboard
graphs (Observability → Database) show it was memory and swap.

**Why so much load from only 18 people:** the app sends too many requests.
Each person sent about **17 requests per minute**, even when just looking
around. A healthy number would be 2–4.

Where the requests came from (30-minute sample, 18 users, ~9,400 requests):

| Source | Share | Why |
|--------|-------|-----|
| `GET /rest/v1/surfers` | ~15% | Each list (participants, join requests, gear, chat) fetches profiles separately. |
| `GET /auth/v1/user` (`getUser()`) | ~11% | A network call just to learn "who am I". The session on the phone already knows. |
| `/rest/v1/notifications` (bell count) | ~9% | Counted again on every screen that shows the bell, every time it gets focus. |
| Group chat sync | large | Every message makes **every member's phone** send ~8 requests (`getUser` + 7 queries). 18 members = ~144 requests per message. |
| Trip screen | large | One action (for example approving a join request) writes several tables. Each change sent a separate refresh to every member with the trip open. |

Other findings:

- **81 RLS policies** call `auth.uid()` once per row instead of once per
  query (Supabase advisor: `auth_rls_initplan`). This makes reads use more CPU,
  for example the bell count.
- The table `net._http_response` (pg_net) is **136 MB for only 378 rows**
  (bloat). Its cleanup query took 93 s during the outage. It did not cause the
  outage, but it made it worse.
- The Auth server is limited to **10 DB connections** (advisor
  `auth_db_connections_absolute`).

## 3. What we changed

### Done — database size (21 Oct 2026, ~17:12 UTC)

- Changed **Nano → Micro (1 GB RAM)** in Settings → Infrastructure.
- **Cost: +$0.00 per month.** Micro is a "Free Upgrade" on the Pro plan,
  covered by the included compute credits.
- The database restarted and was down about 3 minutes. It came back at
  17:14:31 UTC. `shared_buffers` went from 224 MB to 256 MB.
  `max_connections` is still 60.

### Done — app code (NOT committed; shipped as iOS OTA on 21 Oct 2026)

Published to `production`, runtime 2.0.7, iOS only, update group
`396d062d-37bf-468f-8a14-19645533212a` ("fd1c02a + uncommitted"). Phones get
it on the next launch and use it on the launch after that. Android did not
get it (same as the earlier 2.0.7 OTAs).

All of these give exactly the same result as before, just with fewer requests.

1. **New helper `getSessionUser()`** — [src/services/auth/sessionUser.ts](../src/services/auth/sessionUser.ts).
   It reads the user from the local session and only calls `getUser()` if
   there is no session. This is the same rule `sendMessage` and
   `getConversations` already used.
2. **messagingService** — [src/services/messaging/messagingService.ts](../src/services/messaging/messagingService.ts).
   `getUser()` → `getSessionUser()` in: `getConversationsUpdatedSince` (runs on
   every inbox broadcast), `markAsRead`, `setMuteUntil`, `getMuteUntil`,
   `editMessage`, `deleteMessage`, `setReaction`, `removeReaction`. All of
   them use only `user.id`.
3. **Inbox sync is lighter.** When the broadcast names specific
   conversations, `getConversationsUpdatedSince` now asks only for the
   membership rows of those conversations instead of all of the user's
   memberships. Same result, less data.
4. **Analytics** — [src/services/analytics/eventLogger.ts](../src/services/analytics/eventLogger.ts).
   `logEvent` and `logEventThrottled` called `getUser()` on **every event**.
   Now they use `getSessionUser()`.
5. **Trip screen refresh** — [src/hooks/trips/useTripRealtime.ts](../src/hooks/trips/useTripRealtime.ts).
   Broadcast events are merged for 300 ms, then one refresh runs. The same
   data is refreshed, just once. Anything still waiting is applied when you
   leave the screen. This is the same pattern `useTripsListRealtime` uses.

**Checks:** `tsc` shows no errors in the changed files. Tests for messaging,
trips and hooks: 443 pass. 8 fail in
`getConversations.characterization.test.ts` and `tripsListRealtime.test.ts`,
but they **fail the same way on HEAD without these changes** (checked in a
clean worktree). Not tested on a device.

## 4. Still open (not done, and why)

| # | Item | Why not done yet | Risk |
|---|------|------------------|------|
| A | **RLS: `auth.uid()` → `(select auth.uid())` in 81 policies** | **DONE — APPLIED to prod 21 Oct 2026 ~19:04 UTC** (migration version `20261021190442`). After: 0 policies left unwrapped, policy type and roles unchanged, real-user reads work, advisor no longer shows `auth_rls_initplan`. Before applying it was Migration: `supabase/migrations/20261021000000_rls_auth_uid_initplan.sql`. Rollback: `supabase/rollbacks/20261021000000_rls_auth_uid_initplan_rollback.sql`. Dry run on prod (inside a transaction that always rolls back): 5 real users × 41 tables = 205 row counts, **0 differences** before vs after, 0 policies left unwrapped. Rollback dry run: 81/81 policies restored to the exact original text. | Low |
| B | **Profile cache for `surfers`** | Needs a design decision: how long a profile can be cached before you see stale names or photos. | Medium |
| C | **Chat sync: fewer queries per message** (members, users, surfers, unread) | Same cache question as B. | Medium |
| D | **Bell count cache** | Must handle the realtime "+1" correctly or the badge shows a wrong number. | Medium |
| E | **`useAuthGuard` still calls `getUser()`** | On purpose: it checks the token with the server (it catches deleted users). Auth is sensitive, so we left it alone. | — |
| F | **`VACUUM FULL net._http_response`** | Small clean-up. Locks that table for a moment. | Low |
| G | **Auth DB connections: switch to percentage** (in the Auth settings; see the advisor's link) | So Auth gets more connections when the DB grows. | Low |
| H | **8 failing tests** (see above) | Were already failing before this work. | — |

## 5. Re-test on production — 21 Oct 2026, 20:28–21:07 UTC

After the Micro upgrade and the RLS migration, we replayed the 21 Oct mix
on production with `loadtest/run-prod.sh load` (read-only version:
`loadtest/prod-readonly.js`). All virtual phones used Ohad's account.

| Step | Phones | Requests/min | Server p50 | Server p95 | Errors |
|------|--------|--------------|------------|------------|--------|
| 1 (25 min) | 20 | ~450–575 (same as the 21 Oct peak) | ~155 ms | ~166 ms | 0 |
| 2 (5 min)  | 30 | ~625–775 | ~155 ms | ~166 ms | 0 |
| 3 (5 min)  | 50 | ~1,000–1,200 (2× the 21 Oct peak) | ~155 ms | ~168 ms | 0 |

- k6 totals: 24,816 requests, 0 errors, client-side p95 296 ms (includes
  the Israel → us-east-1 network; ~150 ms of every request is distance).
- No slow-down over time. On 21 Oct the same load gave 1–2 s p95 and a full
  outage after ~25 minutes.
- DB during the run: 13–15 connections (of 60), 1 active, 99.8% cache hit.
- Real users during the run: p95 30–150 ms, 0 server errors.
- Safety: 0 write requests in the logs, 0 notifications created in the
  window.

**What this test does NOT cover** (so do not read it as "safe for 50
people" yet):
- Writes and realtime. Sending messages, broadcasts and the realtime
  websocket (postgres_changes polling was heavy on 21 Oct) were left out.
- Many different users. Every phone was the same account, which is easier
  on the DB (same rows stay in cache) than 18 different people.
- It replays the OLD app's mix. The new app sends fewer requests, so real
  traffic should be lighter than this.

### 5b. Chat + realtime re-test — 21 Oct 2026, 21:49–22:17 UTC

`loadtest/run-prod.sh chat-load` (`loadtest/prod-chat.js`), NEW app mix.
Each phone holds a realtime socket with the app's 8 channels, sends
messages (0.5 per phone per minute), runs the inbox sync on every
`inbox_change`, marks read, and browses in the background. All messages go
to a test chat ("Load test (Ohad) – ignorar",
`e868b22b-6a92-47e9-8c76-9233880212a6`) whose only member is Ohad, so
`send-push-notification` logged "No recipients found" for every message.

| Step | Phones | Requests/min | Server p50 | Server p95 | Errors |
|------|--------|--------------|------------|------------|--------|
| 1 (15 min) | 20 | ~2,000–2,900 (4–5× the 21 Oct peak) | ~160 ms | ~205 ms | 0 |
| 2 (5 min)  | 30 | up to ~5,450 (~10×) | ~166–173 ms | ~240–250 ms | 0 |
| 3 (5 min)  | 50 | ~10,000 (~18×) | ~175–190 ms | ~330–370 ms | 0 |

- k6 totals: 115,207 requests, **0 errors**; 1,768 channel joins, 0 failed;
  221 socket sessions (reconnects every ~4 min).
- 392 messages → 13,035 inbox events and 13,010 chat events delivered.
- Message delivery (insert → event on the socket): median 180 ms,
  p95 1.09 s.
- Inbox sync as the phone sees it: median 891 ms, p95 1.28 s. Mostly
  network: 4 rounds in a row × ~165 ms Israel → us-east-1. **Design note:**
  one RPC instead of 4 rounds would cut this a lot for every user.
- DB: 30–32 connections (of 60), 1 active, 0 lock waits.
- Real users during the run: 848 requests, 0 server errors, p95 ~40–170 ms.
- Safety: 0 notifications, 0 notification_queue rows, 0 messages outside
  the test chat, 0 writes outside the test chat; the chat still has 1
  member. The 393 test messages are still in that chat (not deleted).

Still not covered: many DIFFERENT users (every phone was Ohad), media
uploads, and push to real recipients.

## 6. How to check the next test

Run these with the Supabase MCP `query_logs` (or Logs Explorer). Set the
time window to the test.

**Requests per user per minute** (goal: under 5):

```sql
select log_attributes['request.sb.auth_user'] u, count(*) reqs
from logs where source = 'edge_logs'
group by u order by reqs desc
```

Divide each row by the number of minutes in the window.

**Latency and errors every 5 minutes:**

```sql
select toStartOfFiveMinutes(timestamp) t, count(*) reqs,
  round(quantile(0.5)(toFloat64OrZero(log_attributes['response.origin_time'])),0) p50,
  round(quantile(0.95)(toFloat64OrZero(log_attributes['response.origin_time'])),0) p95,
  countIf(toInt32OrZero(log_attributes['response.status_code']) >= 500) e5
from logs where source = 'edge_logs' and log_attributes['request.path'] like '/rest/%'
group by t order by t
```

**`getUser` share** (should drop a lot once the new build is in use):

```sql
select countIf(log_attributes['request.path'] = '/auth/v1/user') get_user,
  count(*) total
from logs where source = 'edge_logs'
```

Also open **Observability → Database** for the same window and check
**Memory (swap)** and **CPU (IOwait)**.

## 7. Before the next group test

1. Check the DB size first: Settings → Infrastructure should say `t4g.micro`
   or bigger.
2. Ship the code changes in section 3. They are JS only, with no native
   changes, so an OTA is enough. Walk through `PRE_BUILD_CHECKLIST.md` first.
3. Optional for a big test: move to a bigger size just for those hours. It is
   billed per hour, so a few hours costs very little. Then move back.

## 8. Tester feedback, checked against the logs (23 Oct 2026)

| Complaint | Verdict | Status |
|---|---|---|
| Lag, froze, "stopped loading", chat would not load, could not view profiles | The 01:40–01:55 UTC outage (500/504, realtime "Too many database timeouts") | Fixed (Micro + RLS + fewer requests) |
| "This trip is no longer available" | Any load error (timeout, no session) was shown as "deleted": `getTripById` returned null on every error | Fixed in app (not shipped): `getTripById(…, { throwOnError })` in `fetchTripCore`; trip screen shows "Couldn't load this trip" + Try again |
| "Got logged out" / "logged me out" | One tester came back from the background with an expired access token; for ~1 min the app sent requests with only the anon key (no user) → 401s, realtime channels refused, until the refresh at 00:55:19 | Partly fixed in app (not shipped): `startAutoRefresh`/`stopAutoRefresh` on AppState in `src/config/supabase.ts` (Supabase's RN guide). The ~1 min gap matches auth-js's 60 s refresh-failure cooldown; not fully proven |
| Staff could not see their trip in My Trips | `my_trips_feed` only returned participant / pending-request trips | DB **APPLIED 23 Oct** (`20261023000000_my_trips_feed_staff.sql`, membership `'staff'`; dry run: 9 users, 0 changed, 4 staff trips added). App buckets `'staff'` like participant (not shipped). Old app versions ignore `'staff'` |
| Push only in-app, not on iOS | 8 of 18 testers never saved a push token: permission not granted. The only iOS permission request is the "Stay in the loop" popup; dismiss = 7-day cooldown, "Don't Allow" = never again | Not fixed. Ideas: log the popup choice, ask during onboarding, a "Notifications are off → Settings" row |
| Some pushes lost 01:49–01:53 | Edge functions got `PGRST303 JWT issued at future` during the outage (likely PostgREST clock behind while swapping) | Not fixed. Idea: retry on PGRST303/5xx, or send message pushes through notification_queue |
| "My messages disappeared" | Send → `scrollToBottom()` → `reloadLatestWindow()` replaces the list with the server's latest 30 when the user had scrolled up / opened with unread → the optimistic message vanishes (`DirectGroupChat.tsx` ~:671, :1958) | Fixed in app (not shipped), group chat AND DMs: `mergeLatestWindow()` in `src/services/messaging/messageWindow.ts` keeps pending / just-sent rows when the window reloads; 6 unit tests. Independent review agreed: usually a flicker, lost from screen when the send failed or the reload resolved late; media was worse |
| "Others' messages did not show up" | `syncWithServerInBackground` exists but nothing calls it; after a second CHANNEL_ERROR the screen stops trying | Not fixed |
| "Stopped letting me send" | Composer is locked while one send waits (up to 30 s + 30 s follow-up) | Not fixed |
| App crashed | Needs Sentry (not checked) | Open |
| Stuck in Swelly | Server side was fine (all 200, some up to ~7 s) | Open, client side |
| Swipe feels like Tinder; onboarding own trip; onboarding button over chat | Design | — |

### 8b. "No in-app banner for new group messages" (25 Oct 2026)

- **Cause:** `MessagingProvider` (mounted before sign-in) subscribed to the
  `user-inbox:<uid>` realtime channel ONCE, at mount, via `getUser()`. No
  user at that moment (new signup, re-login) or a failed `getUser()` → no
  inbox channel for the whole session → no in-app banners and no live chat
  list until the app was killed. **14 of the 18 testers signed up during the
  test.** Also, the chat list loaded only at mount, and the banner pass skips
  conversations not already in the list, so a new user's first message per
  chat never bannered.
- **Fix (not shipped):**
  - `MessagingProvider`: the inbox effect is keyed on the signed-in user from
    `OnboardingContext` (subscribe on sign-in, tear down on sign-out); the
    list loads when a user appears and the list is empty (waits for any
    running load, no double load).
  - `messagingService.subscribeToUserInbox`: relies on realtime-js's own rejoin
    for CHANNEL_ERROR / TIMED_OUT, re-creates only on a server CLOSED (backoff
    2 s → 60 s), runs a forced catch-up sync (`handleReconnect({ force: true })`)
    when it recovers, removes every channel on sign-out, ignores events from
    replaced channels.
  - Independent review: first pass "FIX FIRST" (leak on sign-out during a
    retry; my retry fought the built-in rejoin) → fixed → second pass "SHIP".
  - tsc: no new errors. Jest: 478/478 passed in this run.
- **Presence (26 Oct, not shipped):** same pattern — "online" dot / last
  seen was started only by the mount getUser(), so new users showed as
  offline to others until restart. `userPresenceService.trackCurrentUser(userId?)`
  now takes the id (no getUser round-trip), is safe against double starts and
  user switches; `MessagingProvider` starts it on sign-in. Review: SHIP.
  Still one-shot: `subscribeToNewConversations`, legacy realtime mode only.
