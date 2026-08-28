import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/db.ts'
import { requirePermission } from '../core/auth.ts'

export function metaRoutes(app: FastifyInstance, db: Db) {
  /**
   * The live role/permission matrix, read out of the database rather than
   * hard-coded — because that is where it actually lives. In the full system
   * this screen is editable by an administrator, and granting a permission is a
   * checkbox rather than a deployment.
   */
  app.get(
    '/api/meta/roles',
    { config: { permission: 'project.read' }, preHandler: requirePermission('project.read') },
    async () => {
      const roles = await db
        .selectFrom('roles')
        .select(['id', 'key', 'name', 'description'])
        .orderBy('id')
        .execute()

      const perms = await db
        .selectFrom('permissions')
        .select(['id', 'key', 'description'])
        .orderBy('key')
        .execute()

      const links = await db.selectFrom('role_permissions').select(['role_id', 'permission_id']).execute()

      const held = new Map<number, Set<number>>()
      for (const l of links) {
        if (!held.has(l.role_id)) held.set(l.role_id, new Set())
        held.get(l.role_id)!.add(l.permission_id)
      }

      return {
        roles: roles.map((r) => ({
          ...r,
          permissions: perms.filter((p) => held.get(r.id)?.has(p.id)).map((p) => p.key),
        })),
        permissions: perms,
      }
    },
  )
}
