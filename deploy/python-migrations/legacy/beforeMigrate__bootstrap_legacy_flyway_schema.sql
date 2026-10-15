-- Fresh installations need the pre-Flyway tables that V1, V5, and V8 evolve.
-- Existing databases are unaffected because every statement is CREATE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS t_mcp_server (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    mcp_server_code VARCHAR(100) NOT NULL,
    mcp_server_name VARCHAR(255) NOT NULL,
    install_type VARCHAR(20) NOT NULL,
    host VARCHAR(500),
    deploy_config JSON,
    status TINYINT DEFAULT 1,
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_code_user (mcp_server_code, user_id)
) COMMENT 'Flyway legacy MCP bootstrap';

CREATE TABLE IF NOT EXISTS t_diagnosis (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    url VARCHAR(512) NOT NULL,
    userId BIGINT NOT NULL,
    result VARCHAR(64),
    confidence DOUBLE,
    probability DOUBLE,
    recommendations VARCHAR(512),
    details VARCHAR(512),
    severity VARCHAR(64),
    reexamineStatus INT NOT NULL DEFAULT 1,
    picSize BIGINT,
    picWidth INT,
    picHeight INT,
    picScale DOUBLE,
    picFormat VARCHAR(32),
    createTime DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    isDelete TINYINT NOT NULL DEFAULT 0,
    INDEX idx_result (result),
    INDEX idx_category (severity),
    INDEX idx_userId (userId)
) COMMENT 'Flyway diagnosis bootstrap';
