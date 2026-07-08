#!/usr/bin/env bash
# Copy the curated Countries bucket (Supabase Storage) → swellyo-images S3
# (Countries/ prefix), so flipping getCountryImageFromStorage to S3 never 404s a
# curated country photo. COPY only — Supabase originals stay. No thumbnails
# (country images are read raw, not laddered). Idempotent (overwrites).
set -euo pipefail

PROJECT_REF="rfdhtvcmagsbxqntnepv"
SUPA_BASE="https://${PROJECT_REF}.supabase.co/storage/v1/object/public/Countries"

NAMES=(
  "Argentina.jpg" "Australia.jpg" "Bahamas.jpg" "Bali.jpg" "Blacks Beach.jpg"
  "Brazil.jpg" "Brazil2.jpg" "California.jpg" "Chile.jpg" "Chile2.jpg" "Chile3.jpg"
  "Colorado.jpg" "CostaRica.jpg" "Ecuador.jpg" "ElSalvador.jpg" "ElSalvador2.jpg"
  "Fiji.jpg" "France.jpg" "France2.jpg" "France3.jpg" "FrenchPolynesia.jpg"
  "Hawaii.jpg" "Hawaii2.jpg" "Indonesia.jpg" "Indonesia2.jpg" "Indonesia3.jpg"
  "Israel.jpg" "Japan.jpg" "Japan2.jpg" "Japan3.jpg" "Maldives.jpg" "Maldives2.jpg"
  "Massachusetts.jpg" "Mexico.jpg" "Mexico2.jpg" "Mexico3.jpg" "Minnesota.jpg"
  "Morocco.jpg" "Morocco2.jpg" "Morocco3.jpg" "NewZealand.jpg" "NewZealand2.jpg"
  "NewZealand3.jpg" "Nicaragua.jpg" "Nicaragua2.jpg" "Nicaragua3.jpg" "Nicaragua4.jpg"
  "NorthCarolina.jpg" "Panama.jpg" "Panama2.jpg" "Peru.jpg" "Peru2.jpg" "Peru3.jpg"
  "Philippines.jpg" "Portugal.jpg" "Portugal2.jpg" "Portugal3.jpg" "PuertoRico.jpg"
  "SouthAfrica.jpg" "SouthAfrica2.jpg" "Spain.jpg" "SriLanka.jpg" "SriLanka2.jpg"
  "SriLanka3.jpg" "Tahiti.jpg" "Tahiti2.jpg" "UnitedStates.jpg" "Uruguay.jpg"
  "Usa.jpg" "Virginia.jpg" "Washington.jpg"
)

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
ok=0; fail=0
for name in "${NAMES[@]}"; do
  enc="${name// /%20}"
  if curl -fsSL "$SUPA_BASE/$enc" -o "$tmp/obj.jpg" 2>/dev/null; then
    aws s3 cp "$tmp/obj.jpg" "s3://swellyo-images/Countries/$name" \
      --content-type image/jpeg --cache-control "public, max-age=31536000" >/dev/null
    ok=$((ok+1))
  else
    echo "  MISS (Supabase 404?): $name"; fail=$((fail+1))
  fi
done
echo "copied=$ok missed=$fail total=${#NAMES[@]}"
