#!/usr/bin/env bash
# Ohad-canary backfill (images-to-s3 phase 0): copy Ohad's 3 public images from
# Supabase Storage → swellyo-images (mirrored keys), then generate S3 variants
# via generate-thumbnail-s3. No DB writes here (that's flip-ohad-urls.sql). No
# deletes. Secret is read from THUMB_SECRET env — never hardcode it here.
set -euo pipefail

PROJECT_REF="rfdhtvcmagsbxqntnepv"
SUPA_BASE="https://${PROJECT_REF}.supabase.co/storage/v1/object/public"
FN="https://${PROJECT_REF}.supabase.co/functions/v1/generate-thumbnail-s3"
: "${THUMB_SECRET:?set THUMB_SECRET in the environment}"

# "<supabaseBucket>/<path>" — the S3 key mirrors this exactly.
KEYS=(
  "profile-images/ecaaa678-974a-4641-895a-12cf12e74599/profile-1782408078765.jpg"
  "profile-images/ecaaa678-974a-4641-895a-12cf12e74599/cover-1778290756037.jpg"
  "trip-images/ecaaa678-974a-4641-895a-12cf12e74599/hero-1783171731990.jpg"
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for key in "${KEYS[@]}"; do
  echo "→ $key"
  curl -fsSL "$SUPA_BASE/$key" -o "$tmp/obj.jpg"
  aws s3 cp "$tmp/obj.jpg" "s3://swellyo-images/$key" \
    --content-type image/jpeg --cache-control "public, max-age=31536000" >/dev/null
  echo -n "   generate: "
  curl -fsS -X POST "$FN" -H "x-thumb-secret: $THUMB_SECRET" \
    -H "Content-Type: application/json" -d "{\"key\":\"$key\",\"force\":true}"
  echo
done
echo "done"
