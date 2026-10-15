-- User consent is independent of doctor review. No legacy diagnosis changes.
CREATE TABLE t_diagnosis_save_confirmation (
    confirmationId VARCHAR(64) NOT NULL PRIMARY KEY,
    ownerUserId BIGINT NOT NULL,
    workflowId VARCHAR(64) NOT NULL,
    operationType VARCHAR(32) NOT NULL,
    idempotencyKey VARCHAR(128) NOT NULL,
    workflowVersion BIGINT NOT NULL,
    requestVersion BIGINT NOT NULL,
    contentSnapshot MEDIUMTEXT NOT NULL,
    contentDigest VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    createdAt DATETIME NOT NULL,
    expiresAt DATETIME NOT NULL,
    decidedAt DATETIME NULL,
    UNIQUE KEY uk_save_confirmation_key (ownerUserId, idempotencyKey),
    UNIQUE KEY uk_save_confirmation_version (workflowId, requestVersion),
    KEY idx_save_confirmation_workflow (workflowId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One durable receipt per workflow, regardless of confirmation retries/restarts.
CREATE TABLE t_saved_workflow_diagnosis (
    workflowId VARCHAR(64) NOT NULL PRIMARY KEY,
    diagnosisId BIGINT NOT NULL,
    confirmationId VARCHAR(64) NOT NULL,
    UNIQUE KEY uk_saved_diagnosis (diagnosisId),
    UNIQUE KEY uk_saved_confirmation (confirmationId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
