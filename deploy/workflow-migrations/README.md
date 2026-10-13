# Workflow Flyway upgrades

Run this deployment step before starting the Python upload API/Worker. Web and
Worker startup never create or migrate tables. Use JDK 21 and the same MySQL
schema/history table used by the Java session service.

```powershell
$env:JAVA_HOME='C:\Users\yuwen\.jdks\corretto-21.0.7'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
# Set these from your local secret/config store; do not commit credentials.
$env:FLYWAY_URL='jdbc:mysql://127.0.0.1:3307/<schema>?serverTimezone=Asia/Shanghai'
$env:FLYWAY_USER='<migration-user>'
$env:FLYWAY_PASSWORD='<local-secret>'
mvn -f deploy/workflow-migrations/pom.xml flyway:info
mvn -f deploy/workflow-migrations/pom.xml flyway:validate
mvn -f deploy/workflow-migrations/pom.xml flyway:migrate
```

The pinned standalone Flyway Maven plugin 12.4.0 uses the existing V1–V9 and
bootstrap callback, unchanged release V10–V14, and additive V15–V19. There is one
`flyway_schema_history`, with `baselineVersion=0` matching the existing Java
configuration. There is no Alembic history or custom history writer.

V10–V14 are byte-for-byte copies from release commit
`5ac742f0db30ded1c87462211a535012d952e4bb`. Keep those files and all earlier
migrations immutable. Reserve subsequent global versions after V19; do not
reuse version numbers between Java and Python deployment assets. V17 is reserved
for Python session chat (apply before routing Agent traffic to Python). Do not repair
checksum failures automatically. See the existing release history policy for
an existing V8 checksum disagreement.

V17 retains `t_agent_session` / `t_agent_message` and adds chat execution outcomes,
owned COS attachment bindings and append-only execution audit. It creates the
legacy session table only if absent; it never drops messages or deserializes Java
checkpoint blobs. Chat API restart reads history from MySQL. An abandoned stream
is marked interrupted on the next session read/send after its 130-second deadline;
it is never resumed as a successful model response. This is separate from the
durable diagnostic worker. See `docs/chat-session-memory.md` for cutover limits.

V18 adds the session/Workflow association and bounded original image bytes for new
chat uploads. Apply it before deploying issue06 API code; API startup does no DDL.
Chat and upload share the same Workflow creation digest/key and Worker. Pre-V18
attachments with no original bytes must be re-uploaded for diagnostic creation;
ordinary legacy attachment chat stays compatible. Rollback retains these columns
and bindings. See `docs/chat-workflow-binding.md` for contracts and verification.

V15 stores bounded original upload bytes in MySQL (2 MiB per input), the
committed graph token, serialized checkpoints and pending writes. No image bytes
are included in graph state, logs or API responses. This is the minimal durable
input store, so API and Worker need no shared local upload directory or COS call.

V16 binds each new Python quality review task to its workflow version, immutable
inference envelope and graph/action versions. Existing release review rows retain
NULL bindings; they are not silently adopted by the Python runtime. Apply V16
before starting this API/Worker. Its real MySQL upgrade and Java startup validation
have not been run for issue 04; earlier V15 acceptance does not cover V16.

Rollback here means stopping the Python Worker and reverting upload routing/UI;
retain the additive tables and task data. Do not run `clean`, drop tables, or
rewind history. The original Java session application was actually started on
the V15 acceptance schema. A complete production cutover/rollback rehearsal
belongs to issue 20, not this upgrade smoke check.

V19 adds controlled reference visibility/review/codes/version/actor fields and the
task evidence snapshot. Old documents default to PRIVATE_USER + PENDING with no
controlled codes; none are promoted automatically. Apply before issue08 API and
Worker deployment. Real MySQL V19 migration and Java interoperability remain
unverified; controlled SQLite/API/browser tests do not cover those gates. See
`docs/controlled-reference-evidence.md`. Rollback retains the additive columns.
