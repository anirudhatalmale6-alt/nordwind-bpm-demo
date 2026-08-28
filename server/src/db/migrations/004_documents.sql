-- ---------------------------------------------------------------------------
-- 004_documents.sql — attachments on projects, RFQs, quotations and POs.
--
-- The file itself never lives in the web root and is never served by the web
-- server directly. The row below is the only index of it: the blob on disk is
-- named after a random UUID and carries no clue about its contents, so there is
-- nothing to guess and no directory anyone can walk.
--
-- Access is decided by the OWNING RECORD, not by the file: you may read this
-- document because you may read the purchase order it is attached to. That is
-- why entity_type/entity_id are here and why there is no per-file ACL — a
-- second, parallel permission model is a second thing to get wrong.
-- ---------------------------------------------------------------------------

CREATE TABLE documents (
  id                SERIAL PRIMARY KEY,
  entity_type       TEXT NOT NULL CHECK (entity_type IN
                      ('project','rfq','supplier_quotation','purchase_order','supplier')),
  entity_id         INTEGER NOT NULL,

  original_filename TEXT NOT NULL,
  -- Random name on disk. The original filename is data, shown in the UI, and
  -- never used to build a path.
  stored_name       TEXT NOT NULL UNIQUE,
  -- Relative to the storage root, e.g. '2026/08/<uuid>'. Resolved and checked
  -- to be inside the root before any read or unlink — a path out of the
  -- database is data, not a promise.
  storage_path      TEXT NOT NULL,

  mime_type         TEXT NOT NULL,
  byte_size         BIGINT NOT NULL,
  -- Lets you prove a file has not changed, and spot the same document uploaded
  -- twice under two names.
  sha256            TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',

  uploaded_by       INTEGER NOT NULL REFERENCES users(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Soft delete. The row is marked, the blob is removed later by a separate
  -- reaper after a grace period. Deleting a file the instant somebody clicks a
  -- button is how attachments get lost for good.
  deleted_at        TIMESTAMPTZ,
  deleted_by        INTEGER REFERENCES users(id),
  -- Set by the reaper when the blob is actually unlinked. The row stays, so
  -- the fact that a document existed, and who removed it, survives the file.
  blob_removed_at   TIMESTAMPTZ
);

CREATE INDEX documents_entity_idx ON documents(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_sha_idx ON documents(sha256);

GRANT SELECT, INSERT, UPDATE ON documents TO bpm_app;
-- No DELETE: removing the row would orphan the blob and erase the record that
-- the document ever existed. Deletion is the soft kind, and the reaper runs as
-- a separate maintenance role.
REVOKE DELETE ON documents FROM bpm_app;
GRANT USAGE, SELECT ON SEQUENCE documents_id_seq TO bpm_app;
