# Analytics Dashboard — Plan & Recommendations (v2)

Status: planning doc, no code changed yet.

## Decision

**One `analytics_events` table holds everything shown on the admin dashboard.**

- Single source of truth for all 9 metrics.
- Every metric is a row tagged with `event_name`.
- Every query in the dashboard takes a custom date range (`from`, `to`) selected by the admin.
- Admins and demo users are excluded uniformly via denormalized flags on each event row.

Why this and not the hybrid: simpler mental model, zero migration to add a new metric, same query shape everywhere, easy to cross-check with PostHog. At Swellyo's volume (low) Postgres handles this comfortably for the next 5+ years.

---

## 1. The table

```sql
CREATE TABLE analytics_events (
  id              bigserial PRIMARY KEY,
  event_name      text NOT NULL,
  user_id         uuid REFERENCES surfers(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  properties      jsonb,

  -- Denormalized at write-time so dashboard queries don't need to join surfers
  is_demo_user    boolean NOT NULL DEFAULT false,
  is_admin        boolean NOT NULL DEFAULT false
);

-- Primary query pattern: "count events of name X in date range, excluding demo/admin"
CREATE INDEX idx_events_name_time
  ON analytics_events (event_name, occurred_at)
  WHERE NOT is_demo_user AND NOT is_admin;

-- For per-user lookups (debugging, "show me this user's timeline")
CREATE INDEX idx_events_user
  ON analytics_events (user_id, event_name);

-- For conversation-scoped events
CREATE INDEX idx_events_conv
  ON analytics_events (conversation_id, event_name)
  WHERE conversation_id IS NOT NULL;

-- Enforces "only first occurrence per user" for milestone events
CREATE UNIQUE INDEX idx_events_first_time
  ON analytics_events (user_id, event_name)
  WHERE event_name IN (
    'user_signed_up',
    'onboarding_step_1','onboarding_step_2','onboarding_step_3',
    'onboarding_step_4','onboarding_step_5','onboarding_step_6',
    'onboarding_step_7','onboarding_step_8',
    'onboarding_finalized',
    'swelly_search_clicked',
    'swelly_connect_clicked',
    'first_message_sent'
  );
```

**Rules of thumb:**
- `user_id` is set when the event is about a person. Null for conversation events.
- `conversation_id` is set when the event is about a conversation. Null otherwise.
- `properties` is optional metadata (e.g. `{"step": 4, "input_value": "..."}`).
- `is_demo_user` / `is_admin` are denormalized **at write-time** from `surfers`. They're a snapshot — if a user later becomes admin, their old events keep their old flag. That's correct for analytics: a user who wasn't an admin when they did a thing is still not an admin in the context of that thing.

---

## 2. The event catalog (all 9 metrics)

| Metric | `event_name` | `user_id` | `conversation_id` | `properties` |
|---|---|---|---|---|
| Users created | `user_signed_up` | yes | — | — |
| Onboarding step 1..8 | `onboarding_step_1` … `onboarding_step_8` | yes | — | optional step metadata |
| Full onboarding complete ("Got it") | `onboarding_finalized` | yes | — | — |
| Clicked Swelly search (first time) | `swelly_search_clicked` | yes | — | — |
| Pressed "connect to..." in Swelly | `swelly_connect_clicked` | yes | — | `{ target_user_id }` |
| Sent first message | `first_message_sent` | yes | yes | — |
| Conversation has reply (both 1+ msgs) | `conversation_two_sided` | NULL | yes | — |
| Conversation has 4+ from each side | `conversation_deep_engaged` | NULL | yes | — |
| App opened (every session, throttled) | `app_opened` | yes | — | `{ platform, app_version }` |

All milestone events use `ON CONFLICT DO NOTHING` so they're written once per user. `app_opened` is the only event without a unique constraint — it can repeat.

---

## 3. Date-range filtering — one pattern, used everywhere

Every dashboard query takes two params: `from: timestamptz | null` and `to: timestamptz | null`. The dashboard UI provides a date-range picker (custom + presets like Today / 7d / 30d / 90d / 1y / All time).

The query shape is identical for every metric:

```sql
SELECT COUNT(*) FROM analytics_events
WHERE event_name = $1
  AND occurred_at >= COALESCE($from, '-infinity')
  AND occurred_at <  COALESCE($to,   'infinity')
  AND NOT is_demo_user
  AND NOT is_admin;
```

Edge function helper:
```typescript
function countEvent(eventName: string, from?: string, to?: string) {
  let q = supabase.from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_name', eventName)
    .eq('is_demo_user', false)
    .eq('is_admin', false);
  if (from) q = q.gte('occurred_at', from);
  if (to)   q = q.lt('occurred_at', to);
  return q;
}
```

That's it. One helper. Used for every single-metric tile on the dashboard.

For multi-event queries (funnel, time series), see Section 6.

---

## 4. Where each event is written

### Client-side writes (in React Native code)

These happen when the user does the action. Use `ON CONFLICT DO NOTHING` for first-time events.

| Event | Where to write | Notes |
|---|---|---|
| `user_signed_up` | After successful signup, in `authService.ts` | Once per user |
| `onboarding_step_1` … `onboarding_step_8` | Each `OnboardingStepNScreen.tsx`, in the "Next" handler | Use `ON CONFLICT DO NOTHING` |
| `onboarding_finalized` | "Got it" / final save handler | Once |
| `swelly_search_clicked` | `TripPlanningChatScreen.tsx` (already calls `trackSwellyChatEntered`) — add DB write next to it | Once |
| `swelly_connect_clicked` | Connect/message button handler in match results | Once per user (or remove unique constraint if you want every match-click) |
| `app_opened` | `AppContent.tsx` boot, with 30-min throttle via AsyncStorage | Many per user — no unique constraint |

### Trigger-based writes (in Supabase, automatic)

These are derived from operational tables. Triggers fire on `INSERT INTO messages`.

```sql
CREATE OR REPLACE FUNCTION on_message_insert() RETURNS trigger AS $$
DECLARE
  v_demo_admin record;
  v_other_id uuid;
  v_my_msg_count int;
  v_their_msg_count int;
  v_already_two_sided bool;
  v_already_deep bool;
  v_has_demo_or_admin bool;
BEGIN
  -- Skip system/deleted
  IF NEW.is_system OR NEW.deleted THEN RETURN NEW; END IF;

  -- Snapshot sender's flags
  SELECT is_demo_user, is_admin INTO v_demo_admin
    FROM surfers WHERE id = NEW.sender_id;

  -- 1) first_message_sent (per user, first time)
  INSERT INTO analytics_events
    (event_name, user_id, conversation_id, occurred_at, is_demo_user, is_admin)
  VALUES
    ('first_message_sent', NEW.sender_id, NEW.conversation_id, NEW.created_at,
     COALESCE(v_demo_admin.is_demo_user, false),
     COALESCE(v_demo_admin.is_admin, false))
  ON CONFLICT (user_id, event_name) DO NOTHING;

  -- Only continue for direct (1:1) conversations
  IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND is_direct) THEN
    RETURN NEW;
  END IF;

  -- Skip conversation events if any participant is demo or admin
  SELECT EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN surfers s ON s.id = cm.user_id
    WHERE cm.conversation_id = NEW.conversation_id
      AND (s.is_demo_user OR s.is_admin)
  ) INTO v_has_demo_or_admin;
  IF v_has_demo_or_admin THEN RETURN NEW; END IF;

  -- Find the other participant
  SELECT user_id INTO v_other_id
    FROM conversation_members
    WHERE conversation_id = NEW.conversation_id
      AND user_id <> NEW.sender_id
    LIMIT 1;

  IF v_other_id IS NULL THEN RETURN NEW; END IF;

  -- 2) conversation_two_sided (once per conversation)
  SELECT EXISTS(SELECT 1 FROM analytics_events
    WHERE conversation_id = NEW.conversation_id
      AND event_name = 'conversation_two_sided') INTO v_already_two_sided;

  IF NOT v_already_two_sided AND EXISTS (
    SELECT 1 FROM messages
    WHERE conversation_id = NEW.conversation_id
      AND sender_id = v_other_id
      AND NOT is_system AND NOT deleted
  ) THEN
    INSERT INTO analytics_events (event_name, conversation_id, occurred_at)
    VALUES ('conversation_two_sided', NEW.conversation_id, NEW.created_at);
  END IF;

  -- 3) conversation_deep_engaged (once per conversation; both sides have 4+)
  SELECT EXISTS(SELECT 1 FROM analytics_events
    WHERE conversation_id = NEW.conversation_id
      AND event_name = 'conversation_deep_engaged') INTO v_already_deep;

  IF NOT v_already_deep THEN
    SELECT COUNT(*) INTO v_my_msg_count FROM messages
      WHERE conversation_id = NEW.conversation_id
        AND sender_id = NEW.sender_id
        AND NOT is_system AND NOT deleted;
    SELECT COUNT(*) INTO v_their_msg_count FROM messages
      WHERE conversation_id = NEW.conversation_id
        AND sender_id = v_other_id
        AND NOT is_system AND NOT deleted;

    IF v_my_msg_count >= 4 AND v_their_msg_count >= 4 THEN
      INSERT INTO analytics_events (event_name, conversation_id, occurred_at)
      VALUES ('conversation_deep_engaged', NEW.conversation_id, NEW.created_at);
    END IF;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION on_message_insert();
```

The trigger does three things per new message: maybe write `first_message_sent`, maybe write `conversation_two_sided`, maybe write `conversation_deep_engaged`. All conditional and idempotent. **Conversation events are pre-filtered at write-time** — they never get written if any participant is demo or admin. So dashboard queries for them don't need to filter.

---

## 5. Excluding admins — uniform pattern

**Step 1.** Add denormalized `is_admin` to `surfers`, synced from `users.role` via trigger:

```sql
ALTER TABLE surfers ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

UPDATE surfers s SET is_admin = true
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = s.id AND u.role = 'admin');

CREATE OR REPLACE FUNCTION sync_surfer_admin_flag() RETURNS trigger AS $$
BEGIN
  UPDATE surfers SET is_admin = (NEW.role = 'admin') WHERE id = NEW.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_surfer_admin
  AFTER INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION sync_surfer_admin_flag();
```

**Step 2.** Every event-write helper reads the current `(is_demo_user, is_admin)` from `surfers` and writes them onto the event row. One helper, used everywhere:

```typescript
async function logEvent(eventName: string, opts: {
  userId?: string;
  conversationId?: string;
  properties?: Record<string, any>;
}) {
  let isDemo = false, isAdmin = false;
  if (opts.userId) {
    const { data } = await supabase
      .from('surfers')
      .select('is_demo_user, is_admin')
      .eq('id', opts.userId)
      .maybeSingle();
    isDemo = data?.is_demo_user ?? false;
    isAdmin = data?.is_admin ?? false;
  }
  await supabase.from('analytics_events').upsert({
    event_name: eventName,
    user_id: opts.userId ?? null,
    conversation_id: opts.conversationId ?? null,
    occurred_at: new Date().toISOString(),
    properties: opts.properties ?? null,
    is_demo_user: isDemo,
    is_admin: isAdmin,
  }, { onConflict: 'user_id,event_name', ignoreDuplicates: true });
}
```

Every dashboard query just filters `NOT is_demo_user AND NOT is_admin`. Done.

---

## 6. Dashboard queries — one shape per metric

Every query takes `$from` and `$to` (nullable). All filter out demo/admin.

### Single counts

```sql
-- Users created in range
SELECT COUNT(*) FROM analytics_events
WHERE event_name = 'user_signed_up'
  AND occurred_at >= COALESCE($from, '-infinity')
  AND occurred_at <  COALESCE($to,   'infinity')
  AND NOT is_demo_user AND NOT is_admin;

-- Same shape for: swelly_search_clicked, swelly_connect_clicked,
-- first_message_sent, onboarding_finalized
```

### Onboarding funnel (one query, all 8 steps + finalized)

```sql
SELECT event_name, COUNT(*) AS users
FROM analytics_events
WHERE event_name IN (
    'user_signed_up',
    'onboarding_step_1','onboarding_step_2','onboarding_step_3',
    'onboarding_step_4','onboarding_step_5','onboarding_step_6',
    'onboarding_step_7','onboarding_step_8',
    'onboarding_finalized'
  )
  AND occurred_at >= COALESCE($from, '-infinity')
  AND occurred_at <  COALESCE($to,   'infinity')
  AND NOT is_demo_user AND NOT is_admin
GROUP BY event_name;
```

Client orders the result by step number and draws the funnel.

### Conversation milestones (pre-filtered at write-time)

```sql
-- Conversations that got a reply in range
SELECT COUNT(*) FROM analytics_events
WHERE event_name = 'conversation_two_sided'
  AND occurred_at BETWEEN $from AND $to;

-- Conversations with 4+ from each side in range
SELECT COUNT(*) FROM analytics_events
WHERE event_name = 'conversation_deep_engaged'
  AND occurred_at BETWEEN $from AND $to;
```

### DAU / app opens (any range)

```sql
-- Unique users that opened the app in the selected range
SELECT COUNT(DISTINCT user_id) FROM analytics_events
WHERE event_name = 'app_opened'
  AND occurred_at >= COALESCE($from, '-infinity')
  AND occurred_at <  COALESCE($to,   'infinity')
  AND NOT is_demo_user AND NOT is_admin;
```

### Time series (sparklines / charts on any metric)

```sql
-- Daily count of `event_name` in range
SELECT date_trunc('day', occurred_at) AS day, COUNT(*) AS n
FROM analytics_events
WHERE event_name = $1
  AND occurred_at >= COALESCE($from, '-infinity')
  AND occurred_at <  COALESCE($to,   'infinity')
  AND NOT is_demo_user AND NOT is_admin
GROUP BY day ORDER BY day;
```

Same query, different `event_name`, produces the sparkline for any tile.

---

## 7. UI/UX — presenting the numbers

### Date range picker (top of dashboard, applies to everything)
- Presets: Today / 7d / 30d / 90d / 1y / All time
- Custom: two date pickers (start, end)
- **Selected range applies to all tiles simultaneously.** No more "today" vs "all-time" mixed view.

### Tile format
Number + delta vs previous equal period + sparkline. Stripe / Vercel / Linear pattern.

```
+-------------------------------------+
| Users created                       |
|                                     |
|   1,247    ▲ 12.4%                  |
|            vs prev. 30d (1,109)     |
|   ▁▂▃▅▆▇█▇▆▅▃▂▁                     |
|                                     |
| Range: May 1 — May 18 · 2026        |
+-------------------------------------+
```

Compute prev-period: if user selected `from..to` of length L days, prev is `(from − L)..from`.

### Onboarding funnel (replaces 8 separate tiles)
```
Signed up          1,247  ███████████████  100%
Step 1 done        1,103  █████████████░░  88%   ↓ 144 (-12%)
Step 2 done          892  ██████████░░░░░  72%   ↓ 211 (-19%)
Step 3 done          810  █████████░░░░░░  65%   ↓  82  (-9%)
...
Step 8 done          560  █████░░░░░░░░░░  45%
"Got it" (final)     498  ████░░░░░░░░░░░  40%
```
Shows exactly where users drop off.

### Tab layout
- **Hero KPIs:** Users created, App opens (unique), Onboarding finalized.
- **Onboarding funnel:** the 8-step funnel above.
- **Engagement:** Swelly search → connect → first message → two-sided → deep engaged.
- ~~Active users tab~~ → removed; replaced by App opens with date filter.

---

## 8. Migration SQL (consolidated)

```sql
-- ============================================================
-- analytics_v2_one_table.sql
-- ============================================================

-- 1. Denormalized admin flag on surfers
ALTER TABLE surfers ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

UPDATE surfers s SET is_admin = true
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = s.id AND u.role = 'admin');

CREATE OR REPLACE FUNCTION sync_surfer_admin_flag() RETURNS trigger AS $$
BEGIN
  UPDATE surfers SET is_admin = (NEW.role = 'admin') WHERE id = NEW.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_surfer_admin ON users;
CREATE TRIGGER trg_sync_surfer_admin
  AFTER INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION sync_surfer_admin_flag();

-- 2. The one analytics table
CREATE TABLE IF NOT EXISTS analytics_events (
  id              bigserial PRIMARY KEY,
  event_name      text NOT NULL,
  user_id         uuid REFERENCES surfers(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  properties      jsonb,
  is_demo_user    boolean NOT NULL DEFAULT false,
  is_admin        boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_events_name_time
  ON analytics_events (event_name, occurred_at)
  WHERE NOT is_demo_user AND NOT is_admin;

CREATE INDEX IF NOT EXISTS idx_events_user
  ON analytics_events (user_id, event_name);

CREATE INDEX IF NOT EXISTS idx_events_conv
  ON analytics_events (conversation_id, event_name)
  WHERE conversation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_first_time
  ON analytics_events (user_id, event_name)
  WHERE event_name IN (
    'user_signed_up',
    'onboarding_step_1','onboarding_step_2','onboarding_step_3',
    'onboarding_step_4','onboarding_step_5','onboarding_step_6',
    'onboarding_step_7','onboarding_step_8',
    'onboarding_finalized',
    'swelly_search_clicked',
    'swelly_connect_clicked',
    'first_message_sent'
  );

-- 3. Trigger that derives messaging events from `messages` inserts
-- [Use the `on_message_insert()` function defined in Section 4]

-- 4. Backfill (one-time)

-- Users created
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'user_signed_up', id, created_at, is_demo_user, is_admin
FROM surfers
ON CONFLICT (user_id, event_name) DO NOTHING;

-- Onboarding phase 1 (if historical data is wanted)
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'onboarding_step_1', id, onboarding_phase1_completed_at, is_demo_user, is_admin
FROM surfers WHERE onboarding_phase1_completed_at IS NOT NULL
ON CONFLICT (user_id, event_name) DO NOTHING;

-- Onboarding finalized (decide what the old onboarding_completed_at column actually meant)
-- INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
-- SELECT 'onboarding_finalized', id, onboarding_completed_at, is_demo_user, is_admin
-- FROM surfers WHERE onboarding_completed_at IS NOT NULL
-- ON CONFLICT (user_id, event_name) DO NOTHING;

-- Swelly first search
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'swelly_search_clicked', id, swelly_first_search_at, is_demo_user, is_admin
FROM surfers WHERE swelly_first_search_at IS NOT NULL
ON CONFLICT (user_id, event_name) DO NOTHING;

-- First message sent (derive from messages)
INSERT INTO analytics_events (event_name, user_id, conversation_id, occurred_at, is_demo_user, is_admin)
SELECT DISTINCT ON (m.sender_id)
  'first_message_sent', m.sender_id, m.conversation_id, m.created_at,
  s.is_demo_user, s.is_admin
FROM messages m
JOIN surfers s ON s.id = m.sender_id
WHERE NOT m.is_system AND NOT m.deleted
ORDER BY m.sender_id, m.created_at ASC
ON CONFLICT (user_id, event_name) DO NOTHING;

-- conversation_two_sided + conversation_deep_engaged backfill:
-- Run a one-off script that walks each conversation's message history and emits
-- a row at the timestamp of the message that completed each criterion.
```

---

## 9. Implementation checklist

### Backend (Supabase)
- [ ] Run the migration above.
- [ ] Run the backfill inserts.
- [ ] Create the `on_message_insert()` trigger.
- [ ] Verify: insert a test message, confirm `analytics_events` got the row.

### Client (React Native)
- [ ] Add `logEvent()` helper (Section 5) to a new `src/services/analytics/eventLogger.ts`.
- [ ] In `authService.ts` post-signup: `logEvent('user_signed_up', { userId })`.
- [ ] In each `OnboardingStepNScreen.tsx` "Next" handler: `logEvent('onboarding_step_N', { userId })`.
- [ ] In the "Got it" / final save handler: `logEvent('onboarding_finalized', { userId })`.
- [ ] In `TripPlanningChatScreen.tsx` next to `trackSwellyChatEntered()`: add `logEvent('swelly_search_clicked', { userId })`.
- [ ] In the Connect/Message button handler: `logEvent('swelly_connect_clicked', { userId, properties: { target_user_id } })`.
- [ ] In `AppContent.tsx` boot: throttled `logEvent('app_opened', { userId, properties: { platform, app_version } })` — guard with 30-min AsyncStorage check.

### Dashboard refactor
- [ ] Rewrite `supabase/functions/analytics-dashboard/index.ts` to query only `analytics_events`. Drop joins on `surfers`/`messages`/`conversations` and the `user_activity` reads.
- [ ] All endpoints accept `from` and `to` ISO date params.
- [ ] Add date-range picker UI (custom + presets) at top of `AnalyticsDashboardScreen.tsx`.
- [ ] Reshape tiles: number + delta % vs previous equal period + sparkline.
- [ ] Add the onboarding funnel view.
- [ ] Add the engagement funnel view.
- [ ] Delete "Active users" tab. Replace with "App opens" (unique users) on the same picker.

### Deprecation (after dashboard is live on new table)
- [ ] Keep old `surfers.onboarding_phase1_completed_at`, `onboarding_completed_at`, `swelly_first_search_at`, `swelly_first_match_at` for one sprint as a fallback.
- [ ] After verification, drop those columns.
- [ ] `user_activity` table stays — used for "online now" indicators, not analytics.

---

## 10. Open questions

1. **`swelly_first_match_at` (old) vs `swelly_connect_clicked` (new)** — old column tracks "matches were shown", new event tracks "user clicked connect on a match". Different things. Confirm we want the new (click-driven) one.
2. **`onboarding_completed_at` (old)** — does it mean step-2-done or fully-finalized-done? Need to check the old write site to decide what it maps to in the backfill.
3. **App opens for unauthenticated users** — do we count them? Recommend NO — only authenticated opens count, keeps `user_id` non-null on this event.
4. **PostHog parity** — should `logEvent()` also send to PostHog, so client-side and server-side views stay in sync? Recommend YES, wrap both in the same helper.

---

## 11. Why this scales fine for Swellyo

At current numbers (~10K users, ~100K conversations, ~hundreds of app opens/day):
- After 1 year: ~50K user-level events + ~20K conversation events + ~150K app opens ≈ **220K rows**.
- After 5 years: ~1M rows. Trivial size for Postgres with the indexes above.
- Every dashboard query is a single-table index scan: sub-100ms.
- Dashboard used by 2–3 admins, not by users. No load concerns.

No partitioning, materialized views, or extra optimization needed beyond this plan for the foreseeable future.
