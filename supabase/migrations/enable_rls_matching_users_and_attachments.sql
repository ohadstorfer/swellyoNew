-- Security fix #1: lock down two public tables that had RLS DISABLED.
--
-- Context (verified against the live DB and the codebase):
--   * public.matching_users (1,130 rows) and public.attachments both had
--     RLS disabled AND granted full SELECT/INSERT/UPDATE/DELETE/TRUNCATE to the
--     public `anon` role. The anon key is bundled into every copy of the app,
--     so anyone could read the entire matching graph or TRUNCATE the tables.
--   * Neither table is ever accessed by client (anon/auth) code. They are only
--     touched by edge functions using SUPABASE_SERVICE_ROLE_KEY, which BYPASSES
--     both grants and RLS. => locking down the public roles breaks nothing.
--
-- Note: TRUNCATE is NOT governed by RLS policies (it is a raw table grant), so
-- enabling RLS alone is insufficient — we must also REVOKE the grants.

-- 1) Remove the over-broad grants to the public roles.
REVOKE ALL ON public.matching_users FROM anon, authenticated;
REVOKE ALL ON public.attachments    FROM anon, authenticated;

-- 2) Enable RLS. No policies => default-deny for anon/authenticated.
--    Service-role edge functions are unaffected (they bypass RLS).
ALTER TABLE public.matching_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments    ENABLE ROW LEVEL SECURITY;

-- 3) Belt-and-suspenders: force RLS so even the table owner obeys policies.
ALTER TABLE public.matching_users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.attachments    FORCE ROW LEVEL SECURITY;
