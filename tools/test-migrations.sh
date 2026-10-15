#!/usr/bin/env bash
# Applies every migration and the seed to a blank Supabase database, the way a new shop is installed, then
# pushes again to check it's a no-op. Needs Docker and the Supabase CLI (or npx). Run from anywhere:
#
#   tools/test-migrations.sh
#
# Uses Supabase's own Postgres image, so roles, auth, vault, pg_cron and pg_net match a hosted project.
set -euo pipefail

IMAGE=${SUPABASE_PG_IMAGE:-supabase/postgres:15.8.1.085}
PORT=${PORT:-54329}
NAME=pullwise-migration-test
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SUPABASE=${SUPABASE:-$(command -v supabase || echo "npx --yes supabase@2")}
DB_URL="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres?sslmode=disable"

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "$PORT:5432" "$IMAGE" >/dev/null

as_admin() { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -w -h 127.0.0.1 -v ON_ERROR_STOP=1 -q -U supabase_admin -d postgres "$@"; }
for _ in $(seq 1 60); do as_admin -c 'select 1' >/dev/null 2>&1 && break; sleep 2; done
sleep 3 # the image restarts once while it finishes its own setup
for _ in $(seq 1 30); do as_admin -c 'select 1' >/dev/null 2>&1 && break; sleep 2; done

# A hosted project's storage service adds these columns itself; the image has only the bare schema.
as_admin <<'SQL'
alter table storage.buckets
  add column if not exists public boolean default false,
  add column if not exists file_size_limit bigint,
  add column if not exists allowed_mime_types text[];
SQL

cd "$ROOT"
echo "Applying migrations and seed to a blank database…"
$SUPABASE db push --include-seed --yes --db-url "$DB_URL"
echo "Pushing again (should change nothing)…"
out=$($SUPABASE db push --include-seed --yes --db-url "$DB_URL" 2>&1)
echo "$out" | tail -1
echo "$out" | grep -qi 'up to date' || { echo "Second push wasn't a no-op"; exit 1; }

jobs=$(as_admin -Atc "select string_agg(jobname, ',' order by jobname) from cron.job")
echo "Scheduled jobs: $jobs"
for j in apply-subscriptions arrival-email flip-item-statuses weekly-pull-list; do
  [[ ",$jobs," == *",$j,"* ]] || { echo "Missing scheduled job: $j"; exit 1; }
done
rm -rf supabase/.temp
echo "migrations ok on a blank Supabase database"
