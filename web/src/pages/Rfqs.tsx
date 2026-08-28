import { Link } from 'react-router-dom'
import { useApi, type RfqRow } from '../api'
import { Loading, StatusPill } from '../components/bits'
import { RawPanel } from '../components/Raw'

export function Rfqs() {
  const q = useApi<{ rfqs: RfqRow[] }>(['rfqs'], '/api/rfqs')

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>
  const rows = q.data!.data.rfqs

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Requests for quotation</h2>
          <span className="hint">open one to compare the supplier responses side by side</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Title</th>
                <th>Project</th>
                <th>Status</th>
                <th className="num">Lines</th>
                <th className="num">Quotes</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Raised by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/rfqs/${r.id}`}>{r.ref}</Link>
                  </td>
                  <td className="desc">{r.title}</td>
                  <td className="small">
                    <span className="mono">{r.project_code}</span>
                    <div className="desc-sub">{r.project_name}</div>
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="num">{r.line_count}</td>
                  <td className="num">{r.quotation_count}</td>
                  <td className="small muted">{r.issued_at?.slice(0, 10) ?? '—'}</td>
                  <td className="small muted">{r.due_at?.slice(0, 10) ?? '—'}</td>
                  <td className="small">{r.created_by_name}</td>
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
