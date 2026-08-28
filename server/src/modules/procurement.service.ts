import type { Db } from '../db/db.ts'
import type { AuthContext } from '../core/auth.ts'
import * as D from '../core/dec.ts'

export async function listRfqs(db: Db, auth: AuthContext) {
  let q = db
    .selectFrom('rfqs')
    .innerJoin('projects', 'projects.id', 'rfqs.project_id')
    .leftJoin('users', 'users.id', 'rfqs.created_by')
    .select([
      'rfqs.id',
      'rfqs.ref',
      'rfqs.title',
      'rfqs.status',
      'rfqs.issued_at',
      'rfqs.due_at',
      'projects.code as project_code',
      'projects.name as project_name',
      'users.full_name as created_by_name',
    ])
    .orderBy('rfqs.ref', 'desc')

  if (!auth.scopeAllProjects) {
    const ids = [...auth.projectIds]
    if (ids.length === 0) return []
    q = q.where('rfqs.project_id', 'in', ids)
  }

  const rows = await q.execute()
  const counts = await db
    .selectFrom('rfq_lines')
    .select(['rfq_id', db.fn.count<string>('id').as('n')])
    .groupBy('rfq_id')
    .execute()
  const quoteCounts = await db
    .selectFrom('supplier_quotations')
    .select(['rfq_id', db.fn.count<string>('id').as('n')])
    .groupBy('rfq_id')
    .execute()

  const lineCount = new Map(counts.map((c) => [c.rfq_id, Number(c.n)]))
  const quoteCount = new Map(quoteCounts.map((c) => [c.rfq_id, Number(c.n)]))

  return rows.map((r) => ({
    ...r,
    line_count: lineCount.get(r.id) ?? 0,
    quotation_count: quoteCount.get(r.id) ?? 0,
  }))
}

/**
 * The quotation comparison.
 *
 * This is the screen that decides whether purchasing actually adopts the
 * system, so it is the one I build properly: every supplier's response to one
 * RFQ, side by side, one row per requirement, with prices normalised into the
 * project's base currency using each quotation's OWN fx rate as at its OWN
 * date — not today's rate, or the whole comparison shifts every morning.
 *
 * Cheapest per line is flagged, but lead time and incoterm sit right next to
 * the price, because the cheapest quote is frequently not the one you want and
 * a comparison that only shows money quietly makes the wrong decision look
 * obvious.
 */
export async function getRfqComparison(db: Db, auth: AuthContext, rfqId: number) {
  const rfq = await db
    .selectFrom('rfqs')
    .innerJoin('projects', 'projects.id', 'rfqs.project_id')
    .leftJoin('users', 'users.id', 'rfqs.created_by')
    .select([
      'rfqs.id',
      'rfqs.ref',
      'rfqs.title',
      'rfqs.status',
      'rfqs.notes',
      'rfqs.issued_at',
      'rfqs.due_at',
      'rfqs.project_id',
      'projects.code as project_code',
      'projects.name as project_name',
      'projects.base_currency as base_currency',
      'users.full_name as created_by_name',
    ])
    .where('rfqs.id', '=', rfqId)
    .executeTakeFirst()

  if (!rfq) return null
  if (!auth.scopeAllProjects && !auth.projectIds.has(rfq.project_id)) return null

  const lines = await db
    .selectFrom('rfq_lines')
    .select(['id', 'line_no', 'description', 'uom', 'qty'])
    .where('rfq_id', '=', rfqId)
    .orderBy('line_no')
    .execute()

  const quotations = await db
    .selectFrom('supplier_quotations')
    .innerJoin('suppliers', 'suppliers.id', 'supplier_quotations.supplier_id')
    .select([
      'supplier_quotations.id',
      'supplier_quotations.ref',
      'supplier_quotations.status',
      'supplier_quotations.currency',
      'supplier_quotations.fx_rate',
      'supplier_quotations.incoterm',
      'supplier_quotations.lead_time_days',
      'supplier_quotations.payment_terms',
      'supplier_quotations.quoted_at',
      'supplier_quotations.valid_until',
      'suppliers.code as supplier_code',
      'suppliers.name as supplier_name',
      'suppliers.country as supplier_country',
      'suppliers.rating as supplier_rating',
    ])
    .where('supplier_quotations.rfq_id', '=', rfqId)
    .orderBy('supplier_quotations.ref')
    .execute()

  const quoteIds = quotations.map((q) => q.id)
  const quoteLines = quoteIds.length
    ? await db
        .selectFrom('supplier_quotation_lines')
        .select(['id', 'supplier_quotation_id', 'rfq_line_id', 'qty', 'unit_price', 'lead_time_days', 'note'])
        .where('supplier_quotation_id', 'in', quoteIds)
        .execute()
    : []

  const fxByQuote = new Map(quotations.map((q) => [q.id, D.parse(q.fx_rate)]))

  // cells[rfqLineId][quotationId]
  const cells: Record<string, Record<string, unknown>> = {}
  const bestByLine = new Map<number, { quotationId: number; base: bigint }>()

  for (const l of quoteLines) {
    const fx = fxByQuote.get(l.supplier_quotation_id) ?? D.parse('1')
    const unitBase = D.mul(D.parse(l.unit_price), fx)
    const totalBase = D.parse(D.format(D.mul(D.parse(l.qty), unitBase), 2))

    const best = bestByLine.get(l.rfq_line_id)
    if (!best || totalBase < best.base) {
      bestByLine.set(l.rfq_line_id, { quotationId: l.supplier_quotation_id, base: totalBase })
    }

    cells[l.rfq_line_id] ??= {}
    cells[l.rfq_line_id]![l.supplier_quotation_id] = {
      quotation_line_id: l.id,
      qty: D.format(D.parse(l.qty), 2),
      unit_price: D.format(D.parse(l.unit_price), 2),
      unit_price_base: D.format(unitBase, 2),
      line_total_base: D.format(totalBase, 2),
      lead_time_days: l.lead_time_days,
      note: l.note,
      is_best: false,
    }
  }

  for (const [rfqLineId, best] of bestByLine) {
    const cell = cells[rfqLineId]?.[best.quotationId] as { is_best: boolean } | undefined
    if (cell) cell.is_best = true
  }

  // Quotation totals in base currency, and what the whole RFQ costs if you take
  // the cheapest line from whichever supplier offered it (the "cherry-pick"
  // figure purchasing actually argues about).
  const totals: Record<string, string> = {}
  for (const q of quotations) {
    const mine = quoteLines.filter((l) => l.supplier_quotation_id === q.id)
    const fx = fxByQuote.get(q.id)!
    totals[q.id] = D.format(
      D.sum(mine.map((l) => D.parse(D.format(D.mul(D.parse(l.qty), D.mul(D.parse(l.unit_price), fx)), 2)))),
      2,
    )
  }
  const cherryPickTotal = D.format(D.sum([...bestByLine.values()].map((b) => b.base)), 2)

  return {
    rfq: {
      id: rfq.id,
      ref: rfq.ref,
      title: rfq.title,
      status: rfq.status,
      notes: rfq.notes,
      issued_at: rfq.issued_at,
      due_at: rfq.due_at,
      project: { id: rfq.project_id, code: rfq.project_code, name: rfq.project_name },
      base_currency: rfq.base_currency,
      created_by_name: rfq.created_by_name,
    },
    lines: lines.map((l) => ({
      id: l.id,
      line_no: l.line_no,
      description: l.description,
      uom: l.uom,
      qty: D.format(D.parse(l.qty), 2),
    })),
    quotations: quotations.map((q) => ({
      id: q.id,
      ref: q.ref,
      status: q.status,
      currency: q.currency,
      fx_rate: q.fx_rate,
      incoterm: q.incoterm,
      lead_time_days: q.lead_time_days,
      payment_terms: q.payment_terms,
      quoted_at: q.quoted_at,
      valid_until: q.valid_until,
      supplier: {
        code: q.supplier_code,
        name: q.supplier_name,
        country: q.supplier_country,
        rating: q.supplier_rating,
      },
      total: totals[q.id] ?? '0.00',
    })),
    cells,
    summary: {
      base_currency: rfq.base_currency,
      cheapest_single_supplier: quotations.length
        ? quotations
            .map((q) => ({ ref: q.ref, supplier: q.supplier_name, total: totals[q.id] ?? '0.00' }))
            .sort((a, b) => Number(D.parse(a.total) - D.parse(b.total)))[0]
        : null,
      cherry_picked_total: cherryPickTotal,
    },
  }
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const APPROVAL_THRESHOLD_BASE = '25000.00'

export async function listPurchaseOrders(db: Db, auth: AuthContext) {
  const rows = await db
    .selectFrom('purchase_orders')
    .innerJoin('suppliers', 'suppliers.id', 'purchase_orders.supplier_id')
    .leftJoin('users as creator', 'creator.id', 'purchase_orders.created_by')
    .leftJoin('users as approver', 'approver.id', 'purchase_orders.approved_by')
    .select([
      'purchase_orders.id',
      'purchase_orders.ref',
      'purchase_orders.status',
      'purchase_orders.currency',
      'purchase_orders.fx_rate',
      'purchase_orders.incoterm',
      'purchase_orders.ordered_at',
      'purchase_orders.approved_at',
      'suppliers.name as supplier_name',
      'creator.full_name as created_by_name',
      'approver.full_name as approved_by_name',
    ])
    .orderBy('purchase_orders.ref', 'desc')
    .execute()

  const lines = await db
    .selectFrom('po_lines')
    .innerJoin('projects', 'projects.id', 'po_lines.project_id')
    .select(['po_lines.po_id', 'po_lines.qty', 'po_lines.unit_price', 'po_lines.project_id', 'projects.code as project_code'])
    .execute()

  const visible = rows.filter((po) => {
    if (auth.scopeAllProjects) return true
    return lines.some((l) => l.po_id === po.id && auth.projectIds.has(l.project_id))
  })

  return visible.map((po) => {
    const mine = lines.filter((l) => l.po_id === po.id)
    const total = D.sum(mine.map((l) => D.lineTotal(l.qty, l.unit_price)))
    return {
      ...po,
      // A PO can legitimately span several projects — consolidating to hit a
      // price break is normal — so this is a list, not a single code.
      projects: [...new Set(mine.map((l) => l.project_code))].sort(),
      line_count: mine.length,
      total: D.format(total, 2),
      total_base: D.format(D.mul(total, D.parse(po.fx_rate)), 2),
    }
  })
}

export async function getPurchaseOrder(db: Db, auth: AuthContext, id: number) {
  const po = await db
    .selectFrom('purchase_orders')
    .innerJoin('suppliers', 'suppliers.id', 'purchase_orders.supplier_id')
    .leftJoin('users as creator', 'creator.id', 'purchase_orders.created_by')
    .leftJoin('users as approver', 'approver.id', 'purchase_orders.approved_by')
    .select([
      'purchase_orders.id',
      'purchase_orders.ref',
      'purchase_orders.status',
      'purchase_orders.currency',
      'purchase_orders.fx_rate',
      'purchase_orders.incoterm',
      'purchase_orders.payment_terms',
      'purchase_orders.ordered_at',
      'purchase_orders.approved_at',
      'suppliers.code as supplier_code',
      'suppliers.name as supplier_name',
      'suppliers.country as supplier_country',
      'creator.full_name as created_by_name',
      'approver.full_name as approved_by_name',
    ])
    .where('purchase_orders.id', '=', id)
    .executeTakeFirst()

  if (!po) return null

  const lines = await db
    .selectFrom('po_lines')
    .innerJoin('projects', 'projects.id', 'po_lines.project_id')
    .leftJoin('supplier_quotation_lines', 'supplier_quotation_lines.id', 'po_lines.supplier_quotation_line_id')
    .leftJoin('supplier_quotations', 'supplier_quotations.id', 'supplier_quotation_lines.supplier_quotation_id')
    .select([
      'po_lines.id',
      'po_lines.line_no',
      'po_lines.description',
      'po_lines.uom',
      'po_lines.qty',
      'po_lines.unit_price',
      'po_lines.project_id',
      'projects.code as project_code',
      'projects.name as project_name',
      'supplier_quotations.ref as from_quotation_ref',
    ])
    .where('po_lines.po_id', '=', id)
    .orderBy('po_lines.line_no')
    .execute()

  if (!auth.scopeAllProjects && !lines.some((l) => auth.projectIds.has(l.project_id))) return null

  const total = D.sum(lines.map((l) => D.lineTotal(l.qty, l.unit_price)))

  return {
    ...po,
    lines: lines.map((l) => ({
      id: l.id,
      line_no: l.line_no,
      description: l.description,
      uom: l.uom,
      qty: D.format(D.parse(l.qty), 2),
      unit_price: D.format(D.parse(l.unit_price), 2),
      line_total: D.format(D.lineTotal(l.qty, l.unit_price), 2),
      project_code: l.project_code,
      project_name: l.project_name,
      from_quotation_ref: l.from_quotation_ref,
    })),
    projects: [...new Set(lines.map((l) => l.project_code))].sort(),
    // Document total is the sum of already-rounded line totals, not the
    // rounding of an unrounded sum. Do it the other way round and the printed
    // PO does not add up, and the supplier queries it.
    total: D.format(total, 2),
    total_base: D.format(D.mul(total, D.parse(po.fx_rate)), 2),
    requires_director_approval: total >= D.parse(APPROVAL_THRESHOLD_BASE),
  }
}
