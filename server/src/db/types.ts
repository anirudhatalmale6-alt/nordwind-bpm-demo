import type { ColumnType, Generated } from 'kysely'

/**
 * Money and quantities are NUMERIC in PostgreSQL and arrive as strings.
 * They stay strings all the way through the repository layer — see core/dec.ts
 * for the fixed-point arithmetic. Nothing in this codebase does money maths in
 * a JavaScript number.
 */
type Numeric = ColumnType<string, string | number, string | number>
type Ts = ColumnType<Date, Date | string | undefined, Date | string>

export interface RolesTable {
  id: Generated<number>
  key: string
  name: string
  description: Generated<string>
}

export interface PermissionsTable {
  id: Generated<number>
  key: string
  description: Generated<string>
}

export interface RolePermissionsTable {
  role_id: number
  permission_id: number
}

export interface UsersTable {
  id: Generated<number>
  email: string
  full_name: string
  job_title: Generated<string>
  role_id: number
  password_hash: string
  is_active: Generated<boolean>
  created_at: Generated<Ts>
}

export interface SessionsTable {
  id: string
  user_id: number
  created_at: Generated<Ts>
  last_seen_at: Generated<Ts>
  expires_at: Ts
  user_agent: Generated<string>
  ip: Generated<string>
}

export interface ProjectAssignmentsTable {
  project_id: number
  user_id: number
}

export interface CustomersTable {
  id: Generated<number>
  code: string
  name: string
  country: Generated<string>
  currency: Generated<string>
}

export interface SuppliersTable {
  id: Generated<number>
  code: string
  name: string
  country: Generated<string>
  currency: Generated<string>
  lead_time_days: Generated<number>
  rating: Numeric | null
  is_approved: Generated<boolean>
}

export interface ProjectsTable {
  id: Generated<number>
  code: string
  name: string
  customer_id: number
  status: Generated<string>
  base_currency: Generated<string>
  manager_user_id: number | null
  contract_ref: Generated<string>
  starts_on: ColumnType<string, string | null, string | null> | null
  ends_on: ColumnType<string, string | null, string | null> | null
  created_at: Generated<Ts>
}

export interface ProjectItemsTable {
  id: Generated<number>
  project_id: number
  line_no: number
  item_code: Generated<string>
  description: string
  uom: Generated<string>
  qty: Numeric
  target_unit_price: Numeric | null
}

export interface RfqsTable {
  id: Generated<number>
  ref: string
  project_id: number
  title: string
  status: Generated<string>
  revision: Generated<number>
  issued_at: Ts | null
  due_at: Ts | null
  notes: Generated<string>
  created_by: number
  created_at: Generated<Ts>
}

export interface RfqLinesTable {
  id: Generated<number>
  rfq_id: number
  line_no: number
  project_item_id: number | null
  description: string
  uom: Generated<string>
  qty: Numeric
}

export interface RfqSuppliersTable {
  rfq_id: number
  supplier_id: number
  sent_at: Ts | null
}

export interface SupplierQuotationsTable {
  id: Generated<number>
  ref: string
  rfq_id: number
  supplier_id: number
  status: Generated<string>
  currency: string
  fx_rate: Numeric
  incoterm: Generated<string>
  lead_time_days: number | null
  payment_terms: Generated<string>
  quoted_at: ColumnType<string, string, string>
  valid_until: ColumnType<string, string | null, string | null> | null
  created_at: Generated<Ts>
}

export interface SupplierQuotationLinesTable {
  id: Generated<number>
  supplier_quotation_id: number
  rfq_line_id: number
  qty: Numeric
  unit_price: Numeric
  lead_time_days: number | null
  note: Generated<string>
}

export interface CustomerQuotationsTable {
  id: Generated<number>
  ref: string
  project_id: number
  status: Generated<string>
  currency: string
  fx_rate: Numeric
  issued_at: ColumnType<string, string | null, string | null> | null
  created_by: number
  created_at: Generated<Ts>
}

export interface CustomerQuotationLinesTable {
  id: Generated<number>
  customer_quotation_id: number
  line_no: number
  project_item_id: number | null
  source_supplier_quotation_line_id: number | null
  description: string
  qty: Numeric
  unit_sell_price: Numeric
}

export interface PurchaseOrdersTable {
  id: Generated<number>
  ref: string
  supplier_id: number
  status: Generated<string>
  currency: string
  fx_rate: Numeric
  incoterm: Generated<string>
  payment_terms: Generated<string>
  ordered_at: ColumnType<string, string | null, string | null> | null
  created_by: number
  approved_by: number | null
  approved_at: Ts | null
  created_at: Generated<Ts>
}

export interface PoLinesTable {
  id: Generated<number>
  po_id: number
  line_no: number
  project_id: number
  supplier_quotation_line_id: number | null
  description: string
  uom: Generated<string>
  qty: Numeric
  unit_price: Numeric
}

export interface ProjectLedgerTable {
  id: Generated<number>
  project_id: number
  entry_date: ColumnType<string, string, string>
  direction: string
  category: string
  description: Generated<string>
  amount_doc: Numeric
  currency: string
  fx_rate: Numeric
  amount_base: Numeric
  source_type: Generated<string>
  source_id: number | null
  reversal_of_id: number | null
  posted_by: number | null
  posted_at: Generated<Ts>
}

export interface AuditLogTable {
  id: Generated<string>
  at: Generated<Ts>
  actor_user_id: number | null
  actor_ip: Generated<string>
  request_id: Generated<string>
  entity_type: string
  entity_id: Generated<string>
  action: string
  summary: Generated<string>
  diff: ColumnType<unknown, string | null, string | null> | null
  context: ColumnType<unknown, string | null, string | null> | null
}

export interface DocumentsTable {
  id: Generated<number>
  entity_type: string
  entity_id: number
  original_filename: string
  stored_name: string
  storage_path: string
  mime_type: string
  byte_size: ColumnType<string, string | number, string | number>
  sha256: string
  description: Generated<string>
  uploaded_by: number
  uploaded_at: Generated<Ts>
  deleted_at: Ts | null
  deleted_by: number | null
  blob_removed_at: Ts | null
}

export interface VProjectTotals {
  project_id: number
  cost_base: Numeric
  revenue_base: Numeric
}

export interface DB {
  roles: RolesTable
  permissions: PermissionsTable
  role_permissions: RolePermissionsTable
  users: UsersTable
  sessions: SessionsTable
  project_assignments: ProjectAssignmentsTable
  customers: CustomersTable
  suppliers: SuppliersTable
  projects: ProjectsTable
  project_items: ProjectItemsTable
  rfqs: RfqsTable
  rfq_lines: RfqLinesTable
  rfq_suppliers: RfqSuppliersTable
  supplier_quotations: SupplierQuotationsTable
  supplier_quotation_lines: SupplierQuotationLinesTable
  customer_quotations: CustomerQuotationsTable
  customer_quotation_lines: CustomerQuotationLinesTable
  purchase_orders: PurchaseOrdersTable
  po_lines: PoLinesTable
  project_ledger: ProjectLedgerTable
  audit_log: AuditLogTable
  documents: DocumentsTable
  v_project_totals: VProjectTotals
}
