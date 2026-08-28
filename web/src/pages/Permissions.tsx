import { useApi, type RolesMatrix } from '../api'
import { Loading } from '../components/bits'
import { RawPanel } from '../components/Raw'

export function Permissions({ myRole }: { myRole: string }) {
  const q = useApi<RolesMatrix>(['roles'], '/api/meta/roles')
  if (q.isLoading) return <Loading />
  if (q.error) return <div className="notice">{q.error.message}</div>
  const d = q.data!.data

  return (
    <>
      <div className="notice info">
        This matrix is read out of the database, not hard-coded — it is where the permissions
        actually live. In the full system an administrator edits it on this screen, so granting a
        buyer margin visibility is a checkbox rather than a code change and a deployment. Nothing in
        the codebase ever asks “is this user a manager?”; it asks whether they hold a named
        permission.
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Roles</h2>
          <span className="hint">you are signed in as {myRole}</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Role</th>
                <th>What it is for</th>
                <th className="num">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {d.roles.map((r) => (
                <tr key={r.id} style={r.name === myRole ? { background: '#e8f0fd55' } : undefined}>
                  <td className="desc">{r.name}</td>
                  <td className="small">{r.description}</td>
                  <td className="num">{r.permissions.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Permission matrix</h2>
          <span className="hint">{d.permissions.length} permissions</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Meaning</th>
                {d.roles.map((r) => (
                  <th key={r.id} style={{ textAlign: 'center' }}>
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.permissions.map((p) => (
                <tr key={p.id}>
                  <td className="mono small">{p.key}</td>
                  <td className="small muted">{p.description}</td>
                  {d.roles.map((r) => {
                    const held = r.permissions.includes(p.key)
                    return (
                      <td key={r.id} style={{ textAlign: 'center' }}>
                        {held ? (
                          <span style={{ color: '#17795e', fontWeight: 700 }}>✓</span>
                        ) : (
                          <span className="muted">·</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notice">
        Note the three separate money permissions. If purchasing held both{' '}
        <code>project.cost.read</code> and <code>project.revenue.read</code> they could subtract one
        from the other and reconstruct the margin, which would make{' '}
        <code>project.margin.read</code> decorative. Checking that a restricted figure cannot be
        derived from the permitted ones is the part that usually gets missed.
      </div>

      <RawPanel raw={q.data?.raw} />
    </>
  )
}
