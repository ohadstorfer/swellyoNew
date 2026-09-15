#!/bin/sh
set -e
B=build
OUT=mockup.html
{
  cat $B/01-head.html
  cat $B/02-css2.html
  echo '<div class="app" id="app"></div>'
  echo '<script>'
  for f in 03-data.js 04-engine.js 05-shell.js 06-trips.js 07-builder.js 08-money.js 09-crm.js 10-traveller.js 11-actions.js 12-boot.js; do
    cat $B/$f
    echo ''
  done
  echo '</script>'
} > $OUT
echo "built $OUT — $(wc -l < $OUT) lines, $(du -h $OUT | cut -f1)"
