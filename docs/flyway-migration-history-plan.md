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

## V15 / V16 (2026-11-10)

Two new migrations, no edits to V1--V9:

- **V15** owns the four legacy tables (`t_user`, `t_news`, `t_agent_session`,
  `t_knowledge_document`) that entities reference but the migration chain never
  created. Previously they came from the now-deleted `db/schema.sql` or the
  `release/v1.0.0`-only `deploy/mysql/init/01_legacy_schema.sql`. All statements
  use `CREATE TABLE IF NOT EXISTS`, so existing databases are unaffected.
- **V16** normalizes `t_diagnosis.weightSha256` to `VARCHAR(64)` (matching
  `t_inference_cache`) and adds `t_diagnosis.version` for optimistic locking.

Numbers start at 15 because `release/v1.0.0`, `worktree-java-multi-agent-arch`
and other branches already occupy V10--V14; merging those lines must not create
duplicate Flyway versions.

`t_agent_message_outbox` is deliberately **kept**: the config warned that its
dispatcher could replay pre-existing rows, so production databases may hold
historical rows. The Java/XML outbox shell is removed and the table is no longer
written or read. Dropping it is a separate, explicit data-retention decision.

Updated validation matrix for this branch:

1. Empty MySQL 8 database: callback + V1--V9 + V15 + V16 = 11 migrations,
   all four legacy tables present (`FlywayMySqlIntegrationTest`, verified
   2026-11-10 against `diagnosis_ci` on 3307).
2. Existing database at V9: V15 is a no-op for the four tables that already
   exist; V16 shortens a column no value exceeds and adds a defaulted column.
3. Existing database at V10--V14 from a sibling branch: verify the version
   numbers before merging; V15/V16 must stay above that branch's head.
