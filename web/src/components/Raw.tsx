import { useState, type ReactNode } from 'react'
import type { Redacted } from '../api'

/**
 * The raw-response viewer.
 *
 * Every screen in this demo can show you the exact JSON the server sent for the
 * page you are looking at. That is the point of the whole exercise: when a
 * manager sees a margin and a buyer does not, you can check that the buyer's
 * response genuinely does not contain the number, rather than taking my word
 * that the UI is hiding it responsibly.
 */
export function RawPanel({
  raw,
  redacted,
  label = 'Raw API response',
}: {
  raw: string | undefined
  redacted?: Redacted
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (!raw) return null

  let pretty = raw
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    /* leave as-is */
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{label}</h2>
        <span className="hint">
          {redacted?.fields.length
            ? `${redacted.fields.length} field(s) removed by the server for your role`
            : 'exactly what came over the wire'}
        </span>
        <span className="spacer" />
        <button className="raw-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide' : 'show'} JSON
        </button>
      </div>
      {redacted?.fields.length ? (
        <div style={{ padding: '12px 16px 0' }}>
          <div className="notice">
            <strong>Withheld from this response:</strong>{' '}
            {redacted.fields.map((f) => (
              <code key={f} style={{ marginRight: 8 }}>
                {f}
              </code>
            ))}
            <div style={{ marginTop: 6, fontSize: 12.5 }}>{redacted.note}</div>
          </div>
        </div>
      ) : null}
      {open && (
        <div className="card-body">
          <pre className="raw">{highlight(pretty)}</pre>
        </div>
      )}
    </div>
  )
}

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?\b)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) out.push(json.slice(last, m.index))
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push(
        <span key={i++} className="k">
          {m[1]}
        </span>,
        m[2],
      )
    } else if (m[1] !== undefined) {
      out.push(
        <span key={i++} className="s">
          {m[1]}
        </span>,
      )
    } else if (m[3] !== undefined) {
      out.push(
        <span key={i++} className="n">
          {m[3]}
        </span>,
      )
    }
    last = re.lastIndex
  }
  out.push(json.slice(last))
  return out
}
