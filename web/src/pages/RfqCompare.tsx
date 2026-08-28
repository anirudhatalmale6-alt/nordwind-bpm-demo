import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, useApi, type RfqCompare as RC } from '../api'
import { Loading, Money, StatusPill } from '../components/bits'
import { RawPanel } from '../components/Raw'

export function RfqCompare({ perms }: { perms: Set<string> }) {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const q = useApi<RC>(['rfq', id], `/api/rfqs/${id}`)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>

  const d = q.data!.data
  const showPrices = perms.has('project.cost.read')
  const canCreatePo = perms.has('po.create')

  function toggle(lineId: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }

  // Group the picked cells by quotation, because a purchase order goes to
  // exactly one supplier. Picking the cheapest cell on every row usually means
  // two or three orders, and the screen should say so rather than silently
  // choosing one.
  const groups = d.quotations
    .map((quote) => {
      const lines = Object.values(d.cells)
        .map((row) => row[String(quote.id)])
        .filter((c): c is NonNullable<typeof c> => !!c && picked.has(c.quotation_line_id))
      const total = lines.reduce((t, c) => t + Number(c.line_total_base ?? 0), 0)
      return { quote, lines, total }
    })
    .filter((g) => g.lines.length > 0)

  async function createPo(quotationId: number, lineIds: number[]) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await api<{ ref: string; status: string; total: string; currency: string; requires_director_approval: boolean }>(
        '/api/purchase-orders',
        {
          method: 'POST',
          body: JSON.stringify({ supplier_quotation_id: quotationId, quotation_line_ids: lineIds }),
        },
      )
      setPicked(new Set())
      await qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setMsg(
        `${res.data.ref} created for ${res.data.currency} ${res.data.total} — status ${res.data.status.replace(/_/g, ' ')}. ` +
          `Cost reaches the project ledger when it is approved, not before.`,
      )
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not create the purchase order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {d.rfq.ref} — {d.rfq.title}
          </h2>
          <StatusPill status={d.rfq.status} />
          <span className="spacer" />
          <span className="hint">
            <Link to={`/projects/${d.rfq.project.id}`}>{d.rfq.project.code}</Link> · issued{' '}
            {d.rfq.issued_at?.slice(0, 10)} · due {d.rfq.due_at?.slice(0, 10)} · raised by{' '}
            {d.rfq.created_by_name}
          </span>
        </div>
        {d.rfq.notes ? (
          <div className="card-body" style={{ paddingTop: 12, paddingBottom: 12 }}>
            <span className="muted small">Terms: </span>
            <span className="small">{d.rfq.notes}</span>
          </div>
        ) : null}
      </div>

      {msg ? <div className="notice info">{msg}</div> : null}

      <div className="card">
        <div className="card-head">
          <h2>Quotation comparison</h2>
          <span className="hint">
            all prices converted to {d.summary.base_currency} using each quotation's own FX rate as
            at its own date · cheapest per line shaded
            {canCreatePo && showPrices ? ' · click cells to build a purchase order' : ''}
          </span>
        </div>
        <div className="table-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Requirement</th>
                <th className="num" style={{ textAlign: 'right' }}>
                  Qty
                </th>
                {d.quotations.map((quote) => (
                  <th key={quote.id} className="sup">
                    <div className="sup-name">{quote.supplier.name}</div>
                    <div className="sup-meta">
                      {quote.ref} · {quote.supplier.country} · {quote.currency}
                      {quote.currency !== d.summary.base_currency
                        ? ` @ ${Number(quote.fx_rate).toFixed(4)}`
                        : ''}
                    </div>
                    <div className="sup-meta">
                      {quote.incoterm} · {quote.lead_time_days} days · {quote.payment_terms}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <div className="desc">{line.description}</div>
                    <div className="desc-sub">line {line.line_no}</div>
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {Number(line.qty).toFixed(0)} {line.uom}
                  </td>
                  {d.quotations.map((quote) => {
                    const cell = d.cells[String(line.id)]?.[String(quote.id)]
                    if (!cell) {
                      return (
                        <td key={quote.id} className="cell muted small">
                          not quoted
                        </td>
                      )
                    }
                    const isPicked = picked.has(cell.quotation_line_id)
                    const clickable = canCreatePo && showPrices
                    return (
                      <td
                        key={quote.id}
                        className={`cell${cell.is_best ? ' best' : ''}${isPicked ? ' picked' : ''}`}
                        onClick={clickable ? () => toggle(cell.quotation_line_id) : undefined}
                        style={clickable ? undefined : { cursor: 'default' }}
                      >
                        {showPrices ? (
                          <>
                            <div className="cell-price">
                              <Money value={cell.unit_price} currency={quote.currency} />
                            </div>
                            <div className="cell-sub">
                              {quote.currency !== d.summary.base_currency ? (
                                <>
                                  = {d.summary.base_currency} {Number(cell.unit_price_base).toFixed(2)} ·{' '}
                                </>
                              ) : null}
                              line {Number(cell.line_total_base).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ·{' '}
                              {cell.lead_time_days}d
                            </div>
                          </>
                        ) : (
                          <div className="muted small">quoted</div>
                        )}
                        {cell.note ? <div className="cell-note">{cell.note}</div> : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            {showPrices && (
              <tfoot>
                <tr>
                  <td colSpan={2}>Quotation total ({d.summary.base_currency})</td>
                  {d.quotations.map((quote) => (
                    <td key={quote.id} className="num" style={{ textAlign: 'left' }}>
                      <Money value={quote.total} />
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {showPrices && (
        <div className="notice">
          Cheapest single supplier is {d.summary.cheapest_single_supplier?.supplier} at{' '}
          {d.summary.base_currency}{' '}
          {Number(d.summary.cheapest_single_supplier?.total ?? 0).toLocaleString('en-GB', {
            minimumFractionDigits: 2,
          })}
          . Cherry-picking the cheapest line from each supplier gives {d.summary.base_currency}{' '}
          {Number(d.summary.cherry_picked_total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
          {Number(d.summary.cherry_picked_total) === Number(d.summary.cheapest_single_supplier?.total ?? -1)
            ? ' — the same figure, because that supplier happens to be cheapest on every line'
            : ` — ${(
                Number(d.summary.cheapest_single_supplier?.total ?? 0) -
                Number(d.summary.cherry_picked_total)
              ).toLocaleString('en-GB', { minimumFractionDigits: 2 })} less, spread across two orders`}
          . Note that lead time and certification sit next to the price on purpose — on this RFQ the
          cheapest supplier quotes 62–75 days and, on the control panel, no marine approval at all.
          A comparison that shows only money makes the wrong decision look obvious.
        </div>
      )}

      {groups.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Selected lines</h2>
            <span className="hint">
              a purchase order goes to one supplier, so a mixed selection becomes one order per
              supplier
            </span>
            <span className="spacer" />
            <button className="btn small" onClick={() => setPicked(new Set())}>
              clear
            </button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Lines</th>
                  <th className="num">Total ({d.summary.base_currency})</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.quote.id}>
                    <td className="desc">{g.quote.supplier.name}</td>
                    <td className="num">{g.lines.length}</td>
                    <td className="num">
                      {g.total.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn primary small"
                        disabled={busy}
                        onClick={() =>
                          void createPo(
                            g.quote.id,
                            g.lines.map((l) => l.quotation_line_id),
                          )
                        }
                      >
                        Create purchase order
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            <span className="small muted">
              The new order is raised as pending approval and carries a link from each line back to
              the exact quotation line it came from, so “why did we pay this?” is answerable months
              later.{' '}
              <button className="btn small" onClick={() => nav('/purchase-orders')}>
                go to purchase orders
              </button>
            </span>
          </div>
        </div>
      )}

      <RawPanel raw={q.data?.raw} redacted={d._redacted} />
    </>
  )
}
