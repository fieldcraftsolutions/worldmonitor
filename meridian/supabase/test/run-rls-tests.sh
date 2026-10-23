#!/usr/bin/env bash
# Applies supabase/schema.sql to a THROWAWAY local PostgreSQL cluster (with a
# minimal stand-in for Supabase's `auth` schema) and runs supabase/test/rls.sql.
# This proves the schema's RLS/constraints/audit behaviour on real Postgres; it
# does NOT prove anything about a real Supabase project.
#
# Requires PostgreSQL server binaries (initdb, pg_ctl, psql). Works as root by
# running the cluster as the `postgres` OS user.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL server binaries not found (set PGBIN)"; exit 2; }

WORK="$(mktemp -d)"
PORT="${PGPORT:-54329}"
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"; chmod 755 "$WORK"
  AS="runuser -u postgres --"
else
  AS=""
fi
cleanup() { $AS "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
$AS "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres
PSQL="$AS $PGBIN/psql -X -q -v ON_ERROR_STOP=1 -d meridian_test"

$AS "$PGBIN/createdb" meridian_test
$PSQL -f "$HERE/auth_shim.sql"
PGOPTIONS="-c client_min_messages=warning" $PSQL -f "$HERE/../schema.sql"
echo "schema.sql applied cleanly"
# idempotency: the schema must be re-runnable
PGOPTIONS="-c client_min_messages=warning" $PSQL -f "$HERE/../schema.sql" >/dev/null
echo "schema.sql re-applied cleanly (idempotent)"
$PSQL -t -A -f "$HERE/rls.sql" 2>&1 >/dev/null | sed -e "s/^psql:[^ ]* NOTICE:  //" -e "/^$/d"
