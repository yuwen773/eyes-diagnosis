-- Interaction wait only: no new clinical WorkflowStatus and no diagnosis writes.
CREATE TABLE t_python_chat_supplement (
    requestId VARCHAR(36) NOT NULL PRIMARY KEY,
    sessionId VARCHAR(64) NOT NULL,
    activeSessionId VARCHAR(64) NULL,
    workflowId VARCHAR(64) NOT NULL,
    userId BIGINT NOT NULL,
    idempotencyKey VARCHAR(128) NOT NULL,
    originalMessage TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    waitVersion BIGINT NOT NULL DEFAULT 0,
    answer TEXT NULL,
    graphVersion VARCHAR(64) NOT NULL,
    checkpointId VARCHAR(128) NOT NULL,
    createdAt DATETIME NOT NULL,
    answeredAt DATETIME NULL,
    UNIQUE KEY uk_supplement_request (sessionId, idempotencyKey),
    UNIQUE KEY uk_supplement_active (activeSessionId),
    KEY idx_supplement_session (sessionId),
    KEY idx_supplement_workflow (workflowId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
