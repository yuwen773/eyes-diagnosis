-- Existing documents are private and unreviewed; no automatic promotion.
ALTER TABLE t_knowledge_document
    ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT 'PRIVATE_USER',
    ADD COLUMN reviewStatus VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN diseaseCodes JSON NULL,
    ADD COLUMN topicCodes JSON NULL,
    ADD COLUMN governanceVersion INT NOT NULL DEFAULT 0,
    ADD COLUMN reviewedBy BIGINT NULL,
    ADD COLUMN reviewedAt DATETIME NULL;

ALTER TABLE t_workflow_upload_input ADD COLUMN evidenceSnapshot LONGTEXT NULL;
