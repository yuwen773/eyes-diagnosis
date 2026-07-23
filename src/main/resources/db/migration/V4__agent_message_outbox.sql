CREATE TABLE IF NOT EXISTS t_agent_message_outbox (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sessionId VARCHAR(64) NOT NULL,
    userId BIGINT NOT NULL,
    role VARCHAR(20) NOT NULL,
    subType VARCHAR(30),
    content TEXT,
    status TINYINT NOT NULL DEFAULT 0,
    retryCount INT NOT NULL DEFAULT 0,
    lastError VARCHAR(512),
    createdTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    deliveredTime DATETIME,
    INDEX idx_session (sessionId),
    INDEX idx_status (status)
) COMMENT 'Agent 消息 Outbox';

CREATE TABLE IF NOT EXISTS t_agent_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sessionId VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL,
    subType VARCHAR(30),
    content TEXT,
    tokenCount INT DEFAULT 0,
    isSummary INT DEFAULT 0,
    createdTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sessionId (sessionId),
    INDEX idx_createdTime (createdTime)
);