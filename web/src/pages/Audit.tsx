import { useState } from 'react'
import { api, useApi, type AuditEntry } from '../api'
import { Loading } from '../components/bits'
import { RawPanel } from '../components/Raw'

interface TamperResult {
  connected_as: string
  target_row: { id: string; summary: string }
  attempts: Array<{ statement: string; result: string; error: string | null }>
  row_after: { id: string; summary: string }
  note: string
}

export function Audit() {
  const q = useApi<{ entries: AuditEntry[] }>(['audit'], '/api/audit?limit=200')
  const [tamper, setTamper] = useState<TamperResult | null>(null)
  const [busy, setBusy] = useState(false)

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>
  const entries = q.data!.data.entries

  async function runTamper() {
    setBusy(true)
    try {
      const res = await api<TamperResult>('/api/audit/tamper-test', { method: 'POST' })
      setTamper(res.data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Append-only, demonstrated</h2>
          <span className="spacer" />
          <button className="btn small" disabled={busy} onClick={() => void runTamper()}>
            {busy ? 'Running…' : 'Try to alter an audit row'}
          </button>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0, fontSize: 13 }}>
            The application connects to PostgreSQL as <code>bpm_app</code>, a role granted{' '}
            <code>SELECT</code> and <code>INSERT</code> on <code>audit_log</code> and deliberately
            not <code>UPDATE</code> or <code>DELETE</code>. Press the button and the server will ask
            the database to modify an audit row, on the same connection it uses for everything else.
            It is expected to fail, and you get the raw PostgreSQL error back. The guarantee is a
            grant, not a promise in a document.
          </p>
          {tamper ? (
            <>
              <table className="data" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Statement</th>
                    <th>Result</th>
                    <th>PostgreSQL says</th>
                  </tr>
                </thead>
                <tbody>
                  {tamper.attempts.map((a) => (
                    <tr key={a.statement}>
                      <td className="mono small">{a.statement}</td>
                      <td>
                        <span className={`pill ${a.error ? 'green' : 'red'}`}>{a.result}</span>
                      </td>
                      <td className="mono small">{a.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ marginBottom: 0 }}>
                Connected as <code>{tamper.connected_as}</code>. Row {tamper.target_row.id} still
                reads “{tamper.row_after.summary}”.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Activity log</h2>
          <span className="hint">
            {entries.length} entries · written in the same transaction as the change they describe,
            recorded as intent rather than as SQL
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>What happened</th>
                <th>Entity</th>
                <th>Who</th>
                <th>IP</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono small muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td>
                    <span className="pill blue">{e.action}</span>
                  </td>
                  <td className="desc">{e.summary}</td>
                  <td className="mono small muted">
                    {e.entity_type}#{e.entity_id}
                  </td>
                  <td className="small">
                    {e.actor_name ?? <span className="muted">—</span>}
                    {e.actor_role ? <div className="desc-sub">{e.actor_role}</div> : null}
                  </td>
                  <td className="mono small muted">{e.actor_ip}</td>
                  <td className="small">
                    {e.diff
                      ? Object.entries(e.diff).map(([k, v]) => (
                          <div key={k} className="mono" style={{ fontSize: 11 }}>
                            {k}: {String(v.from)} → {String(v.to)}
                          </div>
                        ))
                      : null}
                    {e.context
                      ? Object.entries(e.context).map(([k, v]) => (
                          <div key={k} className="muted" style={{ fontSize: 11 }}>
                            {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </div>
                        ))
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RawPanel raw={q.data?.raw} />
    </>
  )
}
