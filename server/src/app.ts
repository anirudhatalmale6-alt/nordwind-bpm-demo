import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEveryRouteIsGuarded, loadAuth, SESSION_COOKIE } from './core/auth.ts'
import type { Db } from './db/db.ts'
import { authRoutes } from './modules/auth.routes.ts'
import { projectRoutes } from './modules/projects.routes.ts'
import { procurementRoutes } from './modules/procurement.routes.ts'
import { auditRoutes } from './modules/audit.routes.ts'
import { metaRoutes } from './modules/meta.routes.ts'

const here = dirname(fileURLToPath(import.meta.url))

export function buildApp(db: Db) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Trust the reverse proxy for the client IP, which the audit log records.
    trustProxy: true,
    genReqId: () => Math.random().toString(36).slice(2, 12),
  })

  // The boot-time guard assertion is registered BEFORE the routes, so it sees
  // every one of them go past.
  assertEveryRouteIsGuarded(app)

  app.register(cookie)

  app.decorateRequest('auth', null)

  // One place where identity is established for every request.
  app.addHook('preHandler', async (req) => {
    req.auth = await loadAuth(db, req.cookies[SESSION_COOKIE])
  })

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'same-origin')
    return payload
  })

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }))

  authRoutes(app, db)
  metaRoutes(app, db)
  projectRoutes(app, db)
  procurementRoutes(app, db)
  auditRoutes(app, db)

  // Serve the built React app. Single origin, so there is no CORS to configure
  // and the session cookie is same-site by construction.
  const webRoot = join(here, '..', '..', 'web', 'dist')
  if (existsSync(webRoot)) {
    app.register(fastifyStatic, { root: webRoot })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
