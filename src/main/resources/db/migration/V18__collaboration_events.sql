-- Java-line additive migration. Does not reconcile the separate master migration history.
CREATE TABLE t_agent_collab_run (
    runId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    threadId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ownerUserId BIGINT NOT NULL,
    idempotencyKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    inferenceDigest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    runtimeKind VARCHAR(32) NOT NULL,
    workflowVersion VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    stopReason VARCHAR(64),
    seq BIGINT NOT NULL DEFAULT 0,
    roleStates JSON NOT NULL,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uk_collab_task (taskId),
    UNIQUE KEY uk_collab_request (ownerUserId, idempotencyKey),
    KEY idx_collab_pending (status, createdAt)
) ENGINE=InnoDB;

CREATE TABLE t_agent_collab_event (
    runId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT NOT NULL,
    type VARCHAR(64) NOT NULL,
    actor VARCHAR(32) NOT NULL,
    visibility VARCHAR(32) NOT NULL,
    payloadJson JSON NOT NULL,
    occurredAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    schemaVersion INT NOT NULL,
    PRIMARY KEY (runId, seq),
    CONSTRAINT fk_collab_event_run FOREIGN KEY (runId) REFERENCES t_agent_collab_run(runId)
) ENGINE=InnoDB;
