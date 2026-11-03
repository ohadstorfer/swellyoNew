# loadtest/lib.sh - shared helpers. Sourced by the other scripts, not run.
#
# Everything here talks to the LOCAL Docker database only (docker exec into
# the supabase_db_* container). Nothing here can reach production.

# Throwaway Supabase project folder (NOT the repo's supabase/ folder).
LT_DIR="${LT_DIR:-/tmp/swellyo-loadtest}"

# Name of the local Postgres container started by `supabase start`.
db_container() {
  local names count
  names=$(docker ps --filter 'name=^supabase_db_' --format '{{.Names}}')
  count=$(printf '%s\n' "$names" | grep -c . || true)
  if [ "$count" -ne 1 ]; then
    echo "Expected exactly 1 running supabase_db_* container, found $count:" >&2
    printf '%s\n' "$names" >&2
    echo "Run 'supabase start' in $LT_DIR (and stop other local Supabase projects)." >&2
    return 1
  fi
  printf '%s' "$names"
}

# psql inside the container as a superuser. Extra args go to psql.
# Local defaults: user supabase_admin, password postgres.
admin_psql() {
  docker exec -i -e PGPASSWORD="${PGADMIN_PASSWORD:-postgres}" "$(db_container)" \
    psql -X -q -h 127.0.0.1 -U "${PGADMIN_USER:-supabase_admin}" -d postgres "$@"
}

wait_for_db() {
  local c i
  c=$(db_container) || return 1
  for i in $(seq 1 60); do
    if docker exec "$c" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Database did not come back within 60 s." >&2
  return 1
}
