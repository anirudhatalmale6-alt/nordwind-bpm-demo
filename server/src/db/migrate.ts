/**
 * Migrations are numbered, forward-only SQL files applied by an explicit
 * command. They are never applied automatically at application boot.
 *
 * Reason: I have cleaned up after an app that ran its schema sync on startup
 * and then had four worker processes boot simultaneously and race each other to
 * create the same tables. Schema change is a deliberate, single-threaded
 * deployment step, run once, by a human or by the deploy script — not by
 * whichever process happens to win.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'migrations')

const adminUrl =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://bpm@127.0.0.1:5439/bpm_demo'

const client = new pg.Client({ connectionString: adminUrl })
await client.connect()

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`)

const applied = new Set(
  (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
    (r) => r.filename,
  ),
)

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

let count = 0
for (const file of files) {
  if (applied.has(file)) continue
  const sql = readFileSync(join(dir, file), 'utf8')
  process.stdout.write(`applying ${file} ... `)
  // Each migration runs in its own transaction: it either lands completely or
  // not at all, so a half-migrated schema is not a state you can end up in.
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
    await client.query('COMMIT')
    console.log('ok')
    count++
  } catch (err) {
    await client.query('ROLLBACK')
    console.log('FAILED')
    console.error(err)
    process.exit(1)
  }
}

console.log(count === 0 ? 'schema already up to date' : `${count} migration(s) applied`)
await client.end()
