% Technical Approach — Business, Project & Operations Management System
% Anirudha Talmale
% 28 August 2026

---

## 0. How to read this

This is my actual approach, with the specific decisions and the specific traps.
Where I have been burned before, I say so — those paragraphs are the ones worth
your attention, because they are the parts you cannot get from a textbook.

---

## 1. The document chain — and the mistake most people make modelling it

Your workflow is:

> RFQ → Supplier Quotations → Customer Quotation → Purchase Order → Shipment →
> Delivery → Project Cost → Profitability

The obvious way to model this is a chain of foreign keys: each document points at
the one before it. **This is wrong, and it is the single most expensive mistake
you can make in a procurement system**, because it is very hard to unwind once you
have live data in it.

Reality is not a chain. It is a many-to-many mesh, and it is a mesh **at line
level, not document level**:

- One RFQ goes to five suppliers, so you get five supplier quotations back for
  the *same* requirement.
- Your customer quotation cherry-picks: valve body from supplier A, gaskets from
  supplier C. One customer quotation therefore draws on several supplier
  quotations.
- One purchase order to supplier A may cover items sitting on **two different
  projects**, because you consolidate to hit a price break or save freight.
- One shipment carries lines from **three different POs**.
- One PO line arrives in **two shipments** — a partial delivery, which is normal
  and which a document-level model cannot express at all.

So the design principle is:

> **Documents are headers. All the linking, all the quantities, and all the money
> live on the lines. Every link between stages is a line-to-line link, and it
> carries a quantity.**

### The tables that matter

```
projects
  └── project_items            "what this project needs" — the demand
        ↑ (many-to-many, by qty)
rfqs ── rfq_lines
supplier_quotations ── supplier_quotation_lines   (FK → rfq_line)
customer_quotations ── customer_quotation_lines   (source_supplier_quotation_line_id, nullable)
purchase_orders ── po_lines                       (FK → supplier_quotation_line, nullable)
shipments ── shipment_lines                       (FK → po_line, WITH qty)
goods_receipts ── goods_receipt_lines             (FK → shipment_line, WITH qty)
```

`shipment_lines.qty` and `goods_receipt_lines.qty` are what make partial
deliveries and split shipments work. `po_lines.qty_received` is **never a stored
column you update** — it is `SUM(goods_receipt_lines.qty)`, materialised into a
view. Stored running totals drift; I have cleaned up systems where the received
quantity and the actual receipts disagreed by 4% after a year, and nobody could
say which was right.

### Profitability: one ledger, not a query that walks the chain

Do **not** compute profit by joining eight tables at report time. Two reasons:
it gets slow, and worse, it silently changes when someone edits history.

Instead, every event that costs or earns money writes one immutable row into a
single ledger:

```
project_ledger
  id, project_id, entry_date, direction ('cost' | 'revenue'),
  category  ('goods','freight','duty','insurance','handling','other','sale'),
  amount_doc, currency, fx_rate, amount_base,     -- base = your reporting currency
  source_type, source_id,                          -- 'po_line', 'shipment_cost', 'invoice_line'
  posted_by, posted_at, reversal_of_id            -- corrections REVERSE, never UPDATE
```

Profitability is then one `GROUP BY` on one table. Corrections post a reversing
entry, exactly like real accounting — so the number your manager saw on Tuesday
is still reproducible on Friday. This matters the first time someone asks "why
did last quarter's margin change?"

**Landed cost.** Freight, duty and insurance arrive at *shipment* level but must
be attributed to *project* and *item* to make margin meaningful. I allocate them
across the shipment's lines by a rule you choose per cost type — by value, by
weight, or by volume. The allocation is stored as its own ledger entries with
`category='freight'`, so it is visible and auditable, not hidden inside a unit
cost.

### Money — the non-negotiables

- `NUMERIC(18,6)` for money. **Never** `float`/`double`. Floating point loses
  cents and the losses accumulate in exactly the reports management looks at.
- Every monetary column travels with a currency code **and the fx rate captured
  at the document's own date**, stored on the row. Never look up "today's rate"
  when rendering an old document — otherwise your historical margins move every
  morning.
- Rounding is applied once, at the line total, and the document total is the sum
  of already-rounded lines. Not the other way round, or the printed PO will not
  add up and your supplier will query it.

### Immutability

Once an RFQ is sent, a PO is approved, or a quotation goes to a customer, that
document is frozen. "Editing" creates **revision 2** — a new row sharing a
`document_group_id`, with the old one kept and marked superseded. You keep the
ability to answer "what exactly did we send them on the 4th?", which you will
need the first time there is a commercial dispute.

---

## 2. Backend architecture

**Node.js 22 LTS + TypeScript in strict mode. Fastify, not Express.**

Fastify because its JSON-schema validation is built into the routing layer, so a
request that does not match the schema never reaches my code — and it emits the
OpenAPI spec from those same schemas, so the API documentation cannot drift from
the API. Express needs three libraries bolted on to reach the same place.

**Modular monolith. Not microservices.** One deployable process, with hard
internal boundaries by domain: `procurement/`, `logistics/`, `costing/`,
`identity/`, `documents/`. Microservices for an internal system used by a few
dozen people buys you distributed transactions and a debugging nightmare in
exchange for scaling you will not need. If you ever do need to split it out, the
module boundaries are already the seams.

Each module has the same three layers, and the rule is that layer N only calls
layer N+1:

```
routes/      HTTP, auth guard, validation      — no business logic here
services/    business rules, transactions      — no SQL here
repositories/ SQL                              — no business rules here
```

**Database access: Kysely, not an ORM.** Typed query builder, generates real SQL,
gives me full TypeScript types from the schema. I have used Prisma; it is
pleasant until you need the reporting queries this system is *for* — window
functions, lateral joins, `GROUP BY ROLLUP` — and then you are dropping to raw
SQL anyway and have lost the type safety you paid for. Kysely handles both ends.
Migrations are plain, numbered, forward-only SQL files under version control,
applied by an explicit command — never auto-applied at boot.

> On that last point: I have watched an app that ran `create_all()` at startup
> corrupt itself because four worker processes booted simultaneously and raced
> each other to create the same tables. Schema changes are a deliberate,
> single-threaded deployment step. Always.

**Validation shared with the frontend.** Zod schemas live in a `shared/` package
imported by both sides, so the form and the API agree on what a valid PO line is
by construction.

> A related trap I now check for by reflex: a validation layer that *silently
> drops* unknown or wrongly-typed fields and still returns `200 OK`. You think
> you saved a field, the API says success, and the value simply is not there. My
> schemas are strict — an unexpected or mistyped field is a `400` with a message
> naming the field, never a quiet discard.

**Background work:** a single worker process off a Postgres-backed queue
(pg-boss). Notifications, PDF generation, deadline scans, the nightly FX pull.
No Redis, no extra moving part to keep alive — Postgres is already there and
already backed up.

---

## 3. Frontend architecture

**React 18 + Vite + TypeScript.**

- **TanStack Query** for everything server-side. No Redux. In a system like this
  ~95% of state *is* server state; Redux ends up being a hand-rolled cache with
  bugs. The remaining local UI state is `useState` and a small context for the
  session.
- **TanStack Table** for the grids. Your users will live in tables — RFQ
  comparisons, PO lines, shipment manifests — and they need column sorting,
  pinning, resizing and CSV export without me rebuilding it five times.
- **react-hook-form + the shared Zod schemas.** Same validation rules as the
  server, so errors surface before submission.
- Routing by role: the route table is generated from the user's permission set,
  so a logistics user does not merely fail to see the Costing menu — the routes
  do not exist in their bundle.

**The quotation comparison screen** is the one that decides whether purchasing
actually adopts the system, so it gets built properly: supplier quotations for
one RFQ side by side, one row per requirement, cheapest cell highlighted per row,
lead-time and incoterm shown next to price (cheapest is frequently not best),
and a checkbox per cell that builds the customer quotation or the PO from the
selection. That screen is where the day's work happens.

**Layout note from experience:** scrollable table panes inside a flex column need
`min-height: 0` on the flex child, or the pane refuses to shrink and pushes its
own header off-screen the first time a row gets keyboard focus. Small thing,
looks like a mystery bug for an hour.

---

## 4. RBAC and data-level permissions

This is the part of your brief I would treat as the highest-risk requirement,
because "purchasing must not see margins" is a *data leak* problem, not a *menu*
problem.

I implement it in **four layers**, and the important one is layer 3.

**Layer 1 — Permissions, not roles, in the code.** Code never asks
`if (user.role === 'manager')`. It asks `can(user, 'project.margin.read')`.
Roles are just named bundles of permissions, editable in an admin screen, so when
you hire a procurement manager who also needs margin visibility, that is a
checkbox, not a deployment. Permission strings are `resource.action`, e.g.
`po.create`, `po.approve`, `supplier_quote.read`, `project.margin.read`,
`document.delete`.

**Layer 2 — Route guards.** Every route declares its required permission in its
schema. There is a startup assertion that fails the boot if any route lacks a
declaration, so a new endpoint cannot be shipped unprotected by accident.

**Layer 3 — Field-level projection at the serialiser. This is the one that
matters.**

The margin fields must **never be serialised into a response** a purchasing user
receives. Not sent-and-hidden by the UI. I have opened DevTools on plenty of
systems where the "restricted" number was sitting right there in the JSON, and
the CSS was the only thing protecting it.

Concretely, `GET /projects/:id` returns a *different shape* per permission set.
There is one declarative map — field → required permission — and a single
serialiser applies it to every response on the way out. Adding a new sensitive
field means adding one line to that map; forgetting to protect it in each of the
eleven endpoints that return a project is not possible, because there is one
choke point.

Aggregates get the same treatment: a user without `project.margin.read` cannot
call the endpoint that returns cost totals, and cannot derive margin from the
endpoints they *can* call. That last part needs deliberate checking — if
purchasing can see the full cost ledger and the customer quotation, they can do
the subtraction themselves. So cost visibility is scoped too: purchasing sees
*their own* purchase costs, not freight, duty and the sell price.

**Layer 4 — Row-level scoping, with Postgres RLS as a second net.** Logistics
sees shipments for projects they are assigned to. This is enforced in a central
query scope applied by the repository layer, *and* — for the handful of tables
where a mistake would be serious — by Postgres Row Level Security policies keyed
on a session variable.

> A real trap with RLS and a connection pool: `SET app.current_user_id` does not
> survive the commit, and the pooled connection is then handed to the next
> request **carrying the previous user's identity, or none at all**. It must be
> `SET LOCAL` inside the transaction, set on every request, with a policy that
> denies by default when the variable is unset. I have debugged the version of
> this bug where it fails open. Once is enough.

---

## 5. Audit logs

One append-only table:

```
audit_log(id, at, actor_user_id, actor_ip, request_id,
          entity_type, entity_id, action, diff jsonb, context jsonb)
```

Three decisions that make it actually useful:

1. **Written inside the same transaction as the change.** If the log write fails,
   the change rolls back. There is no code path that mutates a record without
   leaving a trace, because it is physically the same commit.
2. **Logged at the level of intent, not SQL.** A database trigger can only tell
   you `UPDATE purchase_orders SET status='approved'`. My log says
   `po.approve` by *whom*, on which PO, with the approval threshold that applied
   and the request id. That is what an auditor — or you, six months later — is
   actually asking.
3. **The application's database role has `INSERT` on that table and nothing
   else.** No `UPDATE`, no `DELETE`, granted at the Postgres level. The app
   physically cannot rewrite history, even if someone finds a bug in it.

`diff` stores before/after for changed fields only, with values the user can see
— and the same field-level permission map applies when the log is *displayed*,
so the audit screen does not become the margin leak you closed in section 4.

Retention: nothing is deleted. The table is partitioned by month so it stays fast
as it grows.

---

## 6. Document and file security

**Files never sit in the web root, and nginx never serves them directly.** They
go outside the docroot (or on a MinIO/S3-compatible bucket if you prefer), stored
under a random UUID with the original filename kept only in the database.

Downloads go through an authenticated endpoint: check session → check permission
on the *owning entity* (you may read this file because you may read this project)
→ stream. That means a leaked URL is worthless, and there is no directory anyone
can walk.

Uploads: extension allowlist plus real content-type sniffing from the file's
magic bytes, size cap, and everything served back with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` so a
crafted upload cannot execute in a colleague's browser. ClamAV scanning on
upload if you want it — worth it when suppliers email you attachments.

> One hard-won rule: **the storage path in the database is data, not a promise.**
> Deleting a file means verifying the path resolves inside the storage root
> first. I once watched a cleanup routine follow a bad path out of the storage
> directory entirely. Deletes are soft by default here — the row is marked
> deleted, the blob is removed by a separate reaper after a grace period.

---

## 7. Backup strategy

Three layers, because the failure modes are different:

1. **Point-in-time recovery:** pgBackRest with WAL archiving. Full weekly,
   incremental daily, continuous WAL. Recovery to any second within the retention
   window — which is what you want when the answer is "someone deleted the
   project at about 11 this morning", not "restore last night and lose the day".
2. **Nightly logical dump** (`pg_dump -Fc`), GPG-encrypted, pushed off the server
   to storage you control — your S3, Backblaze, another VPS. A backup living on
   the same machine as the database is not a backup.
3. **Uploaded documents** on the same off-site schedule, since they are not in
   the database.

**And the part that is usually missing: an automated monthly restore drill.** A
cron job restores the latest dump into a scratch database, runs row-count and
checksum assertions against production, reports the result, and drops it. An
untested backup is a hope. This is a couple of hours of work and it is the
difference between a backup policy and an actual recovery capability.

Retention: 30 daily, 12 monthly. Documented one-page runbook with the exact
restore commands, kept in the repository — because at 2am nobody reconstructs
this from memory.

---

## 8. VPS deployment and security

Ubuntu 24.04 LTS. Everything below is standard practice and I set it up as a
matter of course.

**Network surface:** UFW default-deny inbound; only 22, 80, 443 open. Postgres
bound to `127.0.0.1` — never exposed, no exceptions. SSH on keys only, root login
disabled, password auth off, fail2ban on the SSH and login endpoints.

**Process isolation:** the app runs as a dedicated non-root user under systemd,
with `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp` and a read-only
filesystem apart from its own writable paths. nginx in front terminating TLS
(Let's Encrypt with auto-renewal), HSTS, sane security headers, rate limiting on
the auth endpoints.

**Application security:** Argon2id password hashing; short-lived access token
with a rotating refresh token in an `httpOnly`, `Secure`, `SameSite=Strict`
cookie; CSRF tokens on state-changing requests; parameterised queries throughout
(Kysely does this by construction); optional TOTP 2FA for the roles that see
financials. Secrets in an env file owned by the service user, mode `600`, never
in git — with a documented rotation procedure.

**Deploy:** GitHub Actions runs typecheck, lint and tests, builds the artefact,
ships it over SSH; the deploy script takes a pre-deploy database snapshot, runs
migrations explicitly, then restarts. Rollback is one command to the previous
release directory. Zero-downtime is not worth the complexity for an internal
system; a 20-second restart at 7am is fine.

**Monitoring:** structured JSON logs to disk with rotation, an uptime check, and
alerts on disk (the one that actually kills these systems), failed logins, and
backup-job failure.

**Ownership.** Everything lives in *your* GitHub organisation and on *your* VPS
from day one. I work with credentials you issue, and at handover you rotate them
and I am out. I keep nothing. That is how it should work, and I would say the
same about any developer you hire.

---

## 9. Milestones

Each one ends with something running on your server that you can log into, not a
progress report. Sequenced so the highest-risk pieces — permissions, the money
model — come first, while changing them is still cheap.

| # | Milestone | What you can do at the end of it |
|---|-----------|----------------------------------|
| 1 | **Foundation** — auth, RBAC engine, roles/permissions admin, audit log, deployment pipeline, VPS hardening, backups | Log in as different roles and see the permission system working end to end |
| 2 | **Master data** — customers, suppliers, projects & contracts, document storage | Your real customer, supplier and project data is in the system |
| 3 | **Procurement in** — RFQ, supplier quotations, the comparison screen, PO with approval thresholds | Purchasing runs a real RFQ cycle to a real PO |
| 4 | **Sales side** — customer quotations from supplier quotes, revenue lines, PDF output | Issue a customer quotation built from the supplier responses |
| 5 | **Logistics** — shipments, partial deliveries, goods receipt, landed-cost allocation | Logistics tracks a real shipment to delivery |
| 6 | **Costing & profitability** — project ledger, margin, management dashboards and reports | Management sees live project profitability; purchasing still cannot |
| 7 | **Tasks, deadlines, notifications** | Deadline and approval alerts reach the right people |
| 8 | **Hardening & handover** — restore drill, load pass, documentation, training | Full ownership handover, runbook, rotated credentials |

Milestone 1 is deliberately unglamorous. It is also the one that decides whether
"purchasing cannot see margins" is true in eighteen months, so it is where I want
your scrutiny.

---

## 10. What I need from you to firm this up

1. Exact roles and, for each, what they must **not** see.
2. A sample of your real data — an old RFQ, a supplier quotation, a PO, a project
   cost sheet. Two real documents shape the data model better than ten pages of
   specification.
3. Single company or several entities? Single or multi-currency, and which
   reporting currency?
4. Does this need to hand anything to an accounting package later?
5. VPS specification, OS, and whether it is already provisioned.
6. Approximate volumes — projects and POs per month, and number of users.
