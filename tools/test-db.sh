#!/usr/bin/env bash
# SQL tests (supabase/tests/*.test.sql) on a scratch local database: plain Postgres with stand-ins for the Supabase
# parts (supabase/tests/stubs.sql), every migration and the seed, then each test file. A test file raises an exception to fail.
# Needs Postgres 15+ server binaries (initdb, pg_ctl) and psql; no Docker. Never point it at a shop's project:
# it only ever talks to the throwaway cluster it starts here, which is deleted afterwards.
#
#   tools/test-db.sh                      # every test file
#   tools/test-db.sh pull_import          # just supabase/tests/pull_import.test.sql
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
PORT=${PORT:-54331}
DIR=$(mktemp -d /var/tmp/pullwise-db-test.XXXXXX)
RUN=()
if [[ $(id -u) == 0 ]]; then chown postgres "$DIR"; RUN=(su postgres -c); fi
run() { if ((${#RUN[@]})); then "${RUN[@]}" "$*"; else bash -c "$*"; fi; }
cleanup() { run "$BIN/pg_ctl -D $DIR/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

run "$BIN/initdb -D $DIR/data -A trust -U postgres" >/dev/null
run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=' -l $DIR/log -w start" >/dev/null
db() { psql -X -q -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

db -f "$ROOT/supabase/tests/stubs.sql" >/dev/null
echo "Applying migrations…"
for f in "$ROOT"/supabase/migrations/*.sql; do
  # pg_cron and pg_net are stubbed, not installed.
  sed -E 's/^create extension if not exists (pg_cron|pg_net)\b.*;$/-- (stubbed) &/I' "$f" | db -f - >/dev/null 2>"$DIR/err" || {
    echo "Migration failed: $(basename "$f")"; cat "$DIR/err"; exit 1; }
done
db -f "$ROOT/supabase/seed.sql" >/dev/null

status=0
for t in "$ROOT"/supabase/tests/${1:-*}.test.sql; do
  if db -f "$t" >"$DIR/out" 2>&1; then
    echo "ok   $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"; cat "$DIR/out"; status=1
  fi
done
exit $status
