import { useState } from 'react'
import { api } from '../api'

const DEMO_USERS = [
  {
    email: 'anna.meyer@nordwind-demo.com',
    name: 'Anna Meyer',
    role: 'Management',
    desc: 'Sees everything: purchase cost, sell price, margin. Approves purchase orders above the threshold.',
  },
  {
    email: 'ravi.kumar@nordwind-demo.com',
    name: 'Ravi Kumar',
    role: 'Purchasing',
    desc: 'Runs the RFQ cycle and raises POs. Sees what things cost to buy — but not what they sell for, so margin cannot be derived.',
  },
  {
    email: 'maria.santos@nordwind-demo.com',
    name: 'Maria Santos',
    role: 'Logistics',
    desc: 'Tracks deliveries against approved POs. Sees quantities and dates, no prices at all.',
  },
]

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('anna.meyer@nordwind-demo.com')
  const [password, setPassword] = useState('demo1234')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(withEmail?: string) {
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: withEmail ?? email, password: 'demo1234' }),
      })
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-left">
          <h1>Nordwind BPM</h1>
          <p className="lede">
            Project, procurement and operations management — demo slice.
          </p>

          {error ? <div className="err">{error}</div> : null}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="notice plain" style={{ marginTop: 18, fontSize: 12.5 }}>
            Sessions are server-side and stored hashed, so access can be revoked immediately and a
            database dump yields no usable tokens. The cookie is httpOnly and SameSite=Strict.
            Passwords are salted per user (scrypt here, Argon2id in the production build).
          </div>
        </div>

        <div className="login-right">
          <h2>Sign in as one of three roles</h2>
          <p>
            The same data, three permission sets. Compare what each one is served — every page has a
            “raw API response” panel so you can check the restricted figures are genuinely absent
            from the payload, not merely hidden by the interface.
          </p>
          {DEMO_USERS.map((u) => (
            <button key={u.email} className="role-card" onClick={() => void submit(u.email)} disabled={busy}>
              <div className="rc-name">
                {u.name} <span className="rc-role">· {u.role}</span>
              </div>
              <div className="rc-desc">{u.desc}</div>
            </button>
          ))}
          <p style={{ marginTop: 14, marginBottom: 0, fontSize: 11.5 }}>
            Password for all three is <code>demo1234</code>. Demo data is fictional.
          </p>
        </div>
      </div>
    </div>
  )
}
