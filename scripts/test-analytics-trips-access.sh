#!/usr/bin/env bash
# Real-flow access/security test for the deployed `analytics-trips` edge function
# and the `trips_*` RPCs. READ-ONLY — sends no notifications, mutates nothing.
#
# Asserts:
#   T1  no auth                -> 401 (edge fn gated)
#   T2  anon key as bearer     -> 401 (edge fn rejects non-user token)
#   T3  direct RPC as anon     -> SECURITY GATE: must NOT return 200 with data once
#                                 migration 20260608000001 (REVOKE) is applied.
#                                 Before the fix this returns 200 -> reported VULNERABLE.
#
# Usage: bash scripts/test-analytics-trips-access.sh
set -u
URL="https://rfdhtvcmagsbxqntnepv.supabase.co"
ANON=$(grep -rhoE 'EXPO_PUBLIC_SUPABASE_ANON_KEY[ =:"'\'']*ey[A-Za-z0-9._-]+' .env* app.json app.config.* 2>/dev/null \
        | grep -oE 'ey[A-Za-z0-9._-]+' | head -1)
if [ -z "$ANON" ]; then echo "FATAL: could not find EXPO_PUBLIC_SUPABASE_ANON_KEY"; exit 2; fi

fail=0

echo "── T1: edge fn, no auth (expect 401) ─────────────────────────"
c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/functions/v1/analytics-trips" \
      -H "Content-Type: application/json" -d '{}')
echo "   status=$c"; [ "$c" = "401" ] && echo "   PASS" || { echo "   FAIL (want 401)"; fail=1; }

echo "── T2: edge fn, anon bearer (expect 401 invalid token) ───────"
c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/functions/v1/analytics-trips" \
      -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}')
echo "   status=$c"; [ "$c" = "401" ] && echo "   PASS" || { echo "   FAIL (want 401)"; fail=1; }

echo "── T3: SECURITY GATE — direct RPC as anon (must be locked) ───"
body=$(curl -s -X POST "$URL/rest/v1/rpc/trips_overview" \
      -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
      -H "Content-Type: application/json" -d '{}')
c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/rest/v1/rpc/trips_overview" \
      -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
      -H "Content-Type: application/json" -d '{}')
echo "   status=$c  body=$body"
if [ "$c" = "200" ]; then
  echo "   VULNERABLE — RPC is publicly callable. Apply migration 20260608000001 (REVOKE)."
  fail=1
else
  echo "   SECURED — RPC rejects non-service callers (status $c)."
fi

echo "──────────────────────────────────────────────────────────────"
[ "$fail" = "0" ] && echo "RESULT: PASS" || echo "RESULT: FAIL (see above)"
exit $fail
