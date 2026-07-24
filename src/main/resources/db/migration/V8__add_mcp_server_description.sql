-- Permit both the normal V1--V7 path and a manually aligned legacy schema.
SET @description_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 't_mcp_server'
      AND column_name = 'description'
);
SET @description_ddl := IF(
    @description_exists = 0,
    'ALTER TABLE t_mcp_server ADD COLUMN description VARCHAR(500) NULL AFTER name',
    'SELECT 1'
);
PREPARE description_statement FROM @description_ddl;
EXECUTE description_statement;
DEALLOCATE PREPARE description_statement;
