-- V1 converts the legacy snake_case schema to camelCase.  This migration keeps
-- the final persisted vocabulary aligned with McpServer's explicit mappings.
ALTER TABLE t_mcp_server
    CHANGE COLUMN mcpServerName name VARCHAR(255) NOT NULL;
