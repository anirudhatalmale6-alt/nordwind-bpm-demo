-- Document numbers come from a sequence, not from COUNT(*) or MAX()+1.
--
-- COUNT(*) is wrong the moment anything is ever cancelled or deleted, and
-- MAX()+1 races: two buyers pressing "create" in the same second both read the
-- same maximum and one of them gets a unique-violation. A sequence hands out a
-- number per caller with no lock and no gap-free promise — and gap-free is not
-- something a PO number needs.
CREATE SEQUENCE IF NOT EXISTS po_ref_seq START WITH 316 INCREMENT BY 1;
GRANT USAGE, SELECT ON SEQUENCE po_ref_seq TO bpm_app;
