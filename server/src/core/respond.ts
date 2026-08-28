import type { FastifyRequest } from 'fastify'
import { applyFieldPolicy, redactedFields, type FieldPolicy } from './projection.ts'

/**
 * Every route returns through here. One choke point, so the field policy cannot
 * be forgotten on one endpoint out of eleven.
 *
 * `_redacted` is a demo affordance: it names the fields that were removed for
 * this caller so you can watch the mechanism work without diffing two JSON
 * dumps by eye. It is behind a flag and off in production — telling a caller
 * exactly which fields exist and are being withheld is free reconnaissance.
 */
export function project<T extends object>(
  req: FastifyRequest,
  payload: T,
  policy: FieldPolicy,
): T & { _redacted?: { fields: string[]; note: string } } {
  const perms = req.auth?.perms ?? new Set<string>()
  const removed = redactedFields(policy, perms)
  const body = applyFieldPolicy(payload, policy, perms)

  if (process.env.DEMO_SHOW_REDACTIONS !== 'false' && removed.length > 0) {
    return {
      ...body,
      _redacted: {
        fields: removed,
        note:
          'These fields were removed by the server before this response was serialised. ' +
          'They are not in the payload, not hidden by the UI. Demo-only disclosure block.',
      },
    }
  }
  return body
}
