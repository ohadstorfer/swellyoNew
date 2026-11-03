#!/usr/bin/env bash
# loadtest/run-prod.sh — run prod-readonly.js against PRODUCTION.
#
#   ./loadtest/run-prod.sh smoke        # read-only: 1 phone, every endpoint once (~20 s)
#   ./loadtest/run-prod.sh load         # read-only: 20 phones 25 min, 30 for 5, 50 for 5
#   ./loadtest/run-prod.sh chat-smoke   # chat + realtime: 1 phone, 1 message (~20 s)
#   ./loadtest/run-prod.sh chat-load    # chat + realtime: 20 phones 15 min, 30 for 5, 50 for 5
#
# It asks for the Supabase JWT secret (Settings -> JWT Keys -> Legacy JWT
# secret) without echoing it, signs ONE token for the account in
# prod-context.json (`me`), and passes it to k6 through the environment.
# The secret and the token are never written to disk or to shell history.
#
# Read-only: see the header of prod-readonly.js. Press Ctrl+C to stop at
# any moment.
set -euo pipefail

ARG="${1:-smoke}"
case "$ARG" in
  smoke|load) SCRIPT=prod-readonly.js; MODE="$ARG" ;;
  chat-smoke) SCRIPT=prod-chat.js; MODE=smoke ;;
  chat-load) SCRIPT=prod-chat.js; MODE=load ;;
  *) echo "usage: run-prod.sh smoke|load|chat-smoke|chat-load"; exit 1 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
K6="${K6:-/private/tmp/claude-501/-Users-ohadstorfer-swellyoNative/1c5b7a8d-efb0-40d7-a376-3148480228e7/scratchpad/tools/k6-v1.8.1/k6-v1.8.1-macos-arm64/k6}"

[ -x "$K6" ] || { echo "k6 not found at $K6 (set K6=/path/to/k6)"; exit 1; }
[ -f "$HERE/prod-context.json" ] || { echo "missing loadtest/prod-context.json"; exit 1; }

# Public app values (they ship inside the app).
BASE_URL="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
ANON_KEY="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$BASE_URL" ] && [ -n "$ANON_KEY" ] || { echo "EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not found in .env"; exit 1; }

read -r -s -p "Supabase JWT secret (hidden): " JWT_SECRET; echo
[ ${#JWT_SECRET} -ge 32 ] || { echo "That does not look like the JWT secret."; exit 1; }

TOKEN="$(JWT_SECRET="$JWT_SECRET" CTX="$HERE/prod-context.json" node -e '
const c = require("node:crypto"), fs = require("node:fs");
const me = JSON.parse(fs.readFileSync(process.env.CTX, "utf8")).me;
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b({ alg: "HS256", typ: "JWT" });
const p = b({ aud: "authenticated", role: "authenticated", sub: me, iat: now, exp: now + 5400 });
const s = c.createHmac("sha256", process.env.JWT_SECRET).update(h + "." + p).digest("base64url");
process.stdout.write(h + "." + p + "." + s);
')"
unset JWT_SECRET

mkdir -p "$HERE/prod-results"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
echo "Starting $ARG run at $STAMP UTC against $BASE_URL. Ctrl+C stops it."
cd "$HERE"
BASE_URL="$BASE_URL" ANON_KEY="$ANON_KEY" TOKEN="$TOKEN" MODE="$MODE" \
  "$K6" run --quiet --summary-export "prod-results/$ARG-$STAMP.json" "$SCRIPT" \
  2>&1 | tee "prod-results/$ARG-$STAMP.log"
