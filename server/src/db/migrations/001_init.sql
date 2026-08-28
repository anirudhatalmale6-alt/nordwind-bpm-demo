-- ---------------------------------------------------------------------------
-- 001_init.sql — BPM demo slice
--
-- Design notes that matter (see ARCHITECTURE.md §1):
--   * Money is NUMERIC(18,6). Never float.
--   * Every document carries its own currency AND the fx rate as at its own
--     date, so historical figures never move.
--   * Links between stages are LINE-to-LINE and carry a quantity, because one
--     PO can span two projects and one shipment can span three POs.
--   * Documents are immutable once issued; a change creates a new revision.
-- ---------------------------------------------------------------------------

-- ----- identity -------------------------------------------------------------

CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,        -- 'resource.action'
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  job_title     TEXT NOT NULL DEFAULT '',
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions, so access can be revoked instantly. A stateless JWT
-- cannot be withdrawn before it expires; for an internal system where somebody
-- leaves on Friday, that matters more than the saved database round-trip.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,          -- random 256-bit token, hashed at rest
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Which projects a non-management user may touch. Row-level scoping: logistics
-- and purchasing see their own assignments, management sees everything.
CREATE TABLE project_assignments (
  project_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

-- ----- master data ----------------------------------------------------------

CREATE TABLE customers (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  country  TEXT NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL DEFAULT 'EUR'
);

CREATE TABLE suppliers (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT '',
  currency        CHAR(3) NOT NULL DEFAULT 'EUR',
  lead_time_days  INTEGER NOT NULL DEFAULT 0,
  rating          NUMERIC(3,1),
  is_approved     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE projects (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  status          TEXT NOT NULL DEFAULT 'active',
  base_currency   CHAR(3) NOT NULL DEFAULT 'EUR',
  manager_user_id INTEGER REFERENCES users(id),
  contract_ref    TEXT NOT NULL DEFAULT '',
  starts_on       DATE,
  ends_on         DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_assignments
  ADD CONSTRAINT project_assignments_project_fk
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- The demand: what this project actually needs to buy.
CREATE TABLE project_items (
  id                 SERIAL PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  line_no            INTEGER NOT NULL,
  item_code          TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL,
  uom                TEXT NOT NULL DEFAULT 'pcs',
  qty                NUMERIC(18,6) NOT NULL,
  target_unit_price  NUMERIC(18,6),
  UNIQUE (project_id, line_no)
);

-- ----- procurement: RFQ -----------------------------------------------------

CREATE TABLE rfqs (
  id          SERIAL PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',   -- draft | issued | closed | cancelled
  revision    INTEGER NOT NULL DEFAULT 1,
  issued_at   TIMESTAMPTZ,
  due_at      TIMESTAMPTZ,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rfq_lines (
  id              SERIAL PRIMARY KEY,
  rfq_id          INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  project_item_id INTEGER REFERENCES project_items(id),
  description     TEXT NOT NULL,
  uom             TEXT NOT NULL DEFAULT 'pcs',
  qty             NUMERIC(18,6) NOT NULL,
  UNIQUE (rfq_id, line_no)
);

CREATE TABLE rfq_suppliers (
  rfq_id      INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  sent_at     TIMESTAMPTZ,
  PRIMARY KEY (rfq_id, supplier_id)
);

-- ----- procurement: supplier quotations -------------------------------------

CREATE TABLE supplier_quotations (
  id             SERIAL PRIMARY KEY,
  ref            TEXT NOT NULL UNIQUE,
  rfq_id         INTEGER NOT NULL REFERENCES rfqs(id),
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  status         TEXT NOT NULL DEFAULT 'received',  -- received | selected | rejected | expired
  currency       CHAR(3) NOT NULL,
  fx_rate        NUMERIC(18,8) NOT NULL,            -- to base currency, AS AT quoted_at
  incoterm       TEXT NOT NULL DEFAULT '',
  lead_time_days INTEGER,
  payment_terms  TEXT NOT NULL DEFAULT '',
  quoted_at      DATE NOT NULL,
  valid_until    DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE supplier_quotation_lines (
  id                     SERIAL PRIMARY KEY,
  supplier_quotation_id  INTEGER NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
  rfq_line_id            INTEGER NOT NULL REFERENCES rfq_lines(id),
  qty                    NUMERIC(18,6) NOT NULL,
  unit_price             NUMERIC(18,6) NOT NULL,   -- in the quotation's currency
  lead_time_days         INTEGER,
  note                   TEXT NOT NULL DEFAULT '',
  UNIQUE (supplier_quotation_id, rfq_line_id)
);

-- ----- sales side -----------------------------------------------------------

CREATE TABLE customer_quotations (
  id          SERIAL PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | issued | accepted | lost
  currency    CHAR(3) NOT NULL,
  fx_rate     NUMERIC(18,8) NOT NULL,
  issued_at   DATE,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_quotation_lines (
  id                                SERIAL PRIMARY KEY,
  customer_quotation_id             INTEGER NOT NULL REFERENCES customer_quotations(id) ON DELETE CASCADE,
  line_no                           INTEGER NOT NULL,
  project_item_id                   INTEGER REFERENCES project_items(id),
  -- which supplier quote this sell price was built from. Nullable: not every
  -- sell line comes from a bought line (labour, engineering hours).
  source_supplier_quotation_line_id INTEGER REFERENCES supplier_quotation_lines(id),
  description                       TEXT NOT NULL,
  qty                               NUMERIC(18,6) NOT NULL,
  unit_sell_price                   NUMERIC(18,6) NOT NULL,
  UNIQUE (customer_quotation_id, line_no)
);

-- ----- procurement: purchase orders -----------------------------------------

CREATE TABLE purchase_orders (
  id             SERIAL PRIMARY KEY,
  ref            TEXT NOT NULL UNIQUE,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft | pending_approval | approved | sent | closed | cancelled
  currency       CHAR(3) NOT NULL,
  fx_rate        NUMERIC(18,8) NOT NULL,
  incoterm       TEXT NOT NULL DEFAULT '',
  payment_terms  TEXT NOT NULL DEFAULT '',
  ordered_at     DATE,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  approved_by    INTEGER REFERENCES users(id),
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: project_id lives on the LINE, not the header. One PO to one supplier
-- can legitimately cover items for two different projects — consolidating to
-- hit a price break is normal purchasing behaviour, and a header-level
-- project_id makes it impossible to represent.
CREATE TABLE po_lines (
  id                        SERIAL PRIMARY KEY,
  po_id                     INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no                   INTEGER NOT NULL,
  project_id                INTEGER NOT NULL REFERENCES projects(id),
  supplier_quotation_line_id INTEGER REFERENCES supplier_quotation_lines(id),
  description               TEXT NOT NULL,
  uom                       TEXT NOT NULL DEFAULT 'pcs',
  qty                       NUMERIC(18,6) NOT NULL,
  unit_price                NUMERIC(18,6) NOT NULL,
  UNIQUE (po_id, line_no)
);

-- ----- costing --------------------------------------------------------------

-- One immutable row per money event. Profitability is a GROUP BY on this table,
-- never a report-time walk of the document chain. Corrections post a REVERSING
-- entry (reversal_of_id) so a figure that was reported last month is still
-- reproducible next month.
CREATE TABLE project_ledger (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  entry_date     DATE NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('cost','revenue')),
  category       TEXT NOT NULL,   -- goods | freight | duty | insurance | handling | other | sale
  description    TEXT NOT NULL DEFAULT '',
  amount_doc     NUMERIC(18,6) NOT NULL,
  currency       CHAR(3) NOT NULL,
  fx_rate        NUMERIC(18,8) NOT NULL,
  amount_base    NUMERIC(18,6) NOT NULL,
  source_type    TEXT NOT NULL DEFAULT '',
  source_id      INTEGER,
  reversal_of_id INTEGER REFERENCES project_ledger(id),
  posted_by      INTEGER REFERENCES users(id),
  posted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_ledger_project_idx ON project_ledger(project_id, direction);

-- ----- audit ----------------------------------------------------------------

-- Append-only. The application's database role is granted INSERT and SELECT on
-- this table and nothing else (see 002_grants.sql), so a bug in the app cannot
-- rewrite history. Written inside the same transaction as the change it
-- describes, so there is no code path that mutates without leaving a trace.
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id INTEGER REFERENCES users(id),
  actor_ip     TEXT NOT NULL DEFAULT '',
  request_id   TEXT NOT NULL DEFAULT '',
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL,        -- intent, e.g. 'po.approve' — not 'UPDATE'
  summary      TEXT NOT NULL DEFAULT '',
  diff         JSONB,
  context      JSONB
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);

-- ----- views ----------------------------------------------------------------

-- Received quantity is DERIVED, never a stored counter that drifts.
CREATE VIEW v_project_totals AS
SELECT p.id AS project_id,
       COALESCE(SUM(l.amount_base) FILTER (WHERE l.direction = 'cost'),    0) AS cost_base,
       COALESCE(SUM(l.amount_base) FILTER (WHERE l.direction = 'revenue'), 0) AS revenue_base
FROM projects p
LEFT JOIN project_ledger l ON l.project_id = p.id
GROUP BY p.id;
