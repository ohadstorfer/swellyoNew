#!/usr/bin/env bash
# loadtest/prepare-schema.sh
#
# Cleans the production schema dump so it is safe to load locally.
#
#   bash loadtest/prepare-schema.sh                     # default paths below
#   bash loadtest/prepare-schema.sh in.sql out.sql
#
# Why: the dump of `public` contains 3 database-webhook triggers
# (messages, message_reactions, surftrip_join_requests) that POST to the
# PRODUCTION edge functions with a Bearer token and an internal secret in
# plain text. Two functions (process_ready_email_batches, enqueue_thumbnail)
# also have the production URL inside. If loaded as-is, every message the
# load test writes would call production.
#
# This script:
#   1. removes every line that calls supabase_functions.http_request (the webhooks)
#   2. replaces the production host with http://127.0.0.1:9 (nothing listens there)
#   3. replaces anything that looks like a JWT with REDACTED_JWT
#   4. fails if the production project ref is still in the file
#
# Keep both files OUT of the repo (the repo is public). Default: /tmp/swellyo-loadtest.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

IN="${1:-$LT_DIR/schema.sql}"
OUT="${2:-$LT_DIR/schema.local.sql}"
REF="rfdhtvcmagsbxqntnepv"

[ -f "$IN" ] || { echo "Missing $IN - run the 'supabase db dump' step first." >&2; exit 1; }

removed=$(grep -c 'supabase_functions' "$IN" || true)

grep -v 'supabase_functions' "$IN" \
  | sed -E "s#https?://${REF}\.supabase\.co#http://127.0.0.1:9#g" \
  | sed -E 's#eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+#REDACTED_JWT#g' \
  > "$OUT"

if grep -q "$REF" "$OUT"; then
  echo "STOP: $OUT still mentions the production project ($REF):" >&2
  grep -n "$REF" "$OUT" | cut -c1-200 >&2
  exit 1
fi

echo "Removed $removed line(s) that mention supabase_functions (webhook triggers)."
echo "Wrote $OUT - no production URL left."
