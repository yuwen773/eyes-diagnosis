-- baseline: 不写任何破坏性变更；只把不一致的命名归一。
ALTER TABLE t_mcp_server
    CHANGE COLUMN user_id userId BIGINT NOT NULL;

ALTER TABLE t_mcp_server
    CHANGE COLUMN mcp_server_code mcpServerCode VARCHAR(100) NOT NULL;

ALTER TABLE t_mcp_server
    CHANGE COLUMN mcp_server_name mcpServerName VARCHAR(255) NOT NULL;

ALTER TABLE t_mcp_server
    CHANGE COLUMN install_type installType VARCHAR(20) NOT NULL;

ALTER TABLE t_mcp_server
    CHANGE COLUMN deploy_config deployConfig JSON;

ALTER TABLE t_mcp_server
    CHANGE COLUMN create_time createTime DATETIME DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE t_mcp_server
    CHANGE COLUMN update_time updateTime DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 重新建立唯一约束（老库可能只用了 UNIQUE INDEX 命名差异）
ALTER TABLE t_mcp_server
    DROP INDEX idx_code_user,
    ADD UNIQUE KEY uk_mcp_user_code (userId, mcpServerCode);
