/**
 * Field-level projection — the single choke point through which every response
 * leaves this server.
 *
 * The requirement "purchasing must not see profit margins" is a data-leak
 * problem, not a menu problem. If the margin is in the JSON and the React app
 * merely declines to render it, the number is one DevTools tab away. I have
 * opened plenty of systems where that was the entire protection.
 *
 * So: sensitive fields are declared once, here, as field-path -> required
 * permission. `applyFieldPolicy` deletes any field the caller lacks the
 * permission for, and every route runs its payload through it on the way out.
 * Adding a new sensitive field is one line in a policy below. Forgetting to
 * protect it in each of the eleven endpoints that happen to return a project is
 * not a mistake that can be made, because there are not eleven places — there
 * is one.
 *
 * Paths use dots. Arrays are traversed transparently, so `lines.unit_price`
 * covers every element of `lines`.
 */

export type FieldPolicy = Record<string, string> // field path -> permission key

function stripPath(node: unknown, segments: string[]): void {
  if (node === null || node === undefined) return

  if (Array.isArray(node)) {
    for (const item of node) stripPath(item, segments)
    return
  }

  if (typeof node !== 'object') return

  const [head, ...rest] = segments
  if (head === undefined) return
  const obj = node as Record<string, unknown>

  if (rest.length === 0) {
    delete obj[head]
    return
  }

  if (head in obj) stripPath(obj[head], rest)
}

export function applyFieldPolicy<T>(payload: T, policy: FieldPolicy, perms: ReadonlySet<string>): T {
  for (const [path, permission] of Object.entries(policy)) {
    if (perms.has(permission)) continue
    stripPath(payload, path.split('.'))
  }
  return payload
}

/**
 * Which fields of the response were removed for this caller. Returned in a
 * `_redacted` block on demo responses so you can see the mechanism working
 * without having to diff two JSON dumps by eye. In production this block is
 * off — telling a caller precisely which fields exist and are being withheld is
 * information you do not need to give away.
 */
export function redactedFields(policy: FieldPolicy, perms: ReadonlySet<string>): string[] {
  return Object.entries(policy)
    .filter(([, permission]) => !perms.has(permission))
    .map(([path]) => path)
    .sort()
}

// ---------------------------------------------------------------------------
// The policies themselves.
// ---------------------------------------------------------------------------

/**
 * A project. Note that cost, revenue and margin are three SEPARATE permissions.
 *
 * That separation is the point. If purchasing could see both the full cost roll-up
 * and the sell price, they could do the subtraction themselves and the margin
 * permission would be decorative. So purchasing gets project.cost.read and NOT
 * project.revenue.read, and the margin block needs its own permission on top.
 */
export const PROJECT_POLICY: FieldPolicy = {
  'financials.cost_base': 'project.cost.read',
  'financials.cost_breakdown': 'project.cost.read',
  'financials.revenue_base': 'project.revenue.read',
  'financials.margin_base': 'project.margin.read',
  'financials.margin_pct': 'project.margin.read',
  'items.target_unit_price': 'project.revenue.read',
}

export const PROJECT_LIST_POLICY: FieldPolicy = {
  'financials.cost_base': 'project.cost.read',
  'financials.revenue_base': 'project.revenue.read',
  'financials.margin_base': 'project.margin.read',
  'financials.margin_pct': 'project.margin.read',
}

/**
 * A purchase order. Logistics needs POs to track deliveries — quantities,
 * dates, supplier — but has no business seeing what was paid, so every price
 * field is behind project.cost.read.
 */
export const PO_POLICY: FieldPolicy = {
  'lines.unit_price': 'project.cost.read',
  'lines.line_total': 'project.cost.read',
  total: 'project.cost.read',
  total_base: 'project.cost.read',
}

export const SUPPLIER_QUOTE_POLICY: FieldPolicy = {
  'lines.unit_price': 'project.cost.read',
  'lines.line_total': 'project.cost.read',
  total: 'project.cost.read',
}
