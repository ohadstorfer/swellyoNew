-- =============================================================
-- Analytics dashboard v2: single-table event model
-- See: .claude/ANALYTICS_DASHBOARD_PLAN.md
--
-- All admin dashboard metrics are derived from analytics_events.
-- Every metric = an event_name. Filter by occurred_at + NOT is_demo_user AND NOT is_admin.
-- One-shot events (signup, onboarding steps, finalize, first_message_sent) are unique per user.
-- Repeatable events (app_opened, swelly_search_clicked, swelly_connect_clicked) can repeat;
-- dashboard counts distinct users via the count_distinct_users_event RPC.
-- =============================================================


-- ------------- 1. Denormalized is_admin flag on surfers --------------
ALTER TABLE surfers
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Initial backfill from users.role
UPDATE surfers s SET is_admin = true
  WHERE EXISTS (
    SELECT 1 FROM users u WHERE u.id = s.user_id AND u.role = 'admin'
  );

-- Keep is_admin in sync with users.role
CREATE OR REPLACE FUNCTION sync_surfer_admin_flag() RETURNS trigger AS $$
BEGIN
  UPDATE surfers SET is_admin = (NEW.role = 'admin') WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_surfer_admin ON users;
CREATE TRIGGER trg_sync_surfer_admin
  AFTER INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION sync_surfer_admin_flag();


-- ------------- 2. analytics_events table --------------
CREATE TABLE IF NOT EXISTS analytics_events (
  id              bigserial PRIMARY KEY,
  event_name      text NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  properties      jsonb,
  is_demo_user    boolean NOT NULL DEFAULT false,
  is_admin        boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE analytics_events IS
  'Single source of truth for admin dashboard analytics. One row per occurrence. Filter via occurred_at + NOT is_demo_user AND NOT is_admin.';


-- ------------- 3. Indexes --------------

-- Primary dashboard query: count by event_name in date range, excluding demo/admin
CREATE INDEX IF NOT EXISTS idx_events_name_time
  ON analytics_events (event_name, occurred_at)
  WHERE NOT is_demo_user AND NOT is_admin;

-- Per-user lookups (debugging, "show me this user's timeline")
CREATE INDEX IF NOT EXISTS idx_events_user
  ON analytics_events (user_id, event_name);

-- Conversation-scoped lookups
CREATE INDEX IF NOT EXISTS idx_events_conv
  ON analytics_events (conversation_id, event_name)
  WHERE conversation_id IS NOT NULL;

-- Unique partial index: enforces "one row per user" for one-shot milestone events.
-- NOT included: app_opened, swelly_search_clicked, swelly_connect_clicked (repeatable).
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_first_time
  ON analytics_events (user_id, event_name)
  WHERE event_name IN (
    'user_signed_up',
    'onboarding_step_1','onboarding_step_2','onboarding_step_3',
    'onboarding_step_4','onboarding_step_5','onboarding_step_6',
    'onboarding_step_7',
    'onboarding_finalized',
    'first_message_sent'
  );


-- ------------- 4. RPC: COUNT DISTINCT users per event in range --------------
-- Used by the edge function for repeatable events (app_opened, swelly_search/connect)
-- because Supabase JS client doesn't support DISTINCT inside count.
CREATE OR REPLACE FUNCTION count_distinct_users_event(
  p_event text,
  p_from  timestamptz DEFAULT NULL,
  p_to    timestamptz DEFAULT NULL
) RETURNS bigint AS $$
  SELECT COUNT(DISTINCT user_id) FROM analytics_events
  WHERE event_name = p_event
    AND occurred_at >= COALESCE(p_from, '-infinity'::timestamptz)
    AND occurred_at <  COALESCE(p_to,   'infinity'::timestamptz)
    AND NOT is_demo_user
    AND NOT is_admin;
$$ LANGUAGE sql STABLE;


-- ------------- 5. Trigger on messages: derives messaging events --------------
CREATE OR REPLACE FUNCTION on_message_insert_analytics() RETURNS trigger AS $$
DECLARE
  v_sender record;
  v_other_id uuid;
  v_my_count int;
  v_their_count int;
  v_has_demo_or_admin bool;
  v_already_two_sided bool;
  v_already_deep bool;
BEGIN
  -- Skip system / deleted messages
  IF COALESCE(NEW.is_system, false) OR COALESCE(NEW.deleted, false) THEN
    RETURN NEW;
  END IF;

  -- Snapshot sender flags at write-time
  SELECT is_demo_user, is_admin INTO v_sender
    FROM surfers WHERE user_id = NEW.sender_id;

  -- 1) first_message_sent (idempotent per user)
  INSERT INTO analytics_events
    (event_name, user_id, conversation_id, occurred_at, is_demo_user, is_admin)
  VALUES
    ('first_message_sent', NEW.sender_id, NEW.conversation_id, NEW.created_at,
     COALESCE(v_sender.is_demo_user, false),
     COALESCE(v_sender.is_admin, false))
  ON CONFLICT (user_id, event_name) DO NOTHING;

  -- Conversation-level events only for direct (1:1) conversations
  IF NOT EXISTS (
    SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND is_direct = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Skip conversation events if any participant is demo or admin (pre-filter at write time)
  SELECT EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN surfers s ON s.user_id = cm.user_id
    WHERE cm.conversation_id = NEW.conversation_id
      AND (s.is_demo_user OR s.is_admin)
  ) INTO v_has_demo_or_admin;
  IF v_has_demo_or_admin THEN
    RETURN NEW;
  END IF;

  -- Find the other participant
  SELECT cm.user_id INTO v_other_id
    FROM conversation_members cm
    WHERE cm.conversation_id = NEW.conversation_id
      AND cm.user_id <> NEW.sender_id
    LIMIT 1;
  IF v_other_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2) conversation_two_sided (once per conversation)
  SELECT EXISTS (
    SELECT 1 FROM analytics_events
    WHERE conversation_id = NEW.conversation_id
      AND event_name = 'conversation_two_sided'
  ) INTO v_already_two_sided;

  IF NOT v_already_two_sided AND EXISTS (
    SELECT 1 FROM messages
    WHERE conversation_id = NEW.conversation_id
      AND sender_id = v_other_id
      AND NOT COALESCE(is_system, false)
      AND NOT COALESCE(deleted, false)
  ) THEN
    INSERT INTO analytics_events (event_name, conversation_id, occurred_at)
    VALUES ('conversation_two_sided', NEW.conversation_id, NEW.created_at);
  END IF;

  -- 3) conversation_deep_engaged (both ≥4 messages)
  SELECT EXISTS (
    SELECT 1 FROM analytics_events
    WHERE conversation_id = NEW.conversation_id
      AND event_name = 'conversation_deep_engaged'
  ) INTO v_already_deep;

  IF NOT v_already_deep THEN
    SELECT COUNT(*) INTO v_my_count FROM messages
      WHERE conversation_id = NEW.conversation_id
        AND sender_id = NEW.sender_id
        AND NOT COALESCE(is_system, false)
        AND NOT COALESCE(deleted, false);
    SELECT COUNT(*) INTO v_their_count FROM messages
      WHERE conversation_id = NEW.conversation_id
        AND sender_id = v_other_id
        AND NOT COALESCE(is_system, false)
        AND NOT COALESCE(deleted, false);
    IF v_my_count >= 4 AND v_their_count >= 4 THEN
      INSERT INTO analytics_events (event_name, conversation_id, occurred_at)
      VALUES ('conversation_deep_engaged', NEW.conversation_id, NEW.created_at);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_on_message_insert_analytics ON messages;
CREATE TRIGGER trg_on_message_insert_analytics
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION on_message_insert_analytics();


-- ------------- 5b. BEFORE INSERT trigger: enforce is_demo_user / is_admin --------------
-- Always overwrite the flags based on the actual surfers row, so the client
-- can't lie about its own demo/admin status to evade dashboard exclusion.
CREATE OR REPLACE FUNCTION enforce_analytics_event_flags() RETURNS trigger AS $$
DECLARE
  v_flags record;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT is_demo_user, is_admin INTO v_flags
      FROM surfers WHERE user_id = NEW.user_id;
    NEW.is_demo_user := COALESCE(v_flags.is_demo_user, false);
    NEW.is_admin := COALESCE(v_flags.is_admin, false);
  ELSE
    -- Conversation-level events (user_id NULL) are emitted only by the
    -- on_message_insert_analytics trigger, which already pre-filters demo/admin.
    NEW.is_demo_user := false;
    NEW.is_admin := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_analytics_flags ON analytics_events;
CREATE TRIGGER trg_enforce_analytics_flags
  BEFORE INSERT ON analytics_events
  FOR EACH ROW EXECUTE FUNCTION enforce_analytics_event_flags();


-- Also make the message-derived trigger run as DEFINER so it can insert
-- regardless of which auth role triggered the message insert.
ALTER FUNCTION on_message_insert_analytics() SECURITY DEFINER;


-- ============================================================
-- 6. BACKFILL — one-time, runs at end of migration
-- ============================================================

-- 6a: user_signed_up from surfers.created_at
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'user_signed_up', user_id, created_at,
       COALESCE(is_demo_user, false), COALESCE(is_admin, false)
FROM surfers
WHERE created_at IS NOT NULL
ON CONFLICT (user_id, event_name) DO NOTHING;

-- 6b: onboarding_step_1 from surfers.onboarding_phase1_completed_at
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'onboarding_step_1', user_id, onboarding_phase1_completed_at,
       COALESCE(is_demo_user, false), COALESCE(is_admin, false)
FROM surfers
WHERE onboarding_phase1_completed_at IS NOT NULL
ON CONFLICT (user_id, event_name) DO NOTHING;

-- 6c: onboarding_finalized from surfers.onboarding_completed_at (best-effort)
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'onboarding_finalized', user_id, onboarding_completed_at,
       COALESCE(is_demo_user, false), COALESCE(is_admin, false)
FROM surfers
WHERE onboarding_completed_at IS NOT NULL
ON CONFLICT (user_id, event_name) DO NOTHING;

-- 6d: swelly_search_clicked — historical "first search" only (legacy column has 1 per user).
-- Going forward, every click creates a new row. No ON CONFLICT because event is repeatable.
INSERT INTO analytics_events (event_name, user_id, occurred_at, is_demo_user, is_admin)
SELECT 'swelly_search_clicked', user_id, swelly_first_search_at,
       COALESCE(is_demo_user, false), COALESCE(is_admin, false)
FROM surfers
WHERE swelly_first_search_at IS NOT NULL;

-- 6e: first_message_sent from messages history (DISTINCT ON gets the first per sender)
INSERT INTO analytics_events (event_name, user_id, conversation_id, occurred_at, is_demo_user, is_admin)
SELECT DISTINCT ON (m.sender_id)
  'first_message_sent',
  m.sender_id,
  m.conversation_id,
  m.created_at,
  COALESCE(s.is_demo_user, false),
  COALESCE(s.is_admin, false)
FROM messages m
JOIN surfers s ON s.user_id = m.sender_id
WHERE NOT COALESCE(m.is_system, false)
  AND NOT COALESCE(m.deleted, false)
ORDER BY m.sender_id, m.created_at ASC
ON CONFLICT (user_id, event_name) DO NOTHING;

-- 6f: conversation_two_sided + conversation_deep_engaged from messages history
-- Walks each direct conversation, emitting events at the timestamp of the message
-- that completed each criterion. Skips conversations with any demo/admin participant.
DO $$
DECLARE
  c_rec record;
  m_rec record;
  v_counts jsonb;
  v_first_sender uuid;
  v_two_sided_at timestamptz;
  v_deep_at timestamptz;
  v_min_count int;
  v_sender_count int;
BEGIN
  FOR c_rec IN
    SELECT c.id AS conv_id
    FROM conversations c
    WHERE c.is_direct = true
      AND NOT EXISTS (
        SELECT 1 FROM conversation_members cm
        JOIN surfers s ON s.user_id = cm.user_id
        WHERE cm.conversation_id = c.id
          AND (s.is_demo_user OR s.is_admin)
      )
  LOOP
    v_counts := '{}'::jsonb;
    v_first_sender := NULL;
    v_two_sided_at := NULL;
    v_deep_at := NULL;

    FOR m_rec IN
      SELECT sender_id, created_at FROM messages
      WHERE conversation_id = c_rec.conv_id
        AND NOT COALESCE(is_system, false)
        AND NOT COALESCE(deleted, false)
      ORDER BY created_at ASC
    LOOP
      v_counts := jsonb_set(
        v_counts,
        ARRAY[m_rec.sender_id::text],
        to_jsonb(COALESCE((v_counts->>m_rec.sender_id::text)::int, 0) + 1)
      );

      IF v_first_sender IS NULL THEN
        v_first_sender := m_rec.sender_id;
      END IF;

      -- two-sided: a sender different from the first
      IF v_two_sided_at IS NULL AND m_rec.sender_id <> v_first_sender THEN
        v_two_sided_at := m_rec.created_at;
      END IF;

      -- deep-engaged: ≥2 senders and min count ≥ 4
      IF v_deep_at IS NULL THEN
        SELECT MIN(val::int), COUNT(*)
          INTO v_min_count, v_sender_count
        FROM jsonb_each_text(v_counts) AS j(key, val);

        IF v_sender_count >= 2 AND v_min_count >= 4 THEN
          v_deep_at := m_rec.created_at;
        END IF;
      END IF;

      -- early exit once both events are emitted
      IF v_two_sided_at IS NOT NULL AND v_deep_at IS NOT NULL THEN
        EXIT;
      END IF;
    END LOOP;

    IF v_two_sided_at IS NOT NULL THEN
      INSERT INTO analytics_events (event_name, conversation_id, occurred_at)
      VALUES ('conversation_two_sided', c_rec.conv_id, v_two_sided_at);
    END IF;
    IF v_deep_at IS NOT NULL THEN
      INSERT INTO analytics_events (event_name, conversation_id, occurred_at)
      VALUES ('conversation_deep_engaged', c_rec.conv_id, v_deep_at);
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- RLS — authenticated users may write their own events; nobody may read directly.
-- Dashboard reads via edge function (service role bypasses RLS).
-- Triggers run SECURITY DEFINER, so they bypass RLS too.
-- ============================================================
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can INSERT events keyed to themselves.
-- (Conversation-level events with user_id NULL come from triggers, not clients.)
CREATE POLICY "auth_users_insert_own_events"
  ON analytics_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No SELECT / UPDATE / DELETE policies for non-service roles by design.
