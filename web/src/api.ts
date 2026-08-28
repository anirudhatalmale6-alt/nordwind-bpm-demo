import { useQuery, type UseQueryResult } from '@tanstack/react-query'

export interface ApiResult<T> {
  data: T
  /** The response body exactly as it arrived, for the raw-response viewer. */
  raw: string
  status: number
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const raw = await res.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = raw
  }
  if (!res.ok) {
    const msg =
      (parsed as { message?: string; error?: string } | null)?.message ??
      (parsed as { error?: string } | null)?.error ??
      `Request failed (${res.status})`
    throw new ApiError(res.status, parsed, msg)
  }
  return { data: parsed as T, raw, status: res.status }
}

export function useApi<T>(key: unknown[], path: string): UseQueryResult<ApiResult<T>, ApiError> {
  return useQuery<ApiResult<T>, ApiError>({
    queryKey: key,
    queryFn: () => api<T>(path),
    retry: false,
  })
}

// ----- shared response shapes ----------------------------------------------

export interface Me {
  user: {
    id: number
    email: string
    full_name: string
    job_title: string
    role_key: string
    role_name: string
  }
  permissions: string[]
}

export interface Financials {
  cost_base?: string
  revenue_base?: string
  margin_base?: string
  margin_pct?: number | null
  cost_breakdown?: Array<{ category: string; amount_base: string }>
}

export interface Redacted {
  fields: string[]
  note: string
}

export interface ProjectRow {
  id: number
  code: string
  name: string
  status: string
  currency: string
  customer_name: string
  contract_ref: string
  starts_on: string | null
  ends_on: string | null
  financials: Financials
}

export interface ProjectDetail {
  id: number
  code: string
  name: string
  status: string
  currency: string
  contract_ref: string
  starts_on: string | null
  ends_on: string | null
  customer: { name: string; country: string }
  manager_name: string | null
  items: Array<{
    id: number
    line_no: number
    item_code: string
    description: string
    uom: string
    qty: string
    target_unit_price?: string | null
  }>
  ledger: Array<{
    id: number
    entry_date: string
    direction: string
    category: string
    description: string
    amount_doc: string
    currency: string
    fx_rate: string
    amount_base: string
    is_reversal: boolean
    posted_by_name: string | null
  }>
  financials: Financials
  _redacted?: Redacted
}

export interface RfqRow {
  id: number
  ref: string
  title: string
  status: string
  issued_at: string | null
  due_at: string | null
  project_code: string
  project_name: string
  created_by_name: string | null
  line_count: number
  quotation_count: number
}

export interface Cell {
  quotation_line_id: number
  qty: string
  unit_price?: string
  unit_price_base?: string
  line_total_base?: string
  lead_time_days: number | null
  note: string
  is_best: boolean
}

export interface RfqCompare {
  rfq: {
    id: number
    ref: string
    title: string
    status: string
    notes: string
    issued_at: string | null
    due_at: string | null
    project: { id: number; code: string; name: string }
    base_currency: string
    created_by_name: string | null
  }
  lines: Array<{ id: number; line_no: number; description: string; uom: string; qty: string }>
  quotations: Array<{
    id: number
    ref: string
    status: string
    currency: string
    fx_rate: string
    incoterm: string
    lead_time_days: number | null
    payment_terms: string
    quoted_at: string
    valid_until: string | null
    supplier: { code: string; name: string; country: string; rating: string | null }
    total?: string
  }>
  cells: Record<string, Record<string, Cell>>
  summary: {
    base_currency: string
    cheapest_single_supplier: { ref: string; supplier: string; total: string } | null
    cherry_picked_total: string
  }
  _redacted?: Redacted
}

export interface PoRow {
  id: number
  ref: string
  status: string
  currency: string
  incoterm: string
  ordered_at: string | null
  approved_at: string | null
  supplier_name: string
  created_by_name: string | null
  approved_by_name: string | null
  projects: string[]
  line_count: number
  total?: string
  total_base?: string
}

export interface PoDetail extends Omit<PoRow, 'projects' | 'line_count'> {
  supplier_code: string
  supplier_country: string
  payment_terms: string
  fx_rate: string
  projects: string[]
  lines: Array<{
    id: number
    line_no: number
    description: string
    uom: string
    qty: string
    unit_price?: string
    line_total?: string
    project_code: string
    project_name: string
    from_quotation_ref: string | null
  }>
  requires_director_approval: boolean
  _redacted?: Redacted
}

export interface AuditEntry {
  id: string
  at: string
  action: string
  entity_type: string
  entity_id: string
  summary: string
  diff: Record<string, { from: unknown; to: unknown }> | null
  context: Record<string, unknown> | null
  actor_ip: string
  actor_name: string | null
  actor_role: string | null
}

export interface RolesMatrix {
  roles: Array<{ id: number; key: string; name: string; description: string; permissions: string[] }>
  permissions: Array<{ id: number; key: string; description: string }>
}
