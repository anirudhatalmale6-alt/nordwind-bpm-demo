import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/db.ts'
import { requirePermission } from '../core/auth.ts'
import { project } from '../core/respond.ts'
import { PROJECT_LIST_POLICY, PROJECT_POLICY } from '../core/projection.ts'
import { getProject, listProjects } from './projects.service.ts'

export function projectRoutes(app: FastifyInstance, db: Db) {
  app.get(
    '/api/projects',
    { config: { permission: 'project.read' }, preHandler: requirePermission('project.read') },
    async (req) => {
      const rows = await listProjects(db, req.auth!)
      return project(
        req,
        { projects: rows },
        {
          'projects.financials.cost_base': PROJECT_LIST_POLICY['financials.cost_base']!,
          'projects.financials.revenue_base': PROJECT_LIST_POLICY['financials.revenue_base']!,
          'projects.financials.margin_base': PROJECT_LIST_POLICY['financials.margin_base']!,
          'projects.financials.margin_pct': PROJECT_LIST_POLICY['financials.margin_pct']!,
        },
      )
    },
  )

  app.get(
    '/api/projects/:id',
    { config: { permission: 'project.read' }, preHandler: requirePermission('project.read') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' })

      const data = await getProject(db, req.auth!, id)
      if (!data) return reply.code(404).send({ error: 'not_found' })

      return project(req, data, PROJECT_POLICY)
    },
  )

  app.get(
    '/api/suppliers',
    { config: { permission: 'supplier.read' }, preHandler: requirePermission('supplier.read') },
    async () => {
      const rows = await db
        .selectFrom('suppliers')
        .select(['id', 'code', 'name', 'country', 'currency', 'lead_time_days', 'rating', 'is_approved'])
        .orderBy('code')
        .execute()
      return { suppliers: rows }
    },
  )
}
