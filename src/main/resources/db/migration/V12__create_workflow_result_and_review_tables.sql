CREATE TABLE t_diagnosis_citation (
    citationId VARCHAR(64) NOT NULL,
    workflowId VARCHAR(64) NOT NULL,
    retrievalEpoch BIGINT NOT NULL,
    sourceDocumentId VARCHAR(128) NOT NULL,
    sourceRevision VARCHAR(128) NOT NULL,
    visibilitySnapshot VARCHAR(32) NOT NULL,
    reviewStatusSnapshot VARCHAR(32) NOT NULL,
    diseaseCodesSnapshot TEXT,
    topicCodesSnapshot TEXT,
    quotedSpan TEXT NOT NULL,
    quotedSpanDigest VARCHAR(128) NOT NULL,
    retrievedAt DATETIME(6) NOT NULL,
    withdrawnAt DATETIME(6),
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (citationId),
    CONSTRAINT uk_citation_business UNIQUE (workflowId, retrievalEpoch, sourceDocumentId, sourceRevision, quotedSpanDigest)
) COMMENT 'Frozen retrieval citation snapshot';

CREATE TABLE t_explanation_snapshot (
    explanationSnapshotId VARCHAR(64) NOT NULL,
    workflowId VARCHAR(64) NOT NULL,
    revision BIGINT NOT NULL,
    publicationStatus VARCHAR(32) NOT NULL,
    contentSnapshot TEXT NOT NULL,
    claimValidationResult TEXT,
    citationSetDigest VARCHAR(128),
    limitationTextCode VARCHAR(64),
    withheldReasonCode VARCHAR(64),
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    validatedAt DATETIME(6),
    publishedAt DATETIME(6),
    PRIMARY KEY (explanationSnapshotId),
    CONSTRAINT uk_explanation_revision UNIQUE (workflowId, revision)
) COMMENT 'Immutable explanation revision';

CREATE TABLE t_human_review_task (
    reviewTaskId VARCHAR(64) NOT NULL,
    workflowId VARCHAR(64) NOT NULL,
    reviewType VARCHAR(48) NOT NULL,
    reviewRound INT NOT NULL,
    status VARCHAR(32) NOT NULL,
    assignedDoctorId BIGINT,
    submittedDoctorId BIGINT,
    decisionCode VARCHAR(64),
    decisionReasonCode VARCHAR(64),
    taskVersion BIGINT NOT NULL DEFAULT 0,
    graphThreadId VARCHAR(128),
    graphCheckpointId VARCHAR(128),
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    claimedAt DATETIME(6),
    submittedAt DATETIME(6),
    cancelledAt DATETIME(6),
    updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (reviewTaskId),
    CONSTRAINT uk_review_task_round UNIQUE (workflowId, reviewType, reviewRound),
    CONSTRAINT ck_review_task_version_nonnegative CHECK (taskVersion >= 0),
    INDEX idx_review_task_workflow_type (workflowId, reviewType, status)
) COMMENT 'Human review task with optimistic version';
