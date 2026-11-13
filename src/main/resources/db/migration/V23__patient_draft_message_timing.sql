-- Additive: per-role call timing so operators can see where a draft run spent its budget.
-- Existing rows keep NULL; the coordinator fills both columns from its injected clock.
ALTER TABLE t_patient_draft_message
    ADD COLUMN startedAt DATETIME(6) NULL AFTER output,
    ADD COLUMN completedAt DATETIME(6) NULL AFTER startedAt;
