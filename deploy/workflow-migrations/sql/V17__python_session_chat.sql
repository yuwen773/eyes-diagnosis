-- Preserve existing Java chat rows. Startup never runs DDL.
-- Some installations initialized only Flyway tables, not schema.sql's session table.
CREATE TABLE IF NOT EXISTS t_agent_session (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sessionId VARCHAR(64) NOT NULL,
    userId BIGINT NOT NULL,
    title VARCHAR(255) DEFAULT '新会话',
    modelName VARCHAR(100),
    status TINYINT DEFAULT 1,
    lastMessage VARCHAR(500) DEFAULT '',
    messageCount INT DEFAULT 0,
    summaryContent TEXT,
    summaryAt DATETIME,
    checkpointData BLOB,
    createdTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedTime DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expiredTime DATETIME,
    isDelete INT DEFAULT 0,
    pinned TINYINT(1) NOT NULL DEFAULT 0,
    pinTime DATETIME,
    INDEX idx_userId (userId),
    UNIQUE KEY uk_agent_session_session_id (sessionId)
) COLLATE = utf8mb4_unicode_ci;

CREATE TABLE t_python_chat_run (
    id VARCHAR(36) PRIMARY KEY,
    sessionId VARCHAR(64) NOT NULL,
    activeSessionId VARCHAR(64),
    userId BIGINT NOT NULL,
    messageId BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    errorCode VARCHAR(40),
    createdTime DATETIME NOT NULL,
    deadline DATETIME NOT NULL,
    finishedTime DATETIME,
    UNIQUE KEY uk_active_chat (activeSessionId),
    INDEX idx_session (sessionId)
) COMMENT 'Chat execution outcome; NULL activeSessionId releases the session';

CREATE TABLE t_python_chat_attachment (
    id VARCHAR(36) PRIMARY KEY,
    userId BIGINT NOT NULL,
    url VARCHAR(512) NOT NULL,
    sessionId VARCHAR(64),
    messageId BIGINT,
    createdTime DATETIME NOT NULL,
    isDelete INT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_url (url),
    INDEX idx_message (messageId)
) COMMENT 'Owned COS attachment bound to one chat message';

CREATE TABLE t_python_chat_audit (
    id BIGINT PRIMARY KEY,
    runId VARCHAR(36) NOT NULL,
    sessionId VARCHAR(64) NOT NULL,
    userId BIGINT NOT NULL,
    event VARCHAR(40) NOT NULL,
    createdTime DATETIME NOT NULL,
    INDEX idx_run (runId)
) COMMENT 'Append-only chat execution audit without raw content';
