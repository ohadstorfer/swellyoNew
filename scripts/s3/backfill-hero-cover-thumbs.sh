#!/usr/bin/env bash
# Backfill the wide `__1280w.jpg` thumbnail for existing group-trip HEROES and
# profile COVERS on swellyo-images S3, via the generate-thumbnail-s3 edge fn.
#
# Why: the app now renders these wide images through their `__1280w` variant
# (toWidthThumbUrl) instead of the full-size original — egress reduction. Trip
# heroes may already have the variant; covers definitely don't (the generator
# skipped covers until the 2026-07-07 change — DEPLOY generate-thumbnail-s3 first).
#
# `force:true` regenerates unconditionally (idempotent, safe to re-run). The
# client falls back to the original for any key this misses, so it's non-breaking.
# Secret is read from THUMB_SECRET — never hardcode it.
set -euo pipefail

PROJECT_REF="rfdhtvcmagsbxqntnepv"
FN="https://${PROJECT_REF}.supabase.co/functions/v1/generate-thumbnail-s3"
: "${THUMB_SECRET:?set THUMB_SECRET in the environment}"

KEYS=(
  # profile covers (7)
  "profile-images/03bc2fd3-32e9-4add-9aa1-66582697b320/cover-1777336827431.jpg"
  "profile-images/288a5ddf-3199-4527-92af-330bc195660f/cover-1777602111306.jpg"
  "profile-images/cbdc7b19-29d8-4c20-82a6-5e6af1b06ac4/cover-1779232859564.jpg"
  "profile-images/deae948d-33b3-4131-a4e9-9a6a3fd6e531/cover-1777930212533.jpg"
  "profile-images/e11a30c8-aeff-4caf-bddf-adf231cf4456/cover-1777564005156.jpg"
  "profile-images/ecaaa678-974a-4641-895a-12cf12e74599/cover-1778290756037.jpg"
  "profile-images/f9019aff-8a00-4b2e-a2f7-6a74d51a604a/cover-1778771791332.jpg"
  # group-trip heroes (14)
  "trip-images/3f124216-1c36-4870-8912-23ddff4e926d/hero-1782875621854.jpg"
  "trip-images/4c157afe-174f-497d-850c-78ad3c00b7a0/hero-1782914686863.jpg"
  "trip-images/5d3c1927-d5de-45fc-b259-092a9ec53daa/hero-1782829072895.jpg"
  "trip-images/675e2321-8901-4d75-9eb5-f14cb7762258/hero-1782836226529.jpg"
  "trip-images/675e2321-8901-4d75-9eb5-f14cb7762258/hero-1782836293112.jpg"
  "trip-images/6d4d073d-772f-4da6-84da-70ef468bb540/hero-1782756519436.jpg"
  "trip-images/761039f2-bdd7-44d8-af9c-ae91540b4061/hero-1783103660222.jpg"
  "trip-images/d64eb3c7-a6d4-4523-91b8-8441fc0d1822/hero-1782760790925.jpg"
  "trip-images/deae948d-33b3-4131-a4e9-9a6a3fd6e531/hero-1782766633272.jpg"
  "trip-images/e11a30c8-aeff-4caf-bddf-adf231cf4456/hero-1782749645141.jpg"
  "trip-images/e11a30c8-aeff-4caf-bddf-adf231cf4456/hero-1782750266984.jpg"
  "trip-images/ecaaa678-974a-4641-895a-12cf12e74599/hero-1783448246437.jpg"
  "trip-images/f4b83bca-ca51-47c7-ae39-c3e3d44eb7ce/hero-1783006546261.jpg"
  "trip-images/fe966c5b-07b1-4960-b2dc-882da1a7b3d2/hero-1782848195862.jpg"
)

ok=0; fail=0
for key in "${KEYS[@]}"; do
  echo -n "→ $key : "
  if curl -fsS -X POST "$FN" \
      -H "x-thumb-secret: $THUMB_SECRET" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$key\",\"force\":true}"; then
    echo; ok=$((ok+1))
  else
    echo "FAILED"; fail=$((fail+1))
  fi
done
echo "done: ok=$ok fail=$fail total=${#KEYS[@]}"
