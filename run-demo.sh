#!/usr/bin/env bash
#
# Run the demo on a machine with Node.js 22+ and the PostgreSQL 16 binaries
# installed. Nothing is installed system-wide and nothing needs root: the
# script initialises its own PostgreSQL cluster inside this directory, on a
# non-standard port, and leaves any PostgreSQL you already have alone.
#
#   ./run-demo.sh          start (initialises on first run)
#   ./run-demo.sh stop     stop the app and the database
#   ./run-demo.sh reset    wipe and reseed the demo data
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGDATA="$ROOT/.pgdata"
PGPORT="${PGPORT:-5439}"
APP_PORT="${PORT:-8140}"
LOGDIR="$ROOT/.logs"
mkdir -p "$LOGDIR"

# Find the PostgreSQL server binaries. They are not usually on PATH — only the
# client tools are — so look in the usual places before giving up.
find_pg_bin() {
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return; fi
  for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@16/bin \
           /usr/local/opt/postgresql@16/bin /Library/PostgreSQL/*/bin; do
    [ -x "$d/initdb" ] && { echo "$d"; return; }
  done
  echo ""
}

PGBIN="$(find_pg_bin)"
if [ -z "$PGBIN" ]; then
  echo "Could not find the PostgreSQL server binaries (initdb, pg_ctl)."
  echo "On Debian/Ubuntu:  sudo apt install postgresql-16"
  echo "On macOS:          brew install postgresql@16"
  echo "Or use the Docker route instead:  docker compose up"
  exit 1
fi
export PATH="$PGBIN:$PATH"

ADMIN_URL="postgresql://bpm@127.0.0.1:$PGPORT/bpm_demo"
APP_URL="postgresql://bpm_app:demo_app_password_not_a_real_secret@127.0.0.1:$PGPORT/bpm_demo"

stop_all() {
  if [ -f "$LOGDIR/app.pid" ]; then
    kill "$(cat "$LOGDIR/app.pid")" 2>/dev/null || true
    rm -f "$LOGDIR/app.pid"
  fi
  [ -d "$PGDATA" ] && pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  echo "stopped."
}

case "${1:-start}" in
  stop) stop_all; exit 0 ;;
  reset)
    node --experimental-strip-types server/src/db/seed.ts
    psql -h 127.0.0.1 -p "$PGPORT" -U bpm -d bpm_demo -c "SELECT setval('po_ref_seq', 316, false);" >/dev/null
    echo "demo data reset."
    exit 0
    ;;
esac

# ----- database --------------------------------------------------------------

if [ ! -d "$PGDATA" ]; then
  echo "==> initialising a PostgreSQL cluster in .pgdata (first run only)"
  initdb -D "$PGDATA" -U bpm --auth=trust --encoding=UTF8 --locale=C >"$LOGDIR/initdb.log" 2>&1
fi

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "==> starting PostgreSQL on port $PGPORT"
  pg_ctl -D "$PGDATA" \
    -o "-p $PGPORT -k $PGDATA -c listen_addresses=127.0.0.1" \
    -l "$LOGDIR/postgres.log" start >/dev/null
  sleep 2
fi

if ! psql -h 127.0.0.1 -p "$PGPORT" -U bpm -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw bpm_demo; then
  echo "==> creating database bpm_demo"
  createdb -h 127.0.0.1 -p "$PGPORT" -U bpm bpm_demo
fi

# ----- dependencies ----------------------------------------------------------

if [ ! -d "$ROOT/server/node_modules" ]; then
  echo "==> installing server dependencies"
  (cd "$ROOT/server" && npm install --no-audit --no-fund >"$LOGDIR/npm-server.log" 2>&1)
fi

if [ ! -d "$ROOT/web/node_modules" ]; then
  echo "==> installing web dependencies"
  (cd "$ROOT/web" && npm install --no-audit --no-fund >"$LOGDIR/npm-web.log" 2>&1)
fi

# ----- schema and data -------------------------------------------------------

echo "==> applying migrations"
(cd "$ROOT/server" && ADMIN_DATABASE_URL="$ADMIN_URL" node --experimental-strip-types src/db/migrate.ts)

USERS=$(psql -h 127.0.0.1 -p "$PGPORT" -U bpm -d bpm_demo -tAc "SELECT count(*) FROM users" 2>/dev/null || echo 0)
if [ "$USERS" = "0" ]; then
  echo "==> seeding demo data"
  (cd "$ROOT/server" && ADMIN_DATABASE_URL="$ADMIN_URL" node --experimental-strip-types src/db/seed.ts)
fi

# ----- build and run ---------------------------------------------------------

if [ ! -f "$ROOT/web/dist/index.html" ]; then
  echo "==> building the React app"
  (cd "$ROOT/web" && npm run build >"$LOGDIR/web-build.log" 2>&1)
fi

echo "==> starting the API on port $APP_PORT"
(cd "$ROOT/server" && DATABASE_URL="$APP_URL" PORT="$APP_PORT" \
  node --experimental-strip-types src/index.ts >"$LOGDIR/app.log" 2>&1 &
  echo $! > "$LOGDIR/app.pid")

sleep 3
if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
  echo
  echo "  Nordwind BPM demo is running:  http://localhost:$APP_PORT"
  echo
  echo "  anna.meyer@nordwind-demo.com    Management  — sees cost, revenue, margin"
  echo "  ravi.kumar@nordwind-demo.com    Purchasing  — sees cost only"
  echo "  maria.santos@nordwind-demo.com  Logistics   — sees no prices at all"
  echo "  password for all three: demo1234"
  echo
  echo "  logs: $LOGDIR/app.log        stop: ./run-demo.sh stop"
else
  echo "The API did not come up. Last lines of $LOGDIR/app.log:"
  tail -20 "$LOGDIR/app.log"
  exit 1
fi
