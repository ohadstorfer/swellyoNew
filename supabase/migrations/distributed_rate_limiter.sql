-- ============================================================================
-- Distributed rate limiter for AI Edge Functions (swelly-chat, swelly-trip-planning)
-- Date: 2026-06-10
-- Apply: manually via Supabase SQL editor (never `db push`)
--
-- WHY: the existing in-memory Map limiter in those functions is per-isolate.
-- Edge Functions run many isolates, so a user spreading requests across
-- isolates is never actually limited -> unbounded OpenAI cost exposure.
-- This replaces it with a single shared counter in Postgres (atomic, fixed
-- window), so the limit is global across all isolates.
--
-- DESIGN:
--   * rate_limit_counters: one row per (bucket, window_start). Bucket-scoped
--     cleanup on each call keeps it to ~1 live row per active user.
--   * check_rate_limit(): atomic INSERT ... ON CONFLICT DO UPDATE increment,
--     returns allowed/remaining/reset_at. Fixed-window algorithm.
--   * SECURITY DEFINER, called only by the edge functions via the service-role
--     key (supabaseAdmin). Per the #2 hardening, EXECUTE is REVOKED from
--     anon/authenticated — service_role bypasses grants, so nothing breaks.
--   * search_path pinned (per #7).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- RLS on (defense in depth) — no policies, so only service_role / definer reach it.
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket         text,
  p_max            integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  -- Floor "now" to the current fixed window boundary.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  -- Keep the table tiny: drop this bucket's stale windows.
  DELETE FROM public.rate_limit_counters
  WHERE bucket = p_bucket AND window_start < v_window_start;

  -- Atomic increment for the current window.
  INSERT INTO public.rate_limit_counters AS rlc (bucket, window_start, count)
  VALUES (p_bucket, v_window_start, 1)
  ON CONFLICT (bucket, window_start)
  DO UPDATE SET count = rlc.count + 1
  RETURNING rlc.count INTO v_count;

  allowed   := v_count <= p_max;
  remaining := greatest(0, p_max - v_count);
  reset_at  := v_window_start + make_interval(secs => p_window_seconds);
  RETURN NEXT;
END;
$$;

-- Consistent with the #2 hardening: not callable by anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- SELECT * FROM public.check_rate_limit('test:verify', 3, 60);  -- allowed=t remaining=2
-- SELECT * FROM public.check_rate_limit('test:verify', 3, 60);  -- allowed=t remaining=1
-- SELECT * FROM public.check_rate_limit('test:verify', 3, 60);  -- allowed=t remaining=0
-- SELECT * FROM public.check_rate_limit('test:verify', 3, 60);  -- allowed=f remaining=0
-- DELETE FROM public.rate_limit_counters WHERE bucket = 'test:verify';

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.check_rate_limit(text, integer, integer);
-- DROP TABLE IF EXISTS public.rate_limit_counters;
