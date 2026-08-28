import type { Db } from '../db/db.ts'
import type { AuthContext } from '../core/auth.ts'
import * as D from '../core/dec.ts'

/**
 * Row-level scoping, applied centrally. Every project query goes through this
 * so "which projects may this user see" is answered in one place rather than
 * being re-implemented, slightly differently, in each route.
 */
function scopedProjectIds(auth: AuthContext): number[] | null {
  return auth.scopeAllProjects ? null : [...auth.projectIds]
}

export async function listProjects(db: Db, auth: AuthContext) {
  const ids = scopedProjectIds(auth)

  let q = db
    .selectFrom('projects')
    .innerJoin('customers', 'customers.id', 'projects.customer_id')
    .leftJoin('v_project_totals', 'v_project_totals.project_id', 'projects.id')
    .select([
      'projects.id',
      'projects.code',
      'projects.name',
      'projects.status',
      'projects.base_currency',
      'projects.contract_ref',
      'projects.starts_on',
      'projects.ends_on',
      'customers.name as customer_name',
      'v_project_totals.cost_base',
      'v_project_totals.revenue_base',
    ])
    .orderBy('projects.code')

  if (ids !== null) {
    if (ids.length === 0) return []
    q = q.where('projects.id', 'in', ids)
  }

  const rows = await q.execute()

  return rows.map((r) => {
    const cost = D.parse(r.cost_base ?? '0')
    const revenue = D.parse(r.revenue_base ?? '0')
    const margin = D.sub(revenue, cost)
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      currency: r.base_currency,
      customer_name: r.customer_name,
      contract_ref: r.contract_ref,
      starts_on: r.starts_on,
      ends_on: r.ends_on,
      financials: {
        cost_base: D.format(cost, 2),
        revenue_base: D.format(revenue, 2),
        margin_base: D.format(margin, 2),
        // A rate with a zero denominator is undefined, not zero. Returning 0%
        // here would read as "this project makes no money", which is a
        // different and wrong statement from "there is no revenue to measure
        // against yet".
        margin_pct: D.pct(margin, revenue),
      },
    }
  })
}

export async function getProject(db: Db, auth: AuthContext, id: number) {
  const ids = scopedProjectIds(auth)
  if (ids !== null && !ids.includes(id)) return null

  const project = await db
    .selectFrom('projects')
    .innerJoin('customers', 'customers.id', 'projects.customer_id')
    .leftJoin('users', 'users.id', 'projects.manager_user_id')
    .select([
      'projects.id',
      'projects.code',
      'projects.name',
      'projects.status',
      'projects.base_currency',
      'projects.contract_ref',
      'projects.starts_on',
      'projects.ends_on',
      'customers.name as customer_name',
      'customers.country as customer_country',
      'users.full_name as manager_name',
    ])
    .where('projects.id', '=', id)
    .executeTakeFirst()

  if (!project) return null

  const items = await db
    .selectFrom('project_items')
    .select(['id', 'line_no', 'item_code', 'description', 'uom', 'qty', 'target_unit_price'])
    .where('project_id', '=', id)
    .orderBy('line_no')
    .execute()

  const ledger = await db
    .selectFrom('project_ledger')
    .leftJoin('users', 'users.id', 'project_ledger.posted_by')
    .select([
      'project_ledger.id',
      'project_ledger.entry_date',
      'project_ledger.direction',
      'project_ledger.category',
      'project_ledger.description',
      'project_ledger.amount_doc',
      'project_ledger.currency',
      'project_ledger.fx_rate',
      'project_ledger.amount_base',
      'project_ledger.reversal_of_id',
      'users.full_name as posted_by_name',
    ])
    .where('project_ledger.project_id', '=', id)
    .orderBy('project_ledger.entry_date')
    .orderBy('project_ledger.id')
    .execute()

  // Profitability is a GROUP BY over one ledger, not a report-time walk of the
  // document chain. Reversals are ordinary negative rows, so they fall out of
  // the sum without any special case.
  const costRows = ledger.filter((l) => l.direction === 'cost')
  const revenueRows = ledger.filter((l) => l.direction === 'revenue')
  const cost = D.sum(costRows.map((l) => D.parse(l.amount_base)))
  const revenue = D.sum(revenueRows.map((l) => D.parse(l.amount_base)))
  const margin = D.sub(revenue, cost)

  const byCategory = new Map<string, bigint>()
  for (const l of costRows) {
    byCategory.set(l.category, (byCategory.get(l.category) ?? 0n) + D.parse(l.amount_base))
  }

  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    currency: project.base_currency,
    contract_ref: project.contract_ref,
    starts_on: project.starts_on,
    ends_on: project.ends_on,
    customer: { name: project.customer_name, country: project.customer_country },
    manager_name: project.manager_name,
    items: items.map((i) => ({
      id: i.id,
      line_no: i.line_no,
      item_code: i.item_code,
      description: i.description,
      uom: i.uom,
      qty: D.format(D.parse(i.qty), 2),
      target_unit_price: i.target_unit_price ? D.format(D.parse(i.target_unit_price), 2) : null,
    })),
    // ROW-level filtering, not just field-level. The declarative field policy
    // cannot express "drop the revenue rows from this array", and if purchasing
    // could read the revenue lines of the ledger they could add them up and
    // subtract the cost they are allowed to see — reconstructing the margin the
    // field policy just removed. Checking that a restricted number cannot be
    // DERIVED from permitted ones is the part that usually gets missed.
    ledger: ledger
      .filter((l) => (l.direction === 'cost' ? auth.perms.has('project.cost.read') : auth.perms.has('project.revenue.read')))
      .map((l) => ({
        id: l.id,
        entry_date: l.entry_date,
        direction: l.direction,
        category: l.category,
        description: l.description,
        amount_doc: D.format(D.parse(l.amount_doc), 2),
        currency: l.currency,
        fx_rate: l.fx_rate,
        amount_base: D.format(D.parse(l.amount_base), 2),
        is_reversal: l.reversal_of_id !== null,
        posted_by_name: l.posted_by_name,
      })),
    financials: {
      cost_base: D.format(cost, 2),
      revenue_base: D.format(revenue, 2),
      margin_base: D.format(margin, 2),
      margin_pct: D.pct(margin, revenue),
      cost_breakdown: [...byCategory.entries()]
        .map(([category, amount]) => ({ category, amount_base: D.format(amount, 2) }))
        .sort((a, b) => Number(D.parse(b.amount_base) - D.parse(a.amount_base))),
    },
  }
}
