-- ============================================================================
-- Security hardening: pin search_path on the 46 public functions that had none
-- Date: 2026-06-10
-- Apply: manually via Supabase SQL editor (never `db push`)
--
-- WHY: Supabase advisor "function_search_path_mutable" — 46 functions in
-- `public` had no search_path pinned, so they inherited the caller's. A caller
-- who prepends a malicious schema to search_path could shadow an unqualified
-- object the function references (the same class of bug that previously broke
-- signup — see project_signup_trigger_search_path).
--
-- CHOSEN VALUE: `public, extensions, pg_temp`
--   * public      — the functions reference public tables unqualified
--   * extensions  — covers any unqualified extension function (none detected,
--                   but harmless and future-proofs)
--   * pg_temp last — explicit, so Postgres does NOT implicitly search temp
--                    FIRST (which is the SECURITY DEFINER hijack vector)
--
-- SAFE BECAUSE (verified against live bodies on 2026-06-10):
--   * No function makes an unqualified extension call (no uuid_generate_v*,
--     no crypt/digest/pgp_/hmac).
--   * No body references net./vault./cron./storage./realtime./graphql.
--   * Every `auth.` reference is schema-qualified -> unaffected by search_path.
--   * auth/net/etc. are never in a default search_path, so anything these
--     functions resolve unqualified today lives in public / extensions /
--     pg_catalog — all still resolvable after pinning. No behavior change.
--   * handle_new_auth_user (the signup trigger) is NOT in this set — it was
--     already pinned previously; untouched here.
--
-- Targets exactly the functions with proconfig IS NULL in `public` (= the 46).
-- ============================================================================

DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proconfig IS NULL
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Pinned search_path on % functions', n;
END $$;

-- ----------------------------------------------------------------------------
-- VERIFICATION (run after applying) — expect 0 rows
-- ----------------------------------------------------------------------------
-- SELECT p.oid::regprocedure::text
-- FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
-- WHERE ns.nspname = 'public' AND p.proconfig IS NULL;

-- ----------------------------------------------------------------------------
-- ROLLBACK (only if something breaks)
-- ----------------------------------------------------------------------------
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN
--     SELECT p.oid::regprocedure AS sig
--     FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
--     WHERE ns.nspname = 'public'
--       AND p.proconfig = ARRAY['search_path=public, extensions, pg_temp']
--   LOOP
--     EXECUTE format('ALTER FUNCTION %s RESET search_path', r.sig);
--   END LOOP;
-- END $$;
