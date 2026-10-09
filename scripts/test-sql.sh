#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres 16 and runs supabase/tests/sql/*.test.sql.
# Requirements: Postgres 16 server binaries (initdb, pg_ctl, postgres, psql).
# Supabase-only extensions (pgmq, pg_cron, pg_net, supabase_vault) are replaced by test stubs
# from supabase/tests/harness/fake-extensions when the real ones are not installed.
#
# Usage: npm run test:sql            (all tests)
#        npm run test:sql -- alerts  (only test files whose name contains "alerts")
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILTER="${1:-}"
PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  if command -v pg_config >/dev/null 2>&1 && [[ -x "$(pg_config --bindir)/initdb" ]]; then
    PG_BIN="$(pg_config --bindir)"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
fi
[[ -x "$PG_BIN/initdb" ]] || { echo "Postgres server binaries not found. Set PG_BIN." >&2; exit 2; }

SHAREDIR="$("$PG_BIN/pg_config" --sharedir 2>/dev/null || pg_config --sharedir)"
for ext in pgmq pg_cron pg_net supabase_vault; do
  if [[ ! -f "$SHAREDIR/extension/$ext.control" ]]; then
    if [[ -w "$SHAREDIR/extension" ]]; then
      cp "$ROOT/supabase/tests/harness/fake-extensions/$ext.control" "$ROOT/supabase/tests/harness/fake-extensions/$ext--0.0.1.sql" "$SHAREDIR/extension/"
    else
      echo "Extension $ext is missing and $SHAREDIR/extension is not writable. Run once with sudo or install the extension." >&2
      exit 2
    fi
  fi
done

RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then RUN_AS=(runuser -u postgres --); fi

WORK="$(mktemp -d /tmp/upvane-sql.XXXXXX)"
chmod 755 "$WORK"
if [[ "$(id -u)" == "0" ]]; then chown postgres "$WORK"; fi
PORT="${PG_TEST_PORT:-54329}"

cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -o "-k $WORK -p $PORT -c listen_addresses='' -c fsync=off" -w start >/dev/null

PSQL=("${RUN_AS[@]}" "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

echo "▸ Supabase stubs"
"${PSQL[@]}" -f "$ROOT/supabase/tests/harness/00_supabase_stubs.sql"

SEEDED=0
for migration in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  # Seed pre-v2 data right before the first v2 migration so the upgrade path is exercised.
  if [[ "$SEEDED" == "0" && "$name" > "20261009" ]]; then
    echo "▸ legacy seed"
    "${PSQL[@]}" -f "$ROOT/supabase/tests/harness/legacy_seed.sql"
    SEEDED=1
  fi
  echo "▸ $name"
  "${PSQL[@]}" -f "$migration"
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/harness/01_test_helpers.sql"

FAILED=0
PASSED=0
shopt -s nullglob
for test in "$ROOT"/supabase/tests/sql/*.test.sql; do
  name="$(basename "$test")"
  if [[ -n "$FILTER" && "$name" != *"$FILTER"* ]]; then continue; fi
  if "${PSQL[@]}" -o /dev/null -f "$test" >"$WORK/out.txt" 2>&1; then
    PASSED=$((PASSED + 1))
    echo "  ✓ $name"
  else
    FAILED=$((FAILED + 1))
    echo "  ✗ $name"
    sed 's/^/      /' "$WORK/out.txt"
  fi
done

echo
echo "SQL tests: $PASSED passed, $FAILED failed"
[[ "$FAILED" == "0" ]]
