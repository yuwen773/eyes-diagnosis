-- One explicit patient authorization and immutable receipt per task.
CREATE TABLE t_patient_authorization (
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    authorizationId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    userId BIGINT NOT NULL,
    taskVersion BIGINT NOT NULL,
    draftVersion INT NOT NULL,
    evidenceVersion INT NOT NULL,
    materialDigest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    contentDigest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content JSON NOT NULL,
    expiresAt DATETIME(6) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OFFERED',
    diagnosisId BIGINT,
    receiptId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
    authorizedAt DATETIME(6),
    UNIQUE KEY uk_patient_authorization_id (authorizationId),
    UNIQUE KEY uk_patient_authorization_diagnosis (diagnosisId),
    UNIQUE KEY uk_patient_authorization_receipt (receiptId)
) ENGINE=InnoDB;

ALTER TABLE t_diagnosis
    ADD COLUMN patientTaskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
    ADD UNIQUE KEY uk_diagnosis_patient_task (patientTaskId);
