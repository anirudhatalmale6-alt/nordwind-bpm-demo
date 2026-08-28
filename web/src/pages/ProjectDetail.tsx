import { useParams } from 'react-router-dom'
import { useApi, type ProjectDetail as PD } from '../api'
import { Loading, LockedStat, Money, Stat, StatusPill } from '../components/bits'
import { RawPanel } from '../components/Raw'

export function ProjectDetail({ perms }: { perms: Set<string> }) {
  const { id } = useParams()
  const q = useApi<PD>(['project', id], `/api/projects/${id}`)

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>
  const p = q.data!.data

  const showCost = perms.has('project.cost.read')
  const showRevenue = perms.has('project.revenue.read')
  const showMargin = perms.has('project.margin.read')

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {p.code} — {p.name}
          </h2>
          <StatusPill status={p.status} />
          <span className="spacer" />
          <span className="hint">
            {p.customer.name} ({p.customer.country}) · contract {p.contract_ref} · manager{' '}
            {p.manager_name ?? '—'}
          </span>
        </div>
      </div>

      <div className="stat-row">
        {showCost ? (
          <Stat
            label="Total cost"
            value={<Money value={p.financials.cost_base} currency={p.currency} />}
            note="goods, freight, duty, handling"
          />
        ) : (
          <LockedStat label="Total cost" permission="project.cost.read" />
        )}

        {showRevenue ? (
          <Stat label="Revenue" value={<Money value={p.financials.revenue_base} currency={p.currency} />} />
        ) : (
          <LockedStat label="Revenue" permission="project.revenue.read" />
        )}

        {showMargin ? (
          <Stat
            label="Margin"
            value={<Money value={p.financials.margin_base} currency={p.currency} />}
            tone={Number(p.financials.margin_base ?? 0) >= 0 ? 'pos' : 'neg'}
          />
        ) : (
          <LockedStat label="Margin" permission="project.margin.read" />
        )}

        {showMargin ? (
          <Stat
            label="Margin %"
            value={
              p.financials.margin_pct === null || p.financials.margin_pct === undefined
                ? 'n/a'
                : `${p.financials.margin_pct.toFixed(1)}%`
            }
            note={p.financials.margin_pct === null ? 'no revenue recorded yet' : 'of revenue'}
          />
        ) : (
          <LockedStat label="Margin %" permission="project.margin.read" />
        )}
      </div>

      {showCost && p.financials.cost_breakdown?.length ? (
        <div className="card">
          <div className="card-head">
            <h2>Cost breakdown</h2>
            <span className="hint">
              freight and duty are allocated to the project as their own ledger entries, not buried
              inside a unit cost
            </span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.financials.cost_breakdown.map((c) => (
                  <tr key={c.category}>
                    <td style={{ textTransform: 'capitalize' }}>{c.category}</td>
                    <td className="num">
                      <Money value={c.amount_base} currency={p.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <h2>Project items</h2>
          <span className="hint">the demand — what this project needs to buy</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Item code</th>
                <th>Description</th>
                <th className="num">Qty</th>
                <th>UoM</th>
                {showRevenue && <th className="num">Target sell price</th>}
              </tr>
            </thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td className="muted">{i.line_no}</td>
                  <td className="mono">{i.item_code}</td>
                  <td className="desc">{i.description}</td>
                  <td className="num">{Number(i.qty).toFixed(0)}</td>
                  <td className="muted">{i.uom}</td>
                  {showRevenue && (
                    <td className="num">
                      <Money value={i.target_unit_price ?? undefined} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Project ledger</h2>
          <span className="hint">
            one immutable row per money event — corrections post a reversing entry, they never edit
            history
          </span>
        </div>
        {p.ledger.length === 0 ? (
          <div className="empty">
            Your role holds neither <code>project.cost.read</code> nor{' '}
            <code>project.revenue.read</code>, so no ledger rows were returned. Not filtered in the
            browser — the rows are not in the response.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Dir</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="num">Amount (doc)</th>
                  <th>Cur</th>
                  <th className="num">FX</th>
                  <th className="num">Amount (base)</th>
                  <th>Posted by</th>
                </tr>
              </thead>
              <tbody>
                {p.ledger.map((l) => (
                  <tr key={l.id} style={l.is_reversal ? { background: '#fdf1de55' } : undefined}>
                    <td className="mono small">{l.entry_date}</td>
                    <td>
                      <span className={`pill ${l.direction === 'revenue' ? 'blue' : 'grey'}`}>
                        {l.direction}
                      </span>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{l.category}</td>
                    <td className="desc">
                      {l.description}
                      {l.is_reversal ? <div className="desc-sub">reversing entry</div> : null}
                    </td>
                    <td className="num">
                      <Money value={l.amount_doc} />
                    </td>
                    <td className="muted small">{l.currency}</td>
                    <td className="num muted small">{Number(l.fx_rate).toFixed(4)}</td>
                    <td className="num">
                      <Money value={l.amount_base} />
                    </td>
                    <td className="small muted">{l.posted_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RawPanel raw={q.data?.raw} redacted={p._redacted} />
    </>
  )
}
