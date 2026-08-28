import { Link } from 'react-router-dom'
import { useApi, type ProjectRow } from '../api'
import { Loading, Money, StatusPill } from '../components/bits'
import { RawPanel } from '../components/Raw'

export function Projects({ perms }: { perms: Set<string> }) {
  const q = useApi<{ projects: ProjectRow[]; _redacted?: { fields: string[]; note: string } }>(
    ['projects'],
    '/api/projects',
  )

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>

  const rows = q.data?.data.projects ?? []
  const showCost = perms.has('project.cost.read')
  const showRevenue = perms.has('project.revenue.read')
  const showMargin = perms.has('project.margin.read')

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Projects</h2>
          <span className="hint">{rows.length} visible to you</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Project</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Dates</th>
                {showCost && <th className="num">Cost</th>}
                {showRevenue && <th className="num">Revenue</th>}
                {showMargin && <th className="num">Margin</th>}
                {showMargin && <th className="num">%</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">
                    <Link to={`/projects/${p.id}`}>{p.code}</Link>
                  </td>
                  <td className="desc">{p.name}</td>
                  <td>{p.customer_name}</td>
                  <td>
                    <StatusPill status={p.status} />
                  </td>
                  <td className="small muted">
                    {p.starts_on} → {p.ends_on}
                  </td>
                  {showCost && (
                    <td className="num">
                      <Money value={p.financials.cost_base} currency={p.currency} />
                    </td>
                  )}
                  {showRevenue && (
                    <td className="num">
                      <Money value={p.financials.revenue_base} currency={p.currency} />
                    </td>
                  )}
                  {showMargin && (
                    <td className="num">
                      <Money value={p.financials.margin_base} currency={p.currency} />
                    </td>
                  )}
                  {showMargin && (
                    <td className="num">
                      {p.financials.margin_pct === null ? (
                        <span className="muted" title="No revenue recorded yet — a rate with a zero denominator is undefined, not zero.">
                          n/a
                        </span>
                      ) : (
                        `${p.financials.margin_pct?.toFixed(1)}%`
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!showMargin && (
        <div className="notice">
          Your role does not hold <code>project.margin.read</code>, so the margin columns are absent
          from this table — and, more to the point, absent from the server's response. Open the raw
          JSON below and search it.
        </div>
      )}

      <RawPanel raw={q.data?.raw} redacted={q.data?.data._redacted} />
    </>
  )
}
