import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from 'kysely'
import type { Db } from '../db/db.ts'
import { requirePermission } from '../core/auth.ts'
import { writeAudit } from '../core/audit.ts'
import { project } from '../core/respond.ts'
import { PO_POLICY, SUPPLIER_QUOTE_POLICY } from '../core/projection.ts'
import * as D from '../core/dec.ts'
import {
  APPROVAL_THRESHOLD_BASE,
  getPurchaseOrder,
  getRfqComparison,
  listPurchaseOrders,
  listRfqs,
} from './procurement.service.ts'

const CreatePoBody = z.object({
  supplier_quotation_id: z.number().int().positive(),
  quotation_line_ids: z.array(z.number().int().positive()).min(1),
  incoterm: z.string().max(60).optional(),
  payment_terms: z.string().max(120).optional(),
})

export function procurementRoutes(app: FastifyInstance, db: Db) {
  // ----- RFQ ---------------------------------------------------------------

  app.get(
    '/api/rfqs',
    { config: { permission: 'rfq.read' }, preHandler: requirePermission('rfq.read') },
    async (req) => ({ rfqs: await listRfqs(db, req.auth!) }),
  )

  app.get(
    '/api/rfqs/:id',
    { config: { permission: 'rfq.read' }, preHandler: requirePermission('rfq.read') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' })

      const data = await getRfqComparison(db, req.auth!, id)
      // 404, not 403, for a project outside this user's scope. A 403 confirms
      // the record exists, which is itself information.
      if (!data) return reply.code(404).send({ error: 'not_found' })

      return project(req, data, SUPPLIER_QUOTE_POLICY)
    },
  )

  // ----- purchase orders ---------------------------------------------------

  app.get(
    '/api/purchase-orders',
    { config: { permission: 'po.read' }, preHandler: requirePermission('po.read') },
    async (req) => {
      const rows = await listPurchaseOrders(db, req.auth!)
      return project(req, { purchase_orders: rows }, {
        'purchase_orders.total': 'project.cost.read',
        'purchase_orders.total_base': 'project.cost.read',
      })
    },
  )

  app.get(
    '/api/purchase-orders/:id',
    { config: { permission: 'po.read' }, preHandler: requirePermission('po.read') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' })
      const po = await getPurchaseOrder(db, req.auth!, id)
      if (!po) return reply.code(404).send({ error: 'not_found' })
      return project(req, po, PO_POLICY)
    },
  )

  /**
   * Create a purchase order from selected supplier-quotation lines — the
   * "convert the comparison into an order" step.
   *
   * The PO line carries its project_id and a link back to the exact quotation
   * line it came from, so months later you can answer "why did we pay this?"
   * without anybody having to remember.
   */
  app.post(
    '/api/purchase-orders',
    { config: { permission: 'po.create' }, preHandler: requirePermission('po.create') },
    async (req, reply) => {
      const parsed = CreatePoBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.flatten() })
      }
      const body = parsed.data
      const auth = req.auth!

      const quotation = await db
        .selectFrom('supplier_quotations')
        .innerJoin('rfqs', 'rfqs.id', 'supplier_quotations.rfq_id')
        .innerJoin('suppliers', 'suppliers.id', 'supplier_quotations.supplier_id')
        .select([
          'supplier_quotations.id',
          'supplier_quotations.ref',
          'supplier_quotations.currency',
          'supplier_quotations.fx_rate',
          'supplier_quotations.incoterm',
          'supplier_quotations.payment_terms',
          'supplier_quotations.supplier_id',
          'rfqs.project_id',
          'suppliers.name as supplier_name',
        ])
        .where('supplier_quotations.id', '=', body.supplier_quotation_id)
        .executeTakeFirst()

      if (!quotation) return reply.code(404).send({ error: 'quotation_not_found' })
      if (!auth.scopeAllProjects && !auth.projectIds.has(quotation.project_id)) {
        return reply.code(404).send({ error: 'quotation_not_found' })
      }

      const lines = await db
        .selectFrom('supplier_quotation_lines')
        .innerJoin('rfq_lines', 'rfq_lines.id', 'supplier_quotation_lines.rfq_line_id')
        .select([
          'supplier_quotation_lines.id',
          'supplier_quotation_lines.qty',
          'supplier_quotation_lines.unit_price',
          'rfq_lines.description',
          'rfq_lines.uom',
        ])
        .where('supplier_quotation_lines.id', 'in', body.quotation_line_ids)
        .where('supplier_quotation_lines.supplier_quotation_id', '=', quotation.id)
        .execute()

      if (lines.length !== body.quotation_line_ids.length) {
        return reply.code(400).send({
          error: 'invalid_lines',
          message: 'One or more selected lines do not belong to that quotation.',
        })
      }

      const total = D.sum(lines.map((l) => D.lineTotal(l.qty, l.unit_price)))
      const totalBase = D.mul(total, D.parse(quotation.fx_rate))
      const needsApproval = totalBase >= D.parse(APPROVAL_THRESHOLD_BASE)

      const result = await db.transaction().execute(async (trx) => {
        const next = await sql<{ n: string }>`SELECT nextval('po_ref_seq') AS n`.execute(trx)
        const ref = `PO-2026-${String(next.rows[0]!.n).padStart(4, '0')}`

        const po = await trx
          .insertInto('purchase_orders')
          .values({
            ref,
            supplier_id: quotation.supplier_id,
            // A new PO is ALWAYS pending_approval, never approved on creation
            // — even below the threshold, and whoever raised it.
            //
            // Two reasons. First, purchasing does not hold po.approve, so
            // letting creation imply approval would route around the
            // permission. Second, and more practically: cost is posted to the
            // project ledger at the moment of approval and nowhere else. If
            // some POs could skip that step, their cost would never reach the
            // ledger and every profitability figure would quietly under-state
            // spend. One state transition, one place that posts money.
            status: 'pending_approval',
            currency: quotation.currency,
            fx_rate: quotation.fx_rate,
            incoterm: body.incoterm ?? quotation.incoterm,
            payment_terms: body.payment_terms ?? quotation.payment_terms,
            ordered_at: new Date().toISOString().slice(0, 10),
            created_by: auth.userId,
          })
          .returning(['id', 'ref'])
          .executeTakeFirstOrThrow()

        await trx
          .insertInto('po_lines')
          .values(
            lines.map((l, i) => ({
              po_id: po.id,
              line_no: i + 1,
              project_id: quotation.project_id,
              supplier_quotation_line_id: l.id,
              description: l.description,
              uom: l.uom,
              qty: l.qty,
              unit_price: l.unit_price,
            })),
          )
          .execute()

        // Same transaction as the insert. If this fails, the PO does not exist.
        await writeAudit(
          trx,
          { userId: auth.userId, ip: req.ip, requestId: req.id },
          {
            entityType: 'purchase_order',
            entityId: po.id,
            action: 'po.create',
            summary: `Created ${po.ref} to ${quotation.supplier_name} (${quotation.currency} ${D.format(total, 2)})`,
            context: {
              from_quotation: quotation.ref,
              lines: lines.length,
              status: 'pending_approval',
              approval_threshold: `EUR ${APPROVAL_THRESHOLD_BASE}`,
              requires_director_approval: needsApproval,
            },
          },
        )

        return po
      })

      return reply.code(201).send({
        id: result.id,
        ref: result.ref,
        status: 'pending_approval',
        total: D.format(total, 2),
        currency: quotation.currency,
        requires_director_approval: needsApproval,
      })
    },
  )

  /**
   * Approve a purchase order.
   *
   * Approval is where the cost becomes real, so this is also where the ledger
   * entries are posted — inside the same transaction as the status change and
   * the audit row. Either all three land or none do.
   */
  app.post(
    '/api/purchase-orders/:id/approve',
    { config: { permission: 'po.approve' }, preHandler: requirePermission('po.approve') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' })
      const auth = req.auth!

      const po = await db
        .selectFrom('purchase_orders')
        .innerJoin('suppliers', 'suppliers.id', 'purchase_orders.supplier_id')
        .select([
          'purchase_orders.id',
          'purchase_orders.ref',
          'purchase_orders.status',
          'purchase_orders.currency',
          'purchase_orders.fx_rate',
          'purchase_orders.created_by',
          'suppliers.name as supplier_name',
        ])
        .where('purchase_orders.id', '=', id)
        .executeTakeFirst()

      if (!po) return reply.code(404).send({ error: 'not_found' })
      if (po.status !== 'pending_approval') {
        return reply.code(409).send({
          error: 'not_pending',
          message: `${po.ref} is ${po.status}, not pending approval.`,
        })
      }
      // Four-eyes: you cannot approve what you raised yourself.
      if (po.created_by === auth.userId) {
        return reply.code(403).send({
          error: 'self_approval',
          message: 'A purchase order cannot be approved by the person who raised it.',
        })
      }

      const lines = await db
        .selectFrom('po_lines')
        .select(['project_id', 'qty', 'unit_price'])
        .where('po_id', '=', id)
        .execute()

      // Cost is attributed per project, because a PO can span more than one.
      const byProject = new Map<number, bigint>()
      for (const l of lines) {
        byProject.set(l.project_id, (byProject.get(l.project_id) ?? 0n) + D.lineTotal(l.qty, l.unit_price))
      }

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('purchase_orders')
          .set({ status: 'approved', approved_by: auth.userId, approved_at: new Date() })
          .where('id', '=', id)
          .execute()

        const fx = D.parse(po.fx_rate)
        for (const [projectId, amount] of byProject) {
          await trx
            .insertInto('project_ledger')
            .values({
              project_id: projectId,
              entry_date: new Date().toISOString().slice(0, 10),
              direction: 'cost',
              category: 'goods',
              description: `${po.ref} — ${po.supplier_name}`,
              amount_doc: D.format(amount, 2),
              currency: po.currency,
              fx_rate: po.fx_rate,
              amount_base: D.format(D.mul(amount, fx), 2),
              source_type: 'purchase_order',
              source_id: id,
              posted_by: auth.userId,
            })
            .execute()
        }

        await writeAudit(
          trx,
          { userId: auth.userId, ip: req.ip, requestId: req.id },
          {
            entityType: 'purchase_order',
            entityId: id,
            action: 'po.approve',
            summary: `Approved ${po.ref} (${po.currency} ${D.format(D.sum([...byProject.values()]), 2)})`,
            diff: { status: { from: po.status, to: 'approved' } },
            context: {
              approval_threshold: `EUR ${APPROVAL_THRESHOLD_BASE} — director approval required`,
              ledger_entries_posted: byProject.size,
            },
          },
        )
      })

      return { ok: true, ref: po.ref, status: 'approved', ledger_entries_posted: byProject.size }
    },
  )
}
