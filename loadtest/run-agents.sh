#!/usr/bin/env bash
# loadtest/run-agents.sh — run agents-chat.js against PRODUCTION: 15 fake
# travelers chat in the real trip "El Salvador 26". Spec: AGENTS_TEST_SPEC.md.
#
#   ./loadtest/run-agents.sh smoke   # 2 agents, 3 messages each, 1 reaction, 1 gear update (~75 s)
#   ./loadtest/run-agents.sh burst   # 15 agents in 3 waves, ~60 messages/min, 20 min + 2 min read-only tail
#
# Run loadtest/agents/setup.sql first (once).
#
# It asks for the Supabase JWT secret (Settings -> JWT Keys -> Legacy JWT
# secret) without echoing it, signs one 90-minute token per agent (sub =
# agent id), and passes them to k6 through the environment. The secret and
# the tokens are never written to disk or to shell history.
#
# REAL side effects: every message pushes to the real chat members who are
# not muted (for now only Ohad: setup.sql mutes the chat for Jake and Moshe),
# agent reactions to Ohad's messages push him too, a successful gear claim
# notifies the participants. Gear requests are off unless GEAR_REQUESTS=1..6
# (they notify every trip admin, Jake and Moshe included). Nothing is cleaned
# up afterwards.
# Press Ctrl+C to stop at any moment.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  smoke|burst) ;;
  *) echo "usage: run-agents.sh smoke|burst"; exit 1 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
K6="${K6:-$(command -v k6 || echo "$HOME/.local/bin/k6")}"

[ -x "$K6" ] || { echo "k6 not found at $K6 (set K6=/path/to/k6, see README 'One-time setup -> k6')"; exit 1; }
[ -f "$HERE/agents/lines.json" ] || { echo "missing loadtest/agents/lines.json"; exit 1; }
# The agent ids are a fixed pattern; make sure setup.sql still uses it.
grep -q "10ad7e57-0000-4000-8000-0000000000" "$HERE/agents/setup.sql" \
  || { echo "agents/setup.sql does not use the agent id pattern 10ad7e57-0000-4000-8000-0000000000NN"; exit 1; }

# Public app values (they ship inside the app).
BASE_URL="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
ANON_KEY="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$BASE_URL" ] && [ -n "$ANON_KEY" ] || { echo "EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not found in .env"; exit 1; }

if [ "$MODE" = "burst" ]; then
  echo "BURST: 15 agents, ~60 messages a minute in the REAL trip chat for ~${BURST_MINUTES:-22} minutes."
  echo "Ohad, Jake and Shakes get a push for every message (Moshe is muted). Nothing is cleaned up."
  read -r -p "Type burst to start: " CONFIRM
  [ "$CONFIRM" = "burst" ] || { echo "Not started."; exit 1; }
fi

read -r -s -p "Supabase JWT secret (hidden): " JWT_SECRET; echo
[ ${#JWT_SECRET} -ge 32 ] || { echo "That does not look like the JWT secret."; exit 1; }

AGENT_TOKENS="$(JWT_SECRET="$JWT_SECRET" node -e '
const c = require("node:crypto");
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b({ alg: "HS256", typ: "JWT" });
const out = [];
for (let i = 1; i <= 15; i++) {
  const sub = "10ad7e57-0000-4000-8000-0000000000" + String(i).padStart(2, "0");
  const p = b({ aud: "authenticated", role: "authenticated", sub, iat: now, exp: now + 5400 });
  const s = c.createHmac("sha256", process.env.JWT_SECRET).update(h + "." + p).digest("base64url");
  out.push(h + "." + p + "." + s);
}
process.stdout.write(out.join(","));
')"
unset JWT_SECRET

mkdir -p "$HERE/prod-results"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
echo "Starting agents $MODE at $(date -u '+%Y-%m-%d %H:%M:%S') UTC (local $(date '+%H:%M:%S')) against $BASE_URL."
echo "Write this time down: it lines up the screen recordings. Ctrl+C stops it."
cd "$HERE"
set +e
BASE_URL="$BASE_URL" ANON_KEY="$ANON_KEY" AGENT_TOKENS="$AGENT_TOKENS" MODE="$MODE" \
  "$K6" run --quiet --summary-export "prod-results/agents-$MODE-$STAMP.json" agents-chat.js \
  2>&1 | tee "prod-results/agents-$MODE-$STAMP.log"
CODE=${PIPESTATUS[0]}
set -e
echo "Ended at $(date -u '+%Y-%m-%d %H:%M:%S') UTC (k6 exit code $CODE). Results: loadtest/prod-results/agents-$MODE-$STAMP.{json,log}"
exit "$CODE"
