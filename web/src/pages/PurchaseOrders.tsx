import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, useApi, type PoDetail, type PoRow } from '../api'
import { Loading, Money, StatusPill } from '../components/bits'
import { RawPanel } from '../components/Raw'

export function PurchaseOrders({ perms }: { perms: Set<string> }) {
  const q = useApi<{ purchase_orders: PoRow[]; _redacted?: { fields: string[]; note: string } }>(
    ['purchase-orders'],
    '/api/purchase-orders',
  )
  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>

  const rows = q.data!.data.purchase_orders
  const showCost = perms.has('project.cost.read')

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Purchase orders</h2>
          <span className="hint">
            a PO can cover more than one project — consolidating to hit a price break is normal, so
            the project sits on the line, not the header
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Supplier</th>
                <th>Projects</th>
                <th>Status</th>
                <th className="num">Lines</th>
                {showCost && <th className="num">Total</th>}
                <th>Ordered</th>
                <th>Raised by</th>
                <th>Approved by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr key={po.id}>
                  <td className="mono">
                    <Link to={`/purchase-orders/${po.id}`}>{po.ref}</Link>
                  </td>
                  <td className="desc">{po.supplier_name}</td>
                  <td className="mono small">{po.projects.join(', ')}</td>
                  <td>
                    <StatusPill status={po.status} />
                  </td>
                  <td className="num">{po.line_count}</td>
                  {showCost && (
                    <td className="num">
                      <Money value={po.total} currency={po.currency} />
                    </td>
                  )}
                  <td className="small muted">{po.ordered_at?.slice(0, 10) ?? '—'}</td>
                  <td className="small">{po.created_by_name ?? '—'}</td>
                  <td className="small">{po.approved_by_name ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <RawPanel raw={q.data?.raw} redacted={q.data?.data._redacted} />
    </>
  )
}

export function PoDetailPage({ perms }: { perms: Set<string> }) {
  const { id } = useParams()
  const qc = useQueryClient()
  const q = useApi<PoDetail>(['purchase-order', id], `/api/purchase-orders/${id}`)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>

  const po = q.data!.data
  const showCost = perms.has('project.cost.read')
  const canApprove = perms.has('po.approve')

  async function approve() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await api<{ ref: string; ledger_entries_posted: number }>(
        `/api/purchase-orders/${id}/approve`,
        { method: 'POST' },
      )
      setMsg(
        `${res.data.ref} approved. ${res.data.ledger_entries_posted} cost entr${
          res.data.ledger_entries_posted === 1 ? 'y' : 'ies'
        } posted to the project ledger, in the same transaction as the approval and the audit row.`,
      )
      await qc.invalidateQueries()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>{po.ref}</h2>
          <StatusPill status={po.status} />
          <span className="spacer" />
          <span className="hint">
            {po.supplier_name} ({po.supplier_country}) · {po.incoterm} · {po.payment_terms} ·
            ordered {po.ordered_at?.slice(0, 10)}
          </span>
          {po.status === 'pending_approval' && canApprove ? (
            <button className="btn primary small" disabled={busy} onClick={() => void approve()}>
              {busy ? 'Approving…' : 'Approve'}
            </button>
          ) : null}
        </div>
        <div className="card-body" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <span className="small muted">
            Raised by {po.created_by_name}
            {po.approved_by_name ? ` · approved by ${po.approved_by_name}` : ''}
            {po.requires_director_approval
              ? ' · above the EUR 25,000 threshold, so director approval is required'
              : ''}
            . A purchase order cannot be approved by the person who raised it.
          </span>
        </div>
      </div>

      {msg ? <div className="notice info">{msg}</div> : null}

      {po.status === 'pending_approval' && !canApprove ? (
        <div className="notice">
          This order is waiting for approval. Your role does not hold <code>po.approve</code>, so
          the button is not shown — and the endpoint returns 403 if called directly, which is the
          part that actually matters.
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <h2>Lines</h2>
          <span className="hint">each line carries its own project and a link back to the quotation it came from</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>Project</th>
                <th>From quote</th>
                <th className="num">Qty</th>
                <th>UoM</th>
                {showCost && <th className="num">Unit price</th>}
                {showCost && <th className="num">Line total</th>}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{l.line_no}</td>
                  <td className="desc">{l.description}</td>
                  <td className="mono small">{l.project_code}</td>
                  <td className="mono small muted">{l.from_quotation_ref ?? '—'}</td>
                  <td className="num">{Number(l.qty).toFixed(0)}</td>
                  <td className="muted">{l.uom}</td>
                  {showCost && (
                    <td className="num">
                      <Money value={l.unit_price} />
                    </td>
                  )}
                  {showCost && (
                    <td className="num">
                      <Money value={l.line_total} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {showCost && (
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ textAlign: 'right', fontWeight: 600, padding: '9px 12px' }}>
                    Order total
                  </td>
                  <td className="num" style={{ fontWeight: 600, padding: '9px 12px' }}>
                    <Money value={po.total} currency={po.currency} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <RawPanel raw={q.data?.raw} redacted={po._redacted} />
    </>
  )
}
