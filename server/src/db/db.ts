import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { DB } from './types.ts'

/**
 * node-postgres parses NUMERIC as a JavaScript string by default (type 1700).
 * That is the behaviour we want and we make it explicit here, because a helpful
 * future contributor "fixing" this to return numbers would silently introduce
 * floating-point error into every money figure in the system.
 */
pg.types.setTypeParser(1700, (v) => v)
pg.types.setTypeParser(20, (v) => v) // int8 — also a string, avoids precision loss

export function makePool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // The app connects as bpm_app, which has no UPDATE/DELETE on audit_log.
    application_name: 'bpm-demo',
  })
}

export function makeDb(pool: pg.Pool): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })
}

export type Db = Kysely<DB>
