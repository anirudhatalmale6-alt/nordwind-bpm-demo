import type { Transaction } from 'kysely'
import type { DB } from '../db/types.ts'

export interface AuditActor {
  userId: number | null
  ip: string
  requestId: string
}

export interface AuditEntry {
  entityType: string
  entityId: string | number
  action: string // the INTENT, e.g. 'po.approve' — never 'UPDATE purchase_orders'
  summary: string
  diff?: Record<string, { from: unknown; to: unknown }> | null
  context?: Record<string, unknown> | null
}

/**
 * Writes one audit row. Takes a Transaction, not the Kysely instance, and that
 * signature is the whole design:
 *
 *   - The log row is written inside the SAME transaction as the change it
 *     describes. If the log write fails, the change rolls back. There is no
 *     code path that mutates a record and leaves no trace, because it is
 *     physically one commit.
 *
 *   - It records intent. A database trigger can only tell you
 *     `UPDATE purchase_orders SET status='approved'`. This records `po.approve`,
 *     by whom, on which PO, with the approval threshold that applied. That is
 *     what an auditor — or you, six months later — is actually asking.
 *
 * The application's database role has INSERT and SELECT on audit_log and no
 * UPDATE or DELETE (see migration 002), so even a bug in this file cannot
 * rewrite history.
 */
export async function writeAudit(
  trx: Transaction<DB>,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<void> {
  await trx
    .insertInto('audit_log')
    .values({
      actor_user_id: actor.userId,
      actor_ip: actor.ip,
      request_id: actor.requestId,
      entity_type: entry.entityType,
      entity_id: String(entry.entityId),
      action: entry.action,
      summary: entry.summary,
      diff: entry.diff ? JSON.stringify(entry.diff) : null,
      context: entry.context ? JSON.stringify(entry.context) : null,
    })
    .execute()
}

/** Before/after for changed fields only — unchanged fields are noise. */
export function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, to] of Object.entries(after)) {
    const from = before[key]
    if (String(from) !== String(to)) out[key] = { from, to }
  }
  return out
}
