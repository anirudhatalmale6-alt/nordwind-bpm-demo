import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import type { Db } from '../db/db.ts'
import { requirePermission } from '../core/auth.ts'

export function auditRoutes(app: FastifyInstance, db: Db) {
  app.get(
    '/api/audit',
    { config: { permission: 'audit.read' }, preHandler: requirePermission('audit.read') },
    async (req) => {
      const q = req.query as { entity_type?: string; action?: string; limit?: string }
      let query = db
        .selectFrom('audit_log')
        .leftJoin('users', 'users.id', 'audit_log.actor_user_id')
        .leftJoin('roles', 'roles.id', 'users.role_id')
        .select([
          'audit_log.id',
          'audit_log.at',
          'audit_log.action',
          'audit_log.entity_type',
          'audit_log.entity_id',
          'audit_log.summary',
          'audit_log.diff',
          'audit_log.context',
          'audit_log.actor_ip',
          'users.full_name as actor_name',
          'roles.name as actor_role',
        ])
        .orderBy('audit_log.at', 'desc')
        .orderBy('audit_log.id', 'desc')
        .limit(Math.min(Number(q.limit ?? 100) || 100, 500))

      if (q.entity_type) query = query.where('audit_log.entity_type', '=', q.entity_type)
      if (q.action) query = query.where('audit_log.action', '=', q.action)

      return { entries: await query.execute() }
    },
  )

  /**
   * Append-only, demonstrated rather than asserted.
   *
   * This endpoint asks the database to modify an audit row, using the same
   * connection and the same role the application uses for everything else. It
   * is expected to fail, and the raw PostgreSQL error is returned so you can
   * read it yourself. The guarantee is a GRANT, not a promise in a document or
   * a comment in my code — bpm_app simply has no UPDATE or DELETE on that
   * table, so a bug in the application cannot rewrite history.
   */
  app.post(
    '/api/audit/tamper-test',
    { config: { permission: 'audit.read' }, preHandler: requirePermission('audit.read') },
    async () => {
      const target = await db
        .selectFrom('audit_log')
        .select(['id', 'summary'])
        .orderBy('id', 'desc')
        .executeTakeFirst()

      if (!target) return { attempts: [], note: 'No audit rows to test against.' }

      const attempts: Array<{ statement: string; result: string; error: string | null }> = []

      for (const [label, statement] of [
        ['UPDATE', `UPDATE audit_log SET summary = 'tampered' WHERE id = ${target.id}`],
        ['DELETE', `DELETE FROM audit_log WHERE id = ${target.id}`],
      ] as const) {
        try {
          await sql.raw(statement).execute(db)
          attempts.push({
            statement,
            result: `${label} SUCCEEDED — this is a failure of the demo, the grants are wrong`,
            error: null,
          })
        } catch (err) {
          attempts.push({
            statement,
            result: `${label} refused by PostgreSQL`,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const after = await db
        .selectFrom('audit_log')
        .select(['id', 'summary'])
        .where('id', '=', target.id)
        .executeTakeFirst()

      return {
        connected_as: process.env.DATABASE_URL?.split('://')[1]?.split(':')[0] ?? 'bpm_app',
        target_row: target,
        attempts,
        row_after: after,
        note:
          'The application connects as bpm_app, which is granted SELECT and INSERT on audit_log ' +
          'and deliberately not UPDATE or DELETE. See migration 002_app_role.sql.',
      }
    },
  )
}
