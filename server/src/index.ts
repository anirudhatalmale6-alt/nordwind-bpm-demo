import { buildApp } from './app.ts'
import { makeDb, makePool } from './db/db.ts'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://bpm_app:demo_app_password_not_a_real_secret@127.0.0.1:5439/bpm_demo'

const port = Number(process.env.PORT ?? 8140)
const host = process.env.HOST ?? '0.0.0.0'

const pool = makePool(connectionString)
const db = makeDb(pool)
const app = buildApp(db)

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await db.destroy()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ port, host })
  app.log.info(`bpm demo listening on ${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
