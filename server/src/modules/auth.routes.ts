import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Db } from '../db/db.ts'
import { hashPassword, hashToken, newSessionToken, verifyPassword } from '../core/password.ts'
import { SESSION_COOKIE, SESSION_TTL_HOURS } from '../core/auth.ts'
import { writeAudit } from '../core/audit.ts'

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export function authRoutes(app: FastifyInstance, db: Db) {
  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() })
    }
    const { email, password } = parsed.data

    const user = await db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select(['users.id', 'users.password_hash', 'users.is_active', 'users.full_name', 'roles.name as role_name'])
      .where('users.email', '=', email.toLowerCase())
      .executeTakeFirst()

    // Same response and roughly the same work whether the user exists or not,
    // so the endpoint cannot be used to enumerate valid addresses.
    const hash = user?.password_hash ?? (await hashPassword('placeholder'))
    const ok = await verifyPassword(password, hash)

    if (!user || !ok || !user.is_active) {
      await db.transaction().execute(async (trx) => {
        await writeAudit(
          trx,
          { userId: user?.id ?? null, ip: req.ip, requestId: req.id },
          {
            entityType: 'auth',
            entityId: email,
            action: 'auth.login_failed',
            summary: `Failed login attempt for ${email}`,
          },
        )
      })
      return reply.code(401).send({ error: 'invalid_credentials' })
    }

    const token = newSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000)

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('sessions')
        .values({
          id: hashToken(token), // stored hashed — a database dump yields no usable tokens
          user_id: user.id,
          expires_at: expiresAt,
          user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300),
          ip: req.ip,
        })
        .execute()

      await writeAudit(
        trx,
        { userId: user.id, ip: req.ip, requestId: req.id },
        {
          entityType: 'auth',
          entityId: user.id,
          action: 'auth.login',
          summary: `${user.full_name} signed in as ${user.role_name}`,
        },
      )
    })

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
      sameSite: 'strict', // blocks cross-site request forgery on state changes
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: SESSION_TTL_HOURS * 3600,
    })

    return { ok: true }
  })

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) {
      // Server-side session, so revocation is immediate. A stateless JWT cannot
      // be withdrawn before it expires.
      await db.deleteFrom('sessions').where('id', '=', hashToken(token)).execute()
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', { config: { public: true } }, async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'not_authenticated' })
    return {
      user: {
        id: req.auth.userId,
        email: req.auth.email,
        full_name: req.auth.fullName,
        job_title: req.auth.jobTitle,
        role_key: req.auth.roleKey,
        role_name: req.auth.roleName,
      },
      permissions: [...req.auth.perms].sort(),
    }
  })
}
