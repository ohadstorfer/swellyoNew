#!/usr/bin/env bash
# loadtest/load.sh
#
# Loads the cleaned schema, the local fix-ups and the fake data into the
# LOCAL database, then writes loadtest/fixtures.json.
#
#   bash loadtest/load.sh             # schema + fixups + seed + fixtures
#   bash loadtest/load.sh --seed-only # fixups + seed + fixtures (schema already in)
#
# Needs: Docker running, `supabase start` done in $LT_DIR,
#        $LT_DIR/schema.local.sql made by prepare-schema.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib.sh"

SCHEMA="${SCHEMA:-$LT_DIR/schema.local.sql}"
C=$(db_container)
echo "Local DB container: $C"

if [ "${1:-}" != "--seed-only" ]; then
  [ -f "$SCHEMA" ] || { echo "Missing $SCHEMA - run prepare-schema.sh first." >&2; exit 1; }
  if grep -q rfdhtvcmagsbxqntnepv "$SCHEMA"; then
    echo "STOP: $SCHEMA mentions the production project. Run prepare-schema.sh." >&2; exit 1
  fi
  echo "1/4 Extensions production uses (so indexes / functions that need them load) ..."
  admin_psql -v ON_ERROR_STOP=0 <<'SQL'
do $$
declare e text;
begin
  foreach e in array array['pg_trgm','pgcrypto','uuid-ossp','pg_stat_statements','pg_net'] loop
    begin
      execute format('create extension if not exists %I with schema extensions', e);
    exception when others then raise notice 'extension % not created: %', e, sqlerrm;
    end;
  end loop;
  begin
    create extension if not exists pg_cron;
  exception when others then raise notice 'pg_cron not created: %', sqlerrm;
  end;
end $$;
SQL
  echo "    Loading schema (errors go to $LT_DIR/schema-load.log) ..."
  # Not ON_ERROR_STOP: a dump of a hosted project always has a few lines that
  # fail locally (things that already exist, owner/grant lines for hosted-only
  # roles). We check that the important tables exist right after.
  admin_psql -v ON_ERROR_STOP=0 < "$SCHEMA" > "$LT_DIR/schema-load.log" 2>&1 || true
  errs=$(grep -c 'ERROR' "$LT_DIR/schema-load.log" || true)
  echo "    $errs ERROR line(s). Most common harmless ones: 'already exists', 'role ... does not exist'."
  grep 'ERROR' "$LT_DIR/schema-load.log" | sort | uniq -c | sort -rn | head -15 || true
  missing=$(admin_psql -At -c "
    select string_agg(t, ', ') from unnest(array[
      'users','surfers','group_trips','group_trip_participants','group_trip_join_requests',
      'conversations','conversation_members','messages','notifications',
      'organized_trip_requirements','organized_trip_payment_events']) t
    where to_regclass('public.' || t) is null")
  if [ -n "$missing" ]; then
    echo "STOP: tables missing after schema load: $missing (read $LT_DIR/schema-load.log)" >&2
    exit 1
  fi
else
  echo "1/4 Skipping schema (--seed-only)"
fi

echo "2/4 Local fix-ups (drop webhooks, realtime policies, role timeouts, prod-URL check) ..."
admin_psql -v ON_ERROR_STOP=1 < "$HERE/local-fixups.sql"

echo "3/4 Seeding fake data ..."
admin_psql -v ON_ERROR_STOP=1 < "$HERE/seed.sql"

echo "4/4 Writing $HERE/fixtures.json ..."
admin_psql -v ON_ERROR_STOP=1 -At < "$HERE/export-fixtures.sql" > "$HERE/fixtures.json"
node -e "const a=require(process.argv[1]);console.log('    '+a.length+' fake users in fixtures.json')" "$HERE/fixtures.json"

echo "Done. Next: JWT_SECRET=... node loadtest/mint-tokens.js"
