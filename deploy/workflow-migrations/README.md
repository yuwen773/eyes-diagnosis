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
bootstrap callback, unchanged release V10–V14, and additive V15. There is one
`flyway_schema_history`, with `baselineVersion=0` matching the existing Java
configuration. There is no Alembic history or custom history writer.

V10–V14 are byte-for-byte copies from release commit
`5ac742f0db30ded1c87462211a535012d952e4bb`. Keep those files and all earlier
migrations immutable. Reserve subsequent global versions after V15; do not
reuse version numbers between Java and Python deployment assets. Do not repair
checksum failures automatically. See the existing release history policy for
an existing V8 checksum disagreement.

V15 stores bounded original upload bytes in MySQL (2 MiB per input), the
committed graph token, serialized checkpoints and pending writes. No image bytes
are included in graph state, logs or API responses. This is the minimal durable
input store, so API and Worker need no shared local upload directory or COS call.

Rollback here means stopping the Python Worker and reverting upload routing/UI;
retain the additive tables and task data. Do not run `clean`, drop tables, or
rewind history. The original Java session application was actually started on
the V15 acceptance schema. A complete production cutover/rollback rehearsal
belongs to issue 20, not this upgrade smoke check.
