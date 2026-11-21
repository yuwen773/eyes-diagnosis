-- Fresh installations need the existing chat entities. Existing tables remain unchanged.
CREATE TABLE IF NOT EXISTS t_agent_session (
    id BIGINT NOT NULL PRIMARY KEY,
    sessionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    userId BIGINT NOT NULL,
    title VARCHAR(255),
    modelName VARCHAR(128),
    status INT NOT NULL DEFAULT 1,
    lastMessage TEXT,
    messageCount INT NOT NULL DEFAULT 0,
    summaryContent MEDIUMTEXT,
    summaryAt DATETIME(6),
    checkpointData LONGBLOB,
    createdTime DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updatedTime DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expiredTime DATETIME(6),
    isDelete INT NOT NULL DEFAULT 0,
    pinned INT NOT NULL DEFAULT 0,
    pinTime DATETIME(6),
    UNIQUE KEY uk_agent_session (sessionId),
    KEY idx_agent_session_owner (userId, isDelete, updatedTime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t_agent_message (
    id BIGINT NOT NULL PRIMARY KEY,
    sessionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role VARCHAR(32) NOT NULL,
    subType VARCHAR(32),
    content MEDIUMTEXT,
    tokenCount INT,
    isSummary INT NOT NULL DEFAULT 0,
    createdTime DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_agent_message_session (sessionId, createdTime, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
