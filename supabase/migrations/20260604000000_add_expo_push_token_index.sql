-- Zero-risk performance index.
--
-- pushNotificationService registers a device token by first clearing the token
-- from any OTHER row that holds it:
--   UPDATE surfers SET expo_push_token = NULL WHERE expo_push_token = <token>
-- (src/services/notifications/pushNotificationService.ts:121-129)
--
-- surfers.expo_push_token had NO index, so that equality filter was a full-table
-- scan of the surfers table on every app open / token refresh. This index turns
-- it into a point lookup. It cannot change any query result — it only makes the
-- same lookup cheaper.
--
-- Partial (WHERE expo_push_token IS NOT NULL) keeps it small: only rows that
-- actually hold a token are indexed, and the .eq(token) filter never matches NULLs.
--
-- NOTE: CONCURRENTLY must run OUTSIDE a transaction block. If applying via the
-- Supabase dashboard SQL editor, run this statement on its own (no BEGIN/COMMIT).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_surfers_expo_push_token
ON surfers (expo_push_token)
WHERE expo_push_token IS NOT NULL;
