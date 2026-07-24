# Flyway migration-history plan

`V8__add_mcp_server_description.sql` is made idempotent so a database that was
manually aligned with the entity can complete the migration chain. This changes
the V8 checksum.

Before deploying this source to an existing database whose `flyway_schema_history`
already records V8, take a backup and run `flyway repair` during a maintenance
window. Do not edit V1--V7 or delete history rows. New and partially migrated
databases can run `migrate` directly; the pre-migration callback supplies only
the legacy tables required by V1, V5, and V8 on an empty schema.

Validation matrix:

1. Empty database: callback + V1--V9.
2. Pre-V8 legacy snapshot: migrate directly.
3. Existing V8 history: backup, `repair`, then migrate V9.
4. Manually aligned `description` column: migrate directly; V8 performs no-op.
