/**
 * Demo seed — a small but realistic slice of an industrial supply business.
 *
 * The numbers are made up, but the SHAPE is not: multi-currency supplier
 * quotations against one RFQ, a PO that spans two projects, freight allocated
 * as its own ledger entries, and a margin that only management can see.
 */
import pg from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import type { DB } from './types.ts'
import { hashPassword } from '../core/password.ts'
import { ROLE_BUNDLES, PERMISSIONS, type PermissionKey } from '../core/permissions.ts'
import * as D from '../core/dec.ts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { STORAGE_ROOT } from '../core/storage.ts'

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://bpm@127.0.0.1:5439/bpm_demo'
pg.types.setTypeParser(1700, (v) => v)
pg.types.setTypeParser(20, (v) => v)

const pool = new pg.Pool({ connectionString: adminUrl })
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })

// Wipe in dependency order so the seed is re-runnable.
for (const t of [
  'documents',
  'audit_log',
  'project_ledger',
  'po_lines',
  'purchase_orders',
  'customer_quotation_lines',
  'customer_quotations',
  'supplier_quotation_lines',
  'supplier_quotations',
  'rfq_suppliers',
  'rfq_lines',
  'rfqs',
  'project_items',
  'project_assignments',
  'projects',
  'suppliers',
  'customers',
  'sessions',
  'users',
  'role_permissions',
  'permissions',
  'roles',
] as const) {
  await db.deleteFrom(t).execute()
}
// ----- permissions & roles ---------------------------------------------------

const permRows = await db
  .insertInto('permissions')
  .values(
    (Object.keys(PERMISSIONS) as PermissionKey[]).map((key) => ({
      key,
      description: PERMISSIONS[key],
    })),
  )
  .returning(['id', 'key'])
  .execute()
const permId = new Map(permRows.map((p) => [p.key, p.id]))

const roleId = new Map<string, number>()
for (const [key, bundle] of Object.entries(ROLE_BUNDLES)) {
  const r = await db
    .insertInto('roles')
    .values({ key, name: bundle.name, description: bundle.description })
    .returning('id')
    .executeTakeFirstOrThrow()
  roleId.set(key, r.id)
  await db
    .insertInto('role_permissions')
    .values(bundle.perms.map((p) => ({ role_id: r.id, permission_id: permId.get(p)! })))
    .execute()
}

// ----- users -----------------------------------------------------------------

const pw = await hashPassword('demo1234')

const users = await db
  .insertInto('users')
  .values([
    {
      email: 'anna.meyer@nordwind-demo.com',
      full_name: 'Anna Meyer',
      job_title: 'Operations Director',
      role_id: roleId.get('management')!,
      password_hash: pw,
    },
    {
      email: 'ravi.kumar@nordwind-demo.com',
      full_name: 'Ravi Kumar',
      job_title: 'Senior Buyer',
      role_id: roleId.get('purchasing')!,
      password_hash: pw,
    },
    {
      email: 'maria.santos@nordwind-demo.com',
      full_name: 'Maria Santos',
      job_title: 'Logistics Coordinator',
      role_id: roleId.get('logistics')!,
      password_hash: pw,
    },
  ])
  .returning(['id', 'email'])
  .execute()
const uid = (email: string) => users.find((u) => u.email.startsWith(email))!.id
const anna = uid('anna'), ravi = uid('ravi'), maria = uid('maria')

// ----- master data -----------------------------------------------------------

const customers = await db
  .insertInto('customers')
  .values([
    { code: 'C-1001', name: 'Baltic Ferry Lines AS', country: 'Norway', currency: 'EUR' },
    { code: 'C-1002', name: 'Hafen Rostock Terminal GmbH', country: 'Germany', currency: 'EUR' },
  ])
  .returning(['id', 'code'])
  .execute()
const cust = (code: string) => customers.find((c) => c.code === code)!.id

const suppliers = await db
  .insertInto('suppliers')
  .values([
    { code: 'S-2001', name: 'Hanseatic Pumpentechnik GmbH', country: 'Germany', currency: 'EUR', lead_time_days: 21, rating: '4.6' },
    { code: 'S-2002', name: 'Ferrara Valvole S.p.A.', country: 'Italy', currency: 'EUR', lead_time_days: 35, rating: '4.1' },
    { code: 'S-2003', name: 'Ningbo Fluid Control Co. Ltd', country: 'China', currency: 'USD', lead_time_days: 62, rating: '3.7' },
    { code: 'S-2004', name: 'Rotterdam Marine Supply BV', country: 'Netherlands', currency: 'EUR', lead_time_days: 14, rating: '4.4' },
  ])
  .returning(['id', 'code'])
  .execute()
const sup = (code: string) => suppliers.find((s) => s.code === code)!.id

const projects = await db
  .insertInto('projects')
  .values([
    {
      code: 'P-2026-014',
      name: 'MS Nordlys — engine room pump refit',
      customer_id: cust('C-1001'),
      base_currency: 'EUR',
      manager_user_id: anna,
      contract_ref: 'BFL/REFIT/2026-014',
      starts_on: '2026-07-01',
      ends_on: '2026-11-30',
    },
    {
      code: 'P-2026-019',
      name: 'Rostock Terminal — ballast water treatment',
      customer_id: cust('C-1002'),
      base_currency: 'EUR',
      manager_user_id: anna,
      contract_ref: 'HRT-2026-BWT',
      starts_on: '2026-08-15',
      ends_on: '2027-02-28',
    },
  ])
  .returning(['id', 'code'])
  .execute()
const prj = (code: string) => projects.find((p) => p.code === code)!.id

// Everyone is assigned to both projects in the demo, so you can click around
// freely. Row-level scoping is still enforced — see loadAuth().
await db
  .insertInto('project_assignments')
  .values(
    projects.flatMap((p) => [
      { project_id: p.id, user_id: ravi },
      { project_id: p.id, user_id: maria },
      { project_id: p.id, user_id: anna },
    ]),
  )
  .execute()

const items14 = await db
  .insertInto('project_items')
  .values([
    { project_id: prj('P-2026-014'), line_no: 1, item_code: 'PMP-CF-125', description: 'Centrifugal seawater pump, 125 m3/h, bronze impeller', uom: 'pcs', qty: '4', target_unit_price: '9800.00' },
    { project_id: prj('P-2026-014'), line_no: 2, item_code: 'VLV-BF-200', description: 'Butterfly valve DN200, PN16, marine approved', uom: 'pcs', qty: '12', target_unit_price: '1150.00' },
    { project_id: prj('P-2026-014'), line_no: 3, item_code: 'GSK-SET-200', description: 'Gasket set DN200, EPDM, class approved', uom: 'set', qty: '24', target_unit_price: '78.00' },
    { project_id: prj('P-2026-014'), line_no: 4, item_code: 'MTR-IE3-30', description: 'Electric motor IE3 30 kW, 400 V marine duty', uom: 'pcs', qty: '4', target_unit_price: '5400.00' },
    { project_id: prj('P-2026-014'), line_no: 5, item_code: 'CTL-PNL-01', description: 'Pump control panel with VFD, IP56', uom: 'pcs', qty: '2', target_unit_price: '14500.00' },
  ])
  .returning(['id', 'line_no'])
  .execute()
const item14 = (n: number) => items14.find((i) => i.line_no === n)!.id

await db
  .insertInto('project_items')
  .values([
    { project_id: prj('P-2026-019'), line_no: 1, item_code: 'BWT-UNIT-500', description: 'Ballast water treatment unit, 500 m3/h', uom: 'pcs', qty: '2', target_unit_price: '148000.00' },
    { project_id: prj('P-2026-019'), line_no: 2, item_code: 'VLV-BF-200', description: 'Butterfly valve DN200, PN16, marine approved', uom: 'pcs', qty: '8', target_unit_price: '1150.00' },
  ])
  .execute()

// ----- RFQ -------------------------------------------------------------------

const rfq = await db
  .insertInto('rfqs')
  .values({
    ref: 'RFQ-2026-0087',
    project_id: prj('P-2026-014'),
    title: 'Pumps, valves and control panel — MS Nordlys refit',
    status: 'closed',
    issued_at: new Date('2026-07-08T09:00:00Z'),
    due_at: new Date('2026-07-22T17:00:00Z'),
    notes: 'DNV class approval required on all pressure-retaining parts. Quote DAP Bergen.',
    created_by: ravi,
  })
  .returning('id')
  .executeTakeFirstOrThrow()

const rfqLines = await db
  .insertInto('rfq_lines')
  .values([
    { rfq_id: rfq.id, line_no: 1, project_item_id: item14(1), description: 'Centrifugal seawater pump, 125 m3/h, bronze impeller', uom: 'pcs', qty: '4' },
    { rfq_id: rfq.id, line_no: 2, project_item_id: item14(2), description: 'Butterfly valve DN200, PN16, marine approved', uom: 'pcs', qty: '12' },
    { rfq_id: rfq.id, line_no: 3, project_item_id: item14(3), description: 'Gasket set DN200, EPDM, class approved', uom: 'set', qty: '24' },
    { rfq_id: rfq.id, line_no: 4, project_item_id: item14(4), description: 'Electric motor IE3 30 kW, 400 V marine duty', uom: 'pcs', qty: '4' },
    { rfq_id: rfq.id, line_no: 5, project_item_id: item14(5), description: 'Pump control panel with VFD, IP56', uom: 'pcs', qty: '2' },
  ])
  .returning(['id', 'line_no'])
  .execute()
const rl = (n: number) => rfqLines.find((l) => l.line_no === n)!.id

await db
  .insertInto('rfq_suppliers')
  .values([
    { rfq_id: rfq.id, supplier_id: sup('S-2001'), sent_at: new Date('2026-07-08T09:05:00Z') },
    { rfq_id: rfq.id, supplier_id: sup('S-2002'), sent_at: new Date('2026-07-08T09:05:00Z') },
    { rfq_id: rfq.id, supplier_id: sup('S-2003'), sent_at: new Date('2026-07-08T09:06:00Z') },
  ])
  .execute()

// ----- supplier quotations ---------------------------------------------------
// Three suppliers, three currencies-worth of complication. Note the fx_rate is
// stored on the quotation as at ITS OWN date, not looked up at render time.

async function quote(
  ref: string,
  supplierCode: string,
  currency: string,
  fx: string,
  quotedAt: string,
  incoterm: string,
  leadTime: number,
  terms: string,
  lines: Array<{ line: number; qty: string; price: string; lead?: number; note?: string }>,
) {
  const q = await db
    .insertInto('supplier_quotations')
    .values({
      ref,
      rfq_id: rfq.id,
      supplier_id: sup(supplierCode),
      currency,
      fx_rate: fx,
      incoterm,
      lead_time_days: leadTime,
      payment_terms: terms,
      quoted_at: quotedAt,
      valid_until: '2026-09-30',
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  const inserted = await db
    .insertInto('supplier_quotation_lines')
    .values(
      lines.map((l) => ({
        supplier_quotation_id: q.id,
        rfq_line_id: rl(l.line),
        qty: l.qty,
        unit_price: l.price,
        lead_time_days: l.lead ?? leadTime,
        note: l.note ?? '',
      })),
    )
    .returning(['id', 'rfq_line_id'])
    .execute()
  return { id: q.id, lineByRfqLine: new Map(inserted.map((i) => [i.rfq_line_id, i.id])) }
}

const qHanse = await quote(
  'SQ-2026-0201', 'S-2001', 'EUR', '1.00000000', '2026-07-16', 'DAP Bergen', 28, '30 days net',
  [
    { line: 1, qty: '4', price: '9250.00', lead: 28 },
    { line: 2, qty: '12', price: '1180.00', lead: 21 },
    { line: 3, qty: '24', price: '82.50', lead: 14 },
    { line: 4, qty: '4', price: '5120.00', lead: 35 },
    { line: 5, qty: '2', price: '13900.00', lead: 42, note: 'Includes commissioning support, 2 days' },
  ],
)

const qFerrara = await quote(
  'SQ-2026-0204', 'S-2002', 'EUR', '1.00000000', '2026-07-18', 'FCA Bologna', 35, '45 days net',
  [
    { line: 1, qty: '4', price: '9640.00', lead: 42 },
    { line: 2, qty: '12', price: '985.00', lead: 28, note: 'Class certificate on request, +14 days' },
    { line: 3, qty: '24', price: '71.00', lead: 21 },
    { line: 4, qty: '4', price: '5480.00', lead: 35 },
    { line: 5, qty: '2', price: '15250.00', lead: 49 },
  ],
)

const qNingbo = await quote(
  'SQ-2026-0209', 'S-2003', 'USD', '0.91800000', '2026-07-21', 'FOB Ningbo', 62, '50% advance, 50% B/L',
  [
    { line: 1, qty: '4', price: '8100.00', lead: 62, note: 'DNV certification quoted separately' },
    { line: 2, qty: '12', price: '790.00', lead: 55 },
    { line: 3, qty: '24', price: '82.00', lead: 45, note: 'Minimum order 50 sets' },
    { line: 4, qty: '4', price: '4890.00', lead: 70 },
    { line: 5, qty: '2', price: '12400.00', lead: 75, note: 'CE only, no marine approval' },
  ],
)

// ----- customer quotation ----------------------------------------------------
// Built from the selected supplier lines, with a mark-up. This is the revenue
// side; purchasing cannot see it, which is what makes the margin permission
// meaningful rather than decorative.

const cq = await db
  .insertInto('customer_quotations')
  .values({
    ref: 'CQ-2026-0142',
    project_id: prj('P-2026-014'),
    status: 'accepted',
    currency: 'EUR',
    fx_rate: '1.00000000',
    issued_at: '2026-07-25',
    created_by: anna,
  })
  .returning('id')
  .executeTakeFirstOrThrow()

await db
  .insertInto('customer_quotation_lines')
  .values([
    { customer_quotation_id: cq.id, line_no: 1, project_item_id: item14(1), source_supplier_quotation_line_id: qHanse.lineByRfqLine.get(rl(1))!, description: 'Centrifugal seawater pump, 125 m3/h', qty: '4', unit_sell_price: '12400.00' },
    { customer_quotation_id: cq.id, line_no: 2, project_item_id: item14(2), source_supplier_quotation_line_id: qFerrara.lineByRfqLine.get(rl(2))!, description: 'Butterfly valve DN200, PN16', qty: '12', unit_sell_price: '1420.00' },
    { customer_quotation_id: cq.id, line_no: 3, project_item_id: item14(3), source_supplier_quotation_line_id: qFerrara.lineByRfqLine.get(rl(3))!, description: 'Gasket set DN200, EPDM', qty: '24', unit_sell_price: '112.00' },
    { customer_quotation_id: cq.id, line_no: 4, project_item_id: item14(4), source_supplier_quotation_line_id: qHanse.lineByRfqLine.get(rl(4))!, description: 'Electric motor IE3 30 kW', qty: '4', unit_sell_price: '6950.00' },
    { customer_quotation_id: cq.id, line_no: 5, project_item_id: item14(5), source_supplier_quotation_line_id: qHanse.lineByRfqLine.get(rl(5))!, description: 'Pump control panel with VFD, IP56', qty: '2', unit_sell_price: '19800.00' },
    { customer_quotation_id: cq.id, line_no: 6, project_item_id: null, source_supplier_quotation_line_id: null, description: 'Installation supervision and commissioning, 12 days', qty: '12', unit_sell_price: '1250.00' },
  ])
  .execute()

// ----- purchase orders -------------------------------------------------------
// PO-2026-0311 deliberately spans TWO projects: the valves for P-2026-014 and
// eight more of the same valve for P-2026-019, consolidated onto one order to
// hit the supplier's price break. A header-level project_id could not express
// this — which is precisely why project_id sits on the line.

const po1 = await db
  .insertInto('purchase_orders')
  .values({
    ref: 'PO-2026-0308',
    supplier_id: sup('S-2001'),
    status: 'approved',
    currency: 'EUR',
    fx_rate: '1.00000000',
    incoterm: 'DAP Bergen',
    payment_terms: '30 days net',
    ordered_at: '2026-07-28',
    created_by: ravi,
    approved_by: anna,
    approved_at: new Date('2026-07-28T14:12:00Z'),
  })
  .returning('id')
  .executeTakeFirstOrThrow()

await db
  .insertInto('po_lines')
  .values([
    { po_id: po1.id, line_no: 1, project_id: prj('P-2026-014'), supplier_quotation_line_id: qHanse.lineByRfqLine.get(rl(1))!, description: 'Centrifugal seawater pump, 125 m3/h, bronze impeller', uom: 'pcs', qty: '4', unit_price: '9250.00' },
    { po_id: po1.id, line_no: 2, project_id: prj('P-2026-014'), supplier_quotation_line_id: qHanse.lineByRfqLine.get(rl(4))!, description: 'Electric motor IE3 30 kW, 400 V marine duty', uom: 'pcs', qty: '4', unit_price: '5120.00' },
    { po_id: po1.id, line_no: 3, project_id: prj('P-2026-014'), supplier_quotation_line_id: qHanse.lineByRfqLine.get(rl(5))!, description: 'Pump control panel with VFD, IP56', uom: 'pcs', qty: '2', unit_price: '13900.00' },
  ])
  .execute()

const po2 = await db
  .insertInto('purchase_orders')
  .values({
    ref: 'PO-2026-0311',
    supplier_id: sup('S-2002'),
    status: 'approved',
    currency: 'EUR',
    fx_rate: '1.00000000',
    incoterm: 'FCA Bologna',
    payment_terms: '45 days net',
    ordered_at: '2026-07-29',
    created_by: ravi,
    approved_by: anna,
    approved_at: new Date('2026-07-29T10:40:00Z'),
  })
  .returning('id')
  .executeTakeFirstOrThrow()

await db
  .insertInto('po_lines')
  .values([
    { po_id: po2.id, line_no: 1, project_id: prj('P-2026-014'), supplier_quotation_line_id: qFerrara.lineByRfqLine.get(rl(2))!, description: 'Butterfly valve DN200, PN16, marine approved', uom: 'pcs', qty: '12', unit_price: '985.00' },
    { po_id: po2.id, line_no: 2, project_id: prj('P-2026-014'), supplier_quotation_line_id: qFerrara.lineByRfqLine.get(rl(3))!, description: 'Gasket set DN200, EPDM, class approved', uom: 'set', qty: '24', unit_price: '71.00' },
    // Same valve, different project — consolidated for the price break.
    { po_id: po2.id, line_no: 3, project_id: prj('P-2026-019'), supplier_quotation_line_id: null, description: 'Butterfly valve DN200, PN16, marine approved', uom: 'pcs', qty: '8', unit_price: '985.00' },
  ])
  .execute()

// A third, still awaiting approval — so there is something for management to
// approve when you log in as Anna.
const po3 = await db
  .insertInto('purchase_orders')
  .values({
    ref: 'PO-2026-0315',
    supplier_id: sup('S-2004'),
    status: 'pending_approval',
    currency: 'EUR',
    fx_rate: '1.00000000',
    incoterm: 'DAP Bergen',
    payment_terms: '30 days net',
    ordered_at: '2026-08-24',
    created_by: ravi,
  })
  .returning('id')
  .executeTakeFirstOrThrow()

await db
  .insertInto('po_lines')
  .values([
    { po_id: po3.id, line_no: 1, project_id: prj('P-2026-014'), supplier_quotation_line_id: null, description: 'Flexible coupling set, DN200, marine grade', uom: 'set', qty: '8', unit_price: '640.00' },
    { po_id: po3.id, line_no: 2, project_id: prj('P-2026-014'), supplier_quotation_line_id: null, description: 'Anti-vibration mounts, pump base', uom: 'set', qty: '4', unit_price: '1180.00' },
  ])
  .execute()

// ----- ledger ----------------------------------------------------------------
// One immutable row per money event. Profit is a GROUP BY on this table.

type LedgerRow = {
  project_id: number
  entry_date: string
  direction: 'cost' | 'revenue'
  category: string
  description: string
  amount_doc: string
  currency: string
  fx_rate: string
  source_type: string
  source_id: number | null
  posted_by: number
}

const ledger: LedgerRow[] = []

function post(r: Omit<LedgerRow, 'fx_rate'> & { fx_rate?: string }) {
  ledger.push({ ...r, fx_rate: r.fx_rate ?? '1.00000000' })
}

// Goods cost, from the approved PO lines.
post({ project_id: prj('P-2026-014'), entry_date: '2026-07-28', direction: 'cost', category: 'goods', description: 'PO-2026-0308 — pumps, motors, control panels', amount_doc: D.format(D.sum([D.lineTotal('4', '9250.00'), D.lineTotal('4', '5120.00'), D.lineTotal('2', '13900.00')]), 2), currency: 'EUR', source_type: 'purchase_order', source_id: po1.id, posted_by: ravi })
post({ project_id: prj('P-2026-014'), entry_date: '2026-07-29', direction: 'cost', category: 'goods', description: 'PO-2026-0311 lines 1-2 — valves and gaskets', amount_doc: D.format(D.sum([D.lineTotal('12', '985.00'), D.lineTotal('24', '71.00')]), 2), currency: 'EUR', source_type: 'purchase_order', source_id: po2.id, posted_by: ravi })
post({ project_id: prj('P-2026-019'), entry_date: '2026-07-29', direction: 'cost', category: 'goods', description: 'PO-2026-0311 line 3 — valves (consolidated order)', amount_doc: D.format(D.lineTotal('8', '985.00'), 2), currency: 'EUR', source_type: 'purchase_order', source_id: po2.id, posted_by: ravi })

// Landed cost. Freight arrives at shipment level and is ALLOCATED to the
// projects on that shipment by value — recorded as its own ledger entries so
// the allocation is visible and auditable, not buried inside a unit cost.
post({ project_id: prj('P-2026-014'), entry_date: '2026-08-12', direction: 'cost', category: 'freight', description: 'SHP-2026-0142 freight, allocated by value (81.4%)', amount_doc: '3421.60', currency: 'EUR', source_type: 'shipment', source_id: null, posted_by: maria })
post({ project_id: prj('P-2026-019'), entry_date: '2026-08-12', direction: 'cost', category: 'freight', description: 'SHP-2026-0142 freight, allocated by value (18.6%)', amount_doc: '781.40', currency: 'EUR', source_type: 'shipment', source_id: null, posted_by: maria })
post({ project_id: prj('P-2026-014'), entry_date: '2026-08-12', direction: 'cost', category: 'duty', description: 'Import duty and clearance, SHP-2026-0142', amount_doc: '1180.00', currency: 'EUR', source_type: 'shipment', source_id: null, posted_by: maria })
post({ project_id: prj('P-2026-014'), entry_date: '2026-08-14', direction: 'cost', category: 'other', description: 'DNV witness inspection, Bergen', amount_doc: '2650.00', currency: 'EUR', source_type: 'manual', source_id: null, posted_by: anna })

// Revenue, from the accepted customer quotation.
post({ project_id: prj('P-2026-014'), entry_date: '2026-07-25', direction: 'revenue', category: 'sale', description: 'CQ-2026-0142 accepted — MS Nordlys refit', amount_doc: D.format(D.sum([D.lineTotal('4', '12400.00'), D.lineTotal('12', '1420.00'), D.lineTotal('24', '112.00'), D.lineTotal('4', '6950.00'), D.lineTotal('2', '19800.00'), D.lineTotal('12', '1250.00')]), 2), currency: 'EUR', source_type: 'customer_quotation', source_id: cq.id, posted_by: anna })
post({ project_id: prj('P-2026-019'), entry_date: '2026-08-20', direction: 'revenue', category: 'sale', description: 'Contract HRT-2026-BWT, first instalment', amount_doc: '96000.00', currency: 'EUR', source_type: 'manual', source_id: null, posted_by: anna })

// A correction, done properly: the original entry stays, a reversing entry is
// posted against it, and the corrected figure goes in as a new row. Last
// month's report still reproduces exactly.
const wrongDuty = ledger.length
post({ project_id: prj('P-2026-014'), entry_date: '2026-08-15', direction: 'cost', category: 'handling', description: 'Port handling, Bergen (initial invoice)', amount_doc: '2400.00', currency: 'EUR', source_type: 'manual', source_id: null, posted_by: maria })

const inserted = await db
  .insertInto('project_ledger')
  .values(
    ledger.map((l) => ({
      ...l,
      amount_base: D.format(D.mul(D.parse(l.amount_doc), D.parse(l.fx_rate)), 2),
    })),
  )
  .returning(['id'])
  .execute()

const wrongId = inserted[wrongDuty]!.id
await db
  .insertInto('project_ledger')
  .values([
    { project_id: prj('P-2026-014'), entry_date: '2026-08-22', direction: 'cost', category: 'handling', description: 'Reversal of port handling initial invoice (supplier credit note)', amount_doc: '-2400.00', currency: 'EUR', fx_rate: '1.00000000', amount_base: '-2400.00', source_type: 'manual', source_id: null, reversal_of_id: wrongId, posted_by: anna },
    { project_id: prj('P-2026-014'), entry_date: '2026-08-22', direction: 'cost', category: 'handling', description: 'Port handling, Bergen (corrected invoice)', amount_doc: '1870.00', currency: 'EUR', fx_rate: '1.00000000', amount_base: '1870.00', source_type: 'manual', source_id: null, posted_by: anna },
  ])
  .execute()

// ----- audit history ---------------------------------------------------------

await db
  .insertInto('audit_log')
  .values([
    { at: new Date('2026-07-08T09:00:11Z'), actor_user_id: ravi, actor_ip: '10.20.4.31', request_id: 'seed', entity_type: 'rfq', entity_id: String(rfq.id), action: 'rfq.create', summary: 'Created RFQ-2026-0087 for P-2026-014', diff: null, context: JSON.stringify({ lines: 5 }) },
    { at: new Date('2026-07-08T09:05:02Z'), actor_user_id: ravi, actor_ip: '10.20.4.31', request_id: 'seed', entity_type: 'rfq', entity_id: String(rfq.id), action: 'rfq.issue', summary: 'Issued RFQ-2026-0087 to 3 suppliers', diff: JSON.stringify({ status: { from: 'draft', to: 'issued' } }), context: JSON.stringify({ suppliers: ['S-2001', 'S-2002', 'S-2003'] }) },
    { at: new Date('2026-07-16T11:22:40Z'), actor_user_id: ravi, actor_ip: '10.20.4.31', request_id: 'seed', entity_type: 'supplier_quotation', entity_id: String(qHanse.id), action: 'supplier_quote.record', summary: 'Recorded SQ-2026-0201 from Hanseatic Pumpentechnik GmbH', diff: null, context: JSON.stringify({ currency: 'EUR', lines: 5 }) },
    { at: new Date('2026-07-18T15:04:19Z'), actor_user_id: ravi, actor_ip: '10.20.4.31', request_id: 'seed', entity_type: 'supplier_quotation', entity_id: String(qFerrara.id), action: 'supplier_quote.record', summary: 'Recorded SQ-2026-0204 from Ferrara Valvole S.p.A.', diff: null, context: JSON.stringify({ currency: 'EUR', lines: 5 }) },
    { at: new Date('2026-07-21T08:51:06Z'), actor_user_id: ravi, actor_ip: '10.20.4.31', request_id: 'seed', entity_type: 'supplier_quotation', entity_id: String(qNingbo.id), action: 'supplier_quote.record', summary: 'Recorded SQ-2026-0209 from Ningbo Fluid Control Co. Ltd', diff: null, context: JSON.stringify({ currency: 'USD', fx_rate: '0.918', lines: 5 }) },
    { at: new Date('2026-07-25T16:30:00Z'), actor_user_id: anna, actor_ip: '10.20.4.8', request_id: 'seed', entity_type: 'customer_quotation', entity_id: String(cq.id), action: 'customer_quote.issue', summary: 'Issued CQ-2026-0142 to Baltic Ferry Lines AS', diff: JSON.stringify({ status: { from: 'draft', to: 'issued' } }), context: null },
    { at: new Date('2026-07-28T13:58:22Z'), actor_user_id: ravi, actor_ip: '10.20.4.31', request_id: 'seed', entity_type: 'purchase_order', entity_id: String(po1.id), action: 'po.create', summary: 'Created PO-2026-0308 to Hanseatic Pumpentechnik GmbH', diff: null, context: JSON.stringify({ lines: 3, from_quotation: 'SQ-2026-0201' }) },
    { at: new Date('2026-07-28T14:12:03Z'), actor_user_id: anna, actor_ip: '10.20.4.8', request_id: 'seed', entity_type: 'purchase_order', entity_id: String(po1.id), action: 'po.approve', summary: 'Approved PO-2026-0308 (EUR 85,280.00)', diff: JSON.stringify({ status: { from: 'pending_approval', to: 'approved' } }), context: JSON.stringify({ approval_threshold: 'EUR 25,000 — director approval required' }) },
    { at: new Date('2026-07-29T10:40:55Z'), actor_user_id: anna, actor_ip: '10.20.4.8', request_id: 'seed', entity_type: 'purchase_order', entity_id: String(po2.id), action: 'po.approve', summary: 'Approved PO-2026-0311 (EUR 21,404.00)', diff: JSON.stringify({ status: { from: 'pending_approval', to: 'approved' } }), context: JSON.stringify({ spans_projects: ['P-2026-014', 'P-2026-019'] }) },
    { at: new Date('2026-08-22T09:14:31Z'), actor_user_id: anna, actor_ip: '10.20.4.8', request_id: 'seed', entity_type: 'project_ledger', entity_id: String(wrongId), action: 'ledger.reverse', summary: 'Reversed port handling entry and posted corrected amount', diff: JSON.stringify({ amount_base: { from: '2400.00', to: '1870.00' } }), context: JSON.stringify({ reason: 'Supplier credit note CN-8841' }) },
  ])
  .execute()

// ----- documents -------------------------------------------------------------
// A few real (if minimal) PDFs so a fresh install has something to open, and so
// the download path is exercised the moment you sign in rather than only after
// you upload something yourself.

await rm(STORAGE_ROOT, { recursive: true, force: true })

/** A valid, minimal single-page PDF with one line of text on it. */
function tinyPdf(text: string): Buffer {
  const content = `BT /F1 11 Tf 40 120 Td (${text.replace(/[()\\]/g, '')}) Tj ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 160]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

async function attach(
  entityType: string,
  entityId: number,
  filename: string,
  description: string,
  uploadedBy: number,
  bodyText: string,
) {
  const body = tinyPdf(bodyText)
  const stored = `${randomUUID()}.pdf`
  const rel = join('2026', '07', stored)
  const abs = join(STORAGE_ROOT, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, body)
  await db
    .insertInto('documents')
    .values({
      entity_type: entityType,
      entity_id: entityId,
      original_filename: filename,
      stored_name: stored,
      storage_path: rel.split(/[\\/]/).join('/'),
      mime_type: 'application/pdf',
      byte_size: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      description,
      uploaded_by: uploadedBy,
    })
    .execute()
}

await attach('supplier', sup('S-2001'), 'hanseatic-iso9001-certificate.pdf', 'ISO 9001 certificate, valid to 2028', ravi, 'Hanseatic Pumpentechnik GmbH - ISO 9001:2015 certificate (demo document)')
await attach('supplier', sup('S-2003'), 'ningbo-supplier-questionnaire.pdf', 'Supplier questionnaire, returned 2026-06', ravi, 'Ningbo Fluid Control Co. Ltd - supplier questionnaire (demo document)')
await attach('rfq', rfq.id, 'RFQ-2026-0087-technical-spec.pdf', 'Technical specification issued with the RFQ', ravi, 'RFQ-2026-0087 - technical specification, MS Nordlys pump refit (demo document)')
await attach('rfq', rfq.id, 'SQ-2026-0209-as-received.pdf', 'Ningbo quotation exactly as received by email', ravi, 'SQ-2026-0209 - supplier quotation as received (demo document)')
await attach('purchase_order', po1.id, 'PO-2026-0308-signed.pdf', 'Countersigned order confirmation', anna, 'PO-2026-0308 - countersigned order confirmation (demo document)')
await attach('project', prj('P-2026-014'), 'BFL-REFIT-2026-014-contract.pdf', 'Customer contract, redacted copy', anna, 'Baltic Ferry Lines AS - contract BFL/REFIT/2026-014 (demo document)')

console.log('seed complete')
console.log('  users: anna.meyer@nordwind-demo.com / ravi.kumar@nordwind-demo.com / maria.santos@nordwind-demo.com')
console.log('  password for all three: demo1234')

await db.destroy()
