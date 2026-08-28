import type { ReactNode } from 'react'

export function Pill({ children, tone = 'grey' }: { children: ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

const STATUS_TONE: Record<string, string> = {
  draft: 'grey',
  issued: 'blue',
  closed: 'grey',
  received: 'blue',
  selected: 'green',
  rejected: 'red',
  approved: 'green',
  pending_approval: 'amber',
  sent: 'blue',
  accepted: 'green',
  active: 'green',
  cancelled: 'red',
  lost: 'red',
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'grey'}>{status.replace(/_/g, ' ')}</Pill>
}

export function Money({ value, currency }: { value: string | undefined; currency?: string }) {
  if (value === undefined) return <span className="muted">—</span>
  const n = Number(value)
  const formatted = Number.isFinite(n)
    ? n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value
  return (
    <span>
      {currency ? <span className="muted small">{currency} </span> : null}
      {formatted}
    </span>
  )
}

/**
 * A statistic the current role is not allowed to see.
 *
 * Deliberately explicit rather than silently absent: an internal system where
 * numbers quietly vanish for some people generates support tickets. Saying
 * "your role does not hold this permission" is both honest and self-documenting.
 */
export function LockedStat({ label, permission }: { label: string; permission: string }) {
  return (
    <div className="stat locked">
      <div className="label">{label}</div>
      <div className="value">Not visible</div>
      <div className="note">
        needs <code>{permission}</code>
      </div>
    </div>
  )
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${tone ? ' ' + tone : ''}`}>{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  )
}

export function Loading() {
  return <div className="empty">Loading…</div>
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="notice">{message}</div>
}
