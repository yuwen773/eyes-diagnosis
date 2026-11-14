-- Ordinary-chat tool audit. Separate from user-visible chat history (t_agent_message).
-- NEVER stores raw tool arguments, prompts, patient text or provider responses.
-- Additive only: V1-V27 are untouched; new work must add V29+.
CREATE TABLE IF NOT EXISTS t_agent_tool_audit (
    auditId BIGINT PRIMARY KEY AUTO_INCREMENT,
    sessionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    userId BIGINT NOT NULL,
    toolCallId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    toolName VARCHAR(128) NOT NULL,
    toolStatus VARCHAR(32) NOT NULL,
    errorCategory VARCHAR(32) NOT NULL,
    argsDigest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    argsKeyNames VARCHAR(512) NULL,
    startedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    finishedAt DATETIME(6) NULL,
    UNIQUE KEY uk_tool_audit_call (toolCallId, toolStatus),
    INDEX idx_tool_audit_session (sessionId, userId, startedAt),
    INDEX idx_tool_audit_name_status (toolName, toolStatus)
) ENGINE=InnoDB COMMENT 'Structured tool-call audit (no sensitive payloads)';
