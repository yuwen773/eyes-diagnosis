-- Additive user consent for server-owned chat business operations.
CREATE TABLE t_agent_tool_confirmation (
    confirmationId VARCHAR(64) NOT NULL PRIMARY KEY,
    ownerUserId BIGINT NOT NULL,
    sessionId VARCHAR(64) NOT NULL,
    idempotencyKey VARCHAR(128) NOT NULL,
    contentSnapshot LONGTEXT NOT NULL,
    contentDigest VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    createdAt DATETIME NOT NULL,
    expiresAt DATETIME NOT NULL,
    decidedAt DATETIME NULL,
    UNIQUE KEY uq_agent_tool_owner_key (ownerUserId, idempotencyKey),
    KEY idx_agent_tool_session (sessionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
