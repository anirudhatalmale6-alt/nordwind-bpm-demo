/**
 * The reaper. Run from cron, not from a request handler.
 *
 * A soft-deleted document keeps its blob for a grace period, then this removes
 * the file and stamps blob_removed_at. The row itself is never deleted: the
 * fact that a document existed, who attached it and who removed it is part of
 * the record, and losing that is worse than keeping a few dead rows.
 *
 *   node --experimental-strip-types src/db/reap-documents.ts [--grace-days 30] [--dry-run]
 *
 * It connects with ADMIN_DATABASE_URL rather than the application's own
 * credentials, because the application role deliberately cannot delete
 * anything. Destructive maintenance runs as a different identity, on purpose.
 */
import pg from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import type { DB } from './types.ts'
import { removeBlob, safeJoin } from '../core/storage.ts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const graceIdx = args.indexOf('--grace-days')
const graceDays = graceIdx === -1 ? 30 : Number(args[graceIdx + 1] ?? 30)

if (!Number.isFinite(graceDays) || graceDays < 0) {
  console.error('--grace-days must be a non-negative number')
  process.exit(1)
}

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://bpm@127.0.0.1:5439/bpm_demo'
pg.types.setTypeParser(1700, (v) => v)
pg.types.setTypeParser(20, (v) => v)

const pool = new pg.Pool({ connectionString: adminUrl })
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })

const cutoff = new Date(Date.now() - graceDays * 24 * 3600 * 1000)

const due = await db
  .selectFrom('documents')
  .select(['id', 'original_filename', 'storage_path', 'deleted_at'])
  .where('deleted_at', 'is not', null)
  .where('deleted_at', '<', cutoff)
  .where('blob_removed_at', 'is', null)
  .execute()

console.log(
  `${due.length} document(s) soft-deleted before ${cutoff.toISOString()} (grace ${graceDays} days)`,
)

let removed = 0
let missing = 0

for (const doc of due) {
  // safeJoin refuses anything that resolves outside the storage root. The path
  // came out of the database and a path out of the database is data, not a
  // promise — this is the one place in the system that unlinks a file, and it
  // is the place that check matters most.
  let target: string
  try {
    target = safeJoin(doc.storage_path)
  } catch (err) {
    console.error(`  ! refusing document ${doc.id}: ${(err as Error).message}`)
    continue
  }

  if (dryRun) {
    console.log(`  would remove ${target} ("${doc.original_filename}")`)
    continue
  }

  try {
    await removeBlob(doc.storage_path)
    removed++
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Already gone. Still stamp the row, so it stops being re-examined.
      missing++
    } else {
      console.error(`  ! ${doc.id} ${doc.original_filename}: ${(err as Error).message}`)
      continue
    }
  }

  await db
    .updateTable('documents')
    .set({ blob_removed_at: new Date() })
    .where('id', '=', doc.id)
    .execute()
}

console.log(dryRun ? 'dry run, nothing changed' : `${removed} removed, ${missing} already absent`)

await db.destroy()
