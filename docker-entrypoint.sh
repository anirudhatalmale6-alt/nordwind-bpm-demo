#!/bin/sh
set -e

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"

echo "==> waiting for PostgreSQL"
until pg_isready -d "$ADMIN_DATABASE_URL" >/dev/null 2>&1; do sleep 1; done

echo "==> applying migrations"
cd /app/server
node --experimental-strip-types src/db/migrate.ts

# Seed only when the database is empty. Note that this re-fires if the volume is
# ever wiped, which is what you want for a demo and emphatically not what you
# want in production — there, seeding is a one-off deployment step, never
# something the application does on boot.
USERS=$(psql "$ADMIN_DATABASE_URL" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo 0)
if [ "$USERS" = "0" ]; then
  echo "==> seeding demo data"
  node --experimental-strip-types src/db/seed.ts
fi

echo "==> starting API on port ${PORT}"
exec node --experimental-strip-types src/index.ts
