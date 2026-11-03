#!/usr/bin/env bash
# loadtest/limit-db.sh
#
# Makes the LOCAL Postgres container look like the production database size.
#
#   bash loadtest/limit-db.sh micro   # 1 GB RAM, 2 CPUs  (production since 21 Oct 17:12 UTC)
#   bash loadtest/limit-db.sh nano    # 0.5 GB RAM, 2 CPUs (production during the 21 Oct outage)
#   bash loadtest/limit-db.sh show    # print current limits + settings
#
# It restarts the DB container (about 5-10 s). PostgREST / GoTrue / Realtime
# reconnect by themselves. To remove the limits: `supabase stop` then
# `supabase start` in $LT_DIR (that recreates the containers; the data stays).
# The ALTER SYSTEM settings stay too - run this script again to change them.
#
# Postgres settings below were read from production (pg_settings, read-only)
# on 21 Oct 2026, AFTER the move to Micro:
#   shared_buffers 256MB, max_connections 60, work_mem 3500kB,
#   maintenance_work_mem 64MB, effective_cache_size 768MB,
#   max_worker_processes 6, max_parallel_workers 2,
#   max_parallel_workers_per_gather 1, random_page_cost 1.1,
#   effective_io_concurrency 200, statement_timeout 120s (database default;
#   the authenticated role has 8s - set in local-fixups.sql).
# For Nano we only know shared_buffers was 224MB (from the incident notes).
# ASSUMPTION: every other Nano setting = Micro, except effective_cache_size
# which we halve to 384MB.
#
# Limits only the DB container. In production, PostgREST, GoTrue and the
# API gateway share the same machine and its RAM, so this is a little
# kinder than production.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SIZE="${1:-micro}"
C=$(db_container)

show() {
  docker inspect "$C" --format 'container {{.Name}}: memory={{.HostConfig.Memory}} bytes, memory+swap={{.HostConfig.MemorySwap}}, cpus(nano)={{.HostConfig.NanoCpus}}'
  admin_psql -At -c "select name || ' = ' || setting || coalesce(' ' || unit, '') from pg_settings
    where name in ('shared_buffers','max_connections','work_mem','maintenance_work_mem',
      'effective_cache_size','max_worker_processes','max_parallel_workers',
      'max_parallel_workers_per_gather','random_page_cost','effective_io_concurrency',
      'statement_timeout') order by name"
  admin_psql -At -c "select 'role ' || rolname || ': ' || array_to_string(rolconfig, ', ')
    from pg_roles where rolname in ('authenticated','anon','authenticator')"
}

case "$SIZE" in
  micro) MEM=1g;    SWAP_TOTAL=2g;    SB=256MB; ECS=768MB ;;
  nano)  MEM=512m;  SWAP_TOTAL=1536m; SB=224MB; ECS=384MB ;;
  show)  show; exit 0 ;;
  *) echo "Usage: $0 micro|nano|show" >&2; exit 1 ;;
esac

echo "Container $C -> $SIZE: memory $MEM (+ up to 1 GB swap), 2 CPUs"
# memory-swap = RAM + swap. Production swapped ~900 MB during the outage, so
# we allow 1 GB of swap. Docker Desktop's VM must have swap enabled
# (Settings -> Resources -> Swap, default 1 GB) for this to matter.
docker update --cpus 2 --memory "$MEM" --memory-swap "$SWAP_TOTAL" "$C" >/dev/null

admin_psql -v ON_ERROR_STOP=1 <<SQL
alter system set shared_buffers = '$SB';
alter system set effective_cache_size = '$ECS';
alter system set max_connections = 60;
alter system set work_mem = '3500kB';
alter system set maintenance_work_mem = '64MB';
alter system set max_worker_processes = 6;
alter system set max_parallel_workers = 2;
alter system set max_parallel_workers_per_gather = 1;
alter system set random_page_cost = 1.1;
alter system set effective_io_concurrency = 200;
alter system set statement_timeout = '120s';
SQL

echo "Restarting the DB container so the settings apply ..."
docker restart "$C" >/dev/null
wait_for_db
show
