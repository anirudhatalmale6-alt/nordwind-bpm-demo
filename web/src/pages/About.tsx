export function About({ roleName }: { roleName: string }) {
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>What this is</h2>
        </div>
        <div className="card-body" style={{ maxWidth: 780 }}>
          <p style={{ marginTop: 0 }}>
            A working slice of the system described in the architecture document — the procurement
            path from RFQ to purchase order, with the permission model, the costing ledger and the
            audit log actually implemented rather than described. Node.js and TypeScript with
            Fastify on the server, React on the front, PostgreSQL underneath. The data is fictional;
            the mechanics are not.
          </p>
          <p>
            You are signed in as <strong>{roleName}</strong>. Sign out and pick a different role to
            see the same records served differently.
          </p>

          <h3 style={{ fontSize: 13.5, marginBottom: 6 }}>Worth clicking, in this order</h3>
          <ol style={{ paddingLeft: 20, fontSize: 13.5, lineHeight: 1.65 }}>
            <li>
              <strong>Projects → any project.</strong> As management you get cost, revenue and
              margin. Sign in as Ravi (purchasing) and the margin is gone — then open the raw
              response panel at the bottom of the page and search it. The number is not in the
              payload. The UI is not hiding it.
            </li>
            <li>
              <strong>RFQs → RFQ-2026-0087.</strong> Three suppliers, three sets of terms, one of
              them quoting in USD and converted at the rate as at its own quotation date. Cheapest
              per line is shaded. Lead time and certification notes sit next to the price, because
              the cheapest quote here is 62–75 days away and has no marine approval.
            </li>
            <li>
              <strong>Build a purchase order.</strong> As Ravi, click cells in the comparison and
              press create. It is raised pending approval — purchasing does not hold{' '}
              <code>po.approve</code>, and cost reaches the project ledger only when someone
              approves it.
            </li>
            <li>
              <strong>Approve it as Anna,</strong> then reopen the project. The cost has moved and
              the margin with it. Approval, ledger posting and the audit row are one transaction.
            </li>
            <li>
              <strong>Activity log → “try to alter an audit row”.</strong> The server asks
              PostgreSQL to modify an audit entry using the same connection it uses for everything
              else, and PostgreSQL refuses. Append-only is a grant, not a promise.
            </li>
            <li>
              <strong>PO-2026-0311</strong> covers two projects on one order — consolidated to hit a
              price break. That is why the project sits on the line rather than the header.
            </li>
          </ol>

          <h3 style={{ fontSize: 13.5, marginBottom: 6 }}>What is deliberately not here</h3>
          <p style={{ marginBottom: 0 }}>
            Shipments and goods receipt, document storage, tasks and notifications, the customer
            quotation editor, and the admin screens for editing roles. They are milestones 4 to 7 in
            the plan. This slice covers the parts where the design decisions are hardest to reverse
            later: the permission model, the line-level document links, and the money.
          </p>
        </div>
      </div>
    </>
  )
}
