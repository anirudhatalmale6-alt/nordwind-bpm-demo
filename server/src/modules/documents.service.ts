import type { Db } from '../db/db.ts'
import type { AuthContext } from '../core/auth.ts'
import type { PermissionKey } from '../core/permissions.ts'

export const ENTITY_TYPES = [
  'project',
  'rfq',
  'supplier_quotation',
  'purchase_order',
  'supplier',
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

/** Which permission lets you read the record a document hangs off. */
const READ_PERMISSION: Record<EntityType, PermissionKey> = {
  project: 'project.read',
  rfq: 'rfq.read',
  supplier_quotation: 'supplier_quote.read',
  purchase_order: 'po.read',
  supplier: 'supplier.read',
}

export interface AccessResult {
  ok: boolean
  /** Set when the record exists but this user may not see it, for the audit trail. */
  reason?: 'no_permission' | 'out_of_scope' | 'not_found'
  label?: string
}

/**
 * Can this user see the record, and therefore its attachments?
 *
 * Access to a document is decided entirely by its owning record. There is no
 * per-file ACL, deliberately: a second permission model running in parallel is
 * a second thing to keep in step and a second thing to get wrong. If you may
 * read the purchase order, you may read what is stapled to it.
 *
 * Both halves are checked — the permission (can this role read POs at all) and
 * the row-level scope (is this particular PO on a project they are assigned
 * to). Skip the second and every user with po.read can pull every attachment in
 * the company.
 */
export async function checkEntityAccess(
  db: Db,
  auth: AuthContext,
  entityType: EntityType,
  entityId: number,
): Promise<AccessResult> {
  if (!auth.perms.has(READ_PERMISSION[entityType])) {
    return { ok: false, reason: 'no_permission' }
  }

  switch (entityType) {
    case 'supplier': {
      const row = await db
        .selectFrom('suppliers')
        .select(['id', 'name'])
        .where('id', '=', entityId)
        .executeTakeFirst()
      // Suppliers are company-wide master data, so no row-level scoping.
      return row ? { ok: true, label: row.name } : { ok: false, reason: 'not_found' }
    }

    case 'project': {
      const row = await db
        .selectFrom('projects')
        .select(['id', 'code'])
        .where('id', '=', entityId)
        .executeTakeFirst()
      if (!row) return { ok: false, reason: 'not_found' }
      if (!auth.scopeAllProjects && !auth.projectIds.has(row.id)) {
        return { ok: false, reason: 'out_of_scope' }
      }
      return { ok: true, label: row.code }
    }

    case 'rfq': {
      const row = await db
        .selectFrom('rfqs')
        .select(['id', 'ref', 'project_id'])
        .where('id', '=', entityId)
        .executeTakeFirst()
      if (!row) return { ok: false, reason: 'not_found' }
      if (!auth.scopeAllProjects && !auth.projectIds.has(row.project_id)) {
        return { ok: false, reason: 'out_of_scope' }
      }
      return { ok: true, label: row.ref }
    }

    case 'supplier_quotation': {
      const row = await db
        .selectFrom('supplier_quotations')
        .innerJoin('rfqs', 'rfqs.id', 'supplier_quotations.rfq_id')
        .select(['supplier_quotations.id', 'supplier_quotations.ref', 'rfqs.project_id'])
        .where('supplier_quotations.id', '=', entityId)
        .executeTakeFirst()
      if (!row) return { ok: false, reason: 'not_found' }
      if (!auth.scopeAllProjects && !auth.projectIds.has(row.project_id)) {
        return { ok: false, reason: 'out_of_scope' }
      }
      return { ok: true, label: row.ref }
    }

    case 'purchase_order': {
      const row = await db
        .selectFrom('purchase_orders')
        .select(['id', 'ref'])
        .where('id', '=', entityId)
        .executeTakeFirst()
      if (!row) return { ok: false, reason: 'not_found' }
      if (!auth.scopeAllProjects) {
        // A PO can span projects, so it is visible if ANY of its lines belongs
        // to a project this user is assigned to.
        const lines = await db
          .selectFrom('po_lines')
          .select('project_id')
          .where('po_id', '=', entityId)
          .execute()
        if (!lines.some((l) => auth.projectIds.has(l.project_id))) {
          return { ok: false, reason: 'out_of_scope' }
        }
      }
      return { ok: true, label: row.ref }
    }
  }
}

export async function listDocuments(db: Db, entityType: EntityType, entityId: number) {
  const rows = await db
    .selectFrom('documents')
    .innerJoin('users', 'users.id', 'documents.uploaded_by')
    .select([
      'documents.id',
      'documents.original_filename',
      'documents.mime_type',
      'documents.byte_size',
      'documents.sha256',
      'documents.description',
      'documents.uploaded_at',
      'users.full_name as uploaded_by_name',
    ])
    .where('documents.entity_type', '=', entityType)
    .where('documents.entity_id', '=', entityId)
    .where('documents.deleted_at', 'is', null)
    .orderBy('documents.uploaded_at', 'desc')
    .execute()

  return rows.map((r) => ({
    ...r,
    byte_size: Number(r.byte_size),
    // Short prefix only. The full digest is on the row if you need to prove a
    // file has not changed; the UI just needs something recognisable.
    sha256_short: r.sha256.slice(0, 12),
  }))
}
