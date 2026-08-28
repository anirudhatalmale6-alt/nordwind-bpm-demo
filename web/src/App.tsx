import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { api, useApi, type Me } from './api'
import { Login } from './pages/Login'
import { About } from './pages/About'
import { Projects } from './pages/Projects'
import { ProjectDetail } from './pages/ProjectDetail'
import { Rfqs } from './pages/Rfqs'
import { RfqCompare } from './pages/RfqCompare'
import { PoDetailPage, PurchaseOrders } from './pages/PurchaseOrders'
import { Audit } from './pages/Audit'
import { Permissions } from './pages/Permissions'

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function Gate() {
  const [checked, setChecked] = useState(false)
  const [me, setMe] = useState<Me | null>(null)
  const client = useQueryClient()

  async function refresh() {
    try {
      const res = await api<Me>('/api/auth/me')
      setMe(res.data)
    } catch {
      setMe(null)
    } finally {
      setChecked(true)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (!checked) return null

  if (!me) {
    return (
      <Login
        onSignedIn={() => {
          client.clear()
          void refresh()
        }}
      />
    )
  }

  return (
    <Shell
      me={me}
      onSignedOut={async () => {
        await api('/api/auth/logout', { method: 'POST' })
        client.clear()
        setMe(null)
      }}
    />
  )
}

/**
 * The navigation is generated from the permission set the server returned, so
 * a logistics user does not merely fail to see the RFQ menu — the route is not
 * registered in their app at all. The server enforces the same rule; hiding a
 * link is a courtesy, not a control.
 */
const NAV = [
  { to: '/', label: 'About this demo', perm: null, end: true },
  { to: '/projects', label: 'Projects', perm: 'project.read' },
  { to: '/rfqs', label: 'RFQs & quotations', perm: 'rfq.read' },
  { to: '/purchase-orders', label: 'Purchase orders', perm: 'po.read' },
  { to: '/audit', label: 'Activity log', perm: 'audit.read' },
  { to: '/permissions', label: 'Roles & permissions', perm: 'project.read' },
] as const

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, 'About this demo'],
  [/^\/projects$/, 'Projects'],
  [/^\/projects\//, 'Project'],
  [/^\/rfqs$/, 'RFQs & quotations'],
  [/^\/rfqs\//, 'Quotation comparison'],
  [/^\/purchase-orders$/, 'Purchase orders'],
  [/^\/purchase-orders\//, 'Purchase order'],
  [/^\/audit$/, 'Activity log'],
  [/^\/permissions$/, 'Roles & permissions'],
]

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void | Promise<void> }) {
  const perms = new Set(me.permissions)
  const loc = useLocation()
  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'Nordwind BPM'

  const counts = useApi<{ projects: unknown[] }>(['projects'], '/api/projects')
  const projectCount = perms.has('project.read') ? counts.data?.data.projects.length : undefined

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <strong>Nordwind BPM</strong>
          <span>demo slice</span>
        </div>
        <nav className="nav">
          <div className="nav-section">Operations</div>
          {NAV.filter((n) => n.perm === null || perms.has(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : false}>
              <span>{n.label}</span>
              {n.to === '/projects' && projectCount !== undefined ? (
                <span className="nav-count">{projectCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <div className="who-name">{me.user.full_name}</div>
          <div className="who-role">
            {me.user.role_name} · {me.user.job_title}
          </div>
          <button onClick={() => void onSignedOut()}>Sign out / switch role</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <span className="sub">
            {me.user.role_name} · {me.permissions.length} permissions
          </span>
          <span className="spacer" />
          <span className="sub">Demo data — fictional company</span>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<About roleName={me.user.role_name} />} />
            {perms.has('project.read') && (
              <>
                <Route path="/projects" element={<Projects perms={perms} />} />
                <Route path="/projects/:id" element={<ProjectDetail perms={perms} />} />
              </>
            )}
            {perms.has('rfq.read') && (
              <>
                <Route path="/rfqs" element={<Rfqs />} />
                <Route path="/rfqs/:id" element={<RfqCompare perms={perms} />} />
              </>
            )}
            {perms.has('po.read') && (
              <>
                <Route path="/purchase-orders" element={<PurchaseOrders perms={perms} />} />
                <Route path="/purchase-orders/:id" element={<PoDetailPage perms={perms} />} />
              </>
            )}
            {perms.has('audit.read') && <Route path="/audit" element={<Audit />} />}
            <Route path="/permissions" element={<Permissions myRole={me.user.role_name} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
