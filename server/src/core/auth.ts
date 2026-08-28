import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from '../db/db.ts'
import { hashToken } from './password.ts'
import type { PermissionKey } from './permissions.ts'

export const SESSION_COOKIE = 'bpm_session'
export const SESSION_TTL_HOURS = 12

export interface AuthContext {
  userId: number
  email: string
  fullName: string
  jobTitle: string
  roleKey: string
  roleName: string
  perms: Set<string>
  /** Projects this user is assigned to. Empty set means "all" for management. */
  projectIds: Set<number>
  scopeAllProjects: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
    requestId2: string
  }
  interface FastifyContextConfig {
    /** Permission required to reach this route. */
    permission?: PermissionKey
    /** Explicitly unauthenticated (login, health). Must be stated, not omitted. */
    public?: true
  }
}

export async function loadAuth(db: Db, token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'sessions.id as sid',
      'sessions.expires_at as expires_at',
      'users.id as user_id',
      'users.email as email',
      'users.full_name as full_name',
      'users.job_title as job_title',
      'users.is_active as is_active',
      'roles.key as role_key',
      'roles.name as role_name',
      'roles.id as role_id',
    ])
    .where('sessions.id', '=', hashToken(token))
    .executeTakeFirst()

  if (!row) return null
  if (!row.is_active) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null

  const permRows = await db
    .selectFrom('role_permissions')
    .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select('permissions.key as key')
    .where('role_permissions.role_id', '=', row.role_id)
    .execute()

  const assignments = await db
    .selectFrom('project_assignments')
    .select('project_id')
    .where('user_id', '=', row.user_id)
    .execute()

  const perms = new Set(permRows.map((p) => p.key))

  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    jobTitle: row.job_title,
    roleKey: row.role_key,
    roleName: row.role_name,
    perms,
    projectIds: new Set(assignments.map((a) => a.project_id)),
    // Row-level scoping. Management sees every project; everyone else sees the
    // projects they are assigned to. In the full system this is mirrored by a
    // PostgreSQL RLS policy as a second net — with SET LOCAL inside the
    // transaction, never SET, because a pooled connection hands the previous
    // request's setting to the next one after the commit.
    scopeAllProjects: perms.has('admin.users'),
  }
}

export function requirePermission(permission: PermissionKey) {
  return async function guard(req: FastifyRequest, reply: FastifyReply) {
    if (!req.auth) {
      return reply.code(401).send({ error: 'not_authenticated' })
    }
    if (!req.auth.perms.has(permission)) {
      return reply.code(403).send({
        error: 'forbidden',
        required_permission: permission,
        message: `Your role (${req.auth.roleName}) does not hold ${permission}.`,
      })
    }
  }
}

/**
 * Boot-time assertion: every registered route must declare either a required
 * permission or `public: true`.
 *
 * Without this, shipping a new endpoint and forgetting the guard is a one-line
 * mistake that nothing catches until someone finds the data. With it, the
 * server refuses to start. I would rather fail a deploy than leak a margin.
 */
export function assertEveryRouteIsGuarded(app: FastifyInstance): void {
  const unguarded: string[] = []

  app.addHook('onRoute', (route) => {
    if (route.method === 'HEAD' || route.method === 'OPTIONS') return
    // Only the API surface is in scope. The static handler that serves the
    // built React bundle is public by definition — the bundle contains no data,
    // and every figure it displays came from a guarded endpoint.
    if (!route.url.startsWith('/api/')) return
    const cfg = (route.config ?? {}) as { permission?: string; public?: boolean }
    if (!cfg.permission && !cfg.public) {
      unguarded.push(`${route.method} ${route.url}`)
    }
  })

  app.addHook('onReady', async () => {
    if (unguarded.length > 0) {
      throw new Error(
        `Refusing to start: ${unguarded.length} route(s) declare neither a permission nor public:true —\n  ` +
          unguarded.join('\n  '),
      )
    }
  })
}
