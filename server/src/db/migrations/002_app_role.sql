-- ---------------------------------------------------------------------------
-- 002_app_role.sql — the application does NOT connect as the schema owner.
--
-- The point of this file: the audit log is append-only at the DATABASE level,
-- not by convention in the application code. bpm_app is granted INSERT and
-- SELECT on audit_log and is deliberately NOT granted UPDATE or DELETE, so a
-- bug — or a compromised application process — physically cannot rewrite
-- history. The demo exposes an endpoint that tries it, so you can watch
-- PostgreSQL refuse.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bpm_app') THEN
    CREATE ROLE bpm_app LOGIN PASSWORD 'demo_app_password_not_a_real_secret';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE bpm_demo TO bpm_app;
GRANT USAGE ON SCHEMA public TO bpm_app;

-- Full DML on the operational tables...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bpm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bpm_app;

-- ...but the audit log is append-only. Revoke first, then grant back only the
-- two verbs that are allowed.
REVOKE ALL ON audit_log FROM bpm_app;
GRANT SELECT, INSERT ON audit_log TO bpm_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO bpm_app;

-- Same treatment for the ledger: entries are immutable. A correction posts a
-- reversing row, it never edits the original.
REVOKE UPDATE, DELETE ON project_ledger FROM bpm_app;
