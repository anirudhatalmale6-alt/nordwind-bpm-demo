import { useState } from 'react'
import { useApi } from '../api'
import { Loading, Pill } from '../components/bits'
import { Documents } from '../components/Documents'
import { RawPanel } from '../components/Raw'

interface SupplierRow {
  id: number
  code: string
  name: string
  country: string
  currency: string
  lead_time_days: number
  rating: string | null
  is_approved: boolean
}

export function Suppliers({ perms }: { perms: Set<string> }) {
  const q = useApi<{ suppliers: SupplierRow[] }>(['suppliers'], '/api/suppliers')
  const [selected, setSelected] = useState<SupplierRow | null>(null)

  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>
  const rows = q.data!.data.suppliers

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Suppliers</h2>
          <span className="hint">
            where the chain starts — select one to see its documents (certificates, framework
            agreements, price lists)
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Country</th>
                <th>Currency</th>
                <th className="num">Standard lead time</th>
                <th className="num">Rating</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s)}
                  style={{
                    cursor: 'pointer',
                    background: selected?.id === s.id ? 'var(--accent-soft)' : undefined,
                  }}
                >
                  <td className="mono">{s.code}</td>
                  <td className="desc">{s.name}</td>
                  <td>{s.country}</td>
                  <td className="muted">{s.currency}</td>
                  <td className="num">{s.lead_time_days} days</td>
                  <td className="num">{s.rating ?? <span className="muted">—</span>}</td>
                  <td>
                    {s.is_approved ? (
                      <Pill tone="green">approved</Pill>
                    ) : (
                      <Pill tone="amber">pending</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <Documents
          entityType="supplier"
          entityId={selected.id}
          perms={perms}
          title={`Documents — ${selected.name}`}
        />
      ) : (
        <div className="notice plain">Select a supplier to see and attach its documents.</div>
      )}

      <RawPanel raw={q.data?.raw} />
    </>
  )
}
