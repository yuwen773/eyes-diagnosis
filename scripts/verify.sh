#!/usr/bin/env bash
# 后端全量验证：自带一次性 MySQL 8 服务栈，跑完整的 mvn test（含 contextLoads）。
#
# 为什么需要它：
#   - 不带 profile 时 EyeDiagnosisApplicationTests 因 COS 凭据为空启动失败；
#   - 带 SPRING_PROFILES_ACTIVE=ci 时 application-ci.yml 指向 CI 的
#     127.0.0.1:3306/diagnosis_ci，本机通常没有这套实例；
#   - 三个 MySQL 集成测试（FlywayMySqlIntegrationTest 断言空库 migrate 到 V28、
#     UploadTaskMapperMySqlIntegrationTest 直连 JDBC 做 CRUD、ToolAuditMySqlIntegrationTest
#     校验 V28 审计表）与 Spring 上下文的 Flyway 共用一个 schema 会互相污染，故按 CI
#     的编排分两遍跑。
#
# 用法：scripts/verify.sh [额外的 mvn 参数...]
# 覆盖：VERIFY_MYSQL_PORT / VERIFY_REDIS_PORT / MYSQL_IMAGE / JAVA_HOME
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MYSQL_PORT="${VERIFY_MYSQL_PORT:-33306}"
REDIS_PORT="${VERIFY_REDIS_PORT:-36379}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0.26}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:7-alpine}"
CID="eye-diagnosis-verify-$$"
REDIS_CID="eye-diagnosis-verify-redis-$$"

if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_HOME="/c/Users/yuwen/.jdks/corretto-21.0.7"
fi
export JAVA_HOME

cleanup() {
  docker rm -f "$CID" "$REDIS_CID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker rm -f "$CID" "$REDIS_CID" >/dev/null 2>&1 || true

echo "==> starting Redis on 127.0.0.1:${REDIS_PORT} (container ${REDIS_CID})"
docker run -d --name "$REDIS_CID" \
  -p "${REDIS_PORT}:6379" "$REDIS_IMAGE" >/dev/null

echo "==> starting MySQL 8 on 127.0.0.1:${MYSQL_PORT} (container ${CID})"
docker run -d --name "$CID" \
  -e MYSQL_DATABASE=diagnosis_ci \
  -e MYSQL_USER=eyeuser \
  -e MYSQL_PASSWORD=ci-password \
  -e MYSQL_ROOT_PASSWORD=root-password \
  -p "${MYSQL_PORT}:3306" "$MYSQL_IMAGE" >/dev/null

READY=0
for _ in $(seq 1 90); do
  if docker exec "$CID" mysqladmin ping -h127.0.0.1 -uroot -proot-password >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[[ "$READY" == 1 ]] || { echo "MySQL did not become ready" >&2; exit 1; }

# 集成测试用 root 建库/查 information_schema；eyeuser 供 Spring 数据源使用。
docker exec "$CID" mysql -uroot -proot-password \
  -e "GRANT ALL PRIVILEGES ON *.* TO 'eyeuser'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1

# 第三遍里的故障注入用 CREATE TRIGGER 制造写失败（回滚语义），而 MySQL 8 默认开启
# binlog，非 SUPER 账号建触发器会被 1419 拒绝。CI 的 mysql:8.0 服务同样需要这一项。
docker exec "$CID" mysql -uroot -proot-password \
  -e "SET GLOBAL log_bin_trust_function_creators=1;" >/dev/null 2>&1

DB_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/diagnosis_ci?serverTimezone=UTC"
IT_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/diagnosis_ci?serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=false"

# 复刻 .github/workflows/verify.yml 的 backend-unit + flyway-mysql 两个 job。
export SPRING_PROFILES_ACTIVE=ci
export SPRING_DATASOURCE_URL="$DB_URL"
export SPRING_DATASOURCE_USERNAME=eyeuser
export SPRING_DATASOURCE_PASSWORD=ci-password
export SPRING_FLYWAY_SCHEMAS=diagnosis_ci
export SPRING_DATA_REDIS_HOST=127.0.0.1
export SPRING_DATA_REDIS_PORT="$REDIS_PORT"

echo "==> pass 1/3: full unit suite (including contextLoads)"
mvn -o test -Dtest='!FlywayMySqlIntegrationTest,!UploadTaskMapperMySqlIntegrationTest,!ToolAuditMySqlIntegrationTest' "$@"

# 第二遍要一个从未被 Spring 的 Flyway 碰过的空库。
echo "==> pass 2/3: MySQL integration gates on a fresh schema"
docker exec "$CID" mysql -uroot -proot-password \
  -e "DROP DATABASE IF EXISTS diagnosis_ci; CREATE DATABASE diagnosis_ci CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON diagnosis_ci.* TO 'eyeuser'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1

export FLYWAY_TEST_URL="$IT_URL"
export FLYWAY_TEST_USERNAME=root
export FLYWAY_TEST_PASSWORD=root-password
export FLYWAY_TEST_SCHEMA=diagnosis_ci
mvn -o test -Dtest='FlywayMySqlIntegrationTest,UploadTaskMapperMySqlIntegrationTest,ToolAuditMySqlIntegrationTest' "$@"

# 第三遍：协作 / 患者草稿 / 医生复核 / 任务恢复等隔离库套件。
#
# 这些类刻意不共用 Spring 的 diagnosis_ci：它们自己建表、自己清表、还会 fork
# 子 JVM 模拟进程崩溃（恢复与协调）。但它们的门禁是「环境变量给出了隔离库」，
# 没给就整类跳过——不跑它们等于协作契约、权限负例、恢复语义全都没有验证。
# 这里按每个类写死的 schema 名和账号建库/建号（URL 必须整串匹配，不能带参数，
# 故用 mysql_native_password 免掉 allowPublicKeyRetrieval）。
echo "==> pass 3/3: isolated-database collaboration suites"
ISO_SQL=""
for pair in collaboration_test:collaboration graph_execution_test:graph_execution \
            product_acceptance_test:product_acceptance coordination_poc:poc \
            issue17_test:issue17 issue18_test:issue18 issue19_test:issue19 \
            issue20_test:issue20 issue21_test:issue21 issue22_test:issue22 issue23_test:issue23; do
  schema="${pair%%:*}"; account="${pair##*:}"
  ISO_SQL+="CREATE DATABASE IF NOT EXISTS ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  ISO_SQL+="CREATE USER IF NOT EXISTS '${account}'@'%' IDENTIFIED WITH mysql_native_password BY '${account}';"
  ISO_SQL+="GRANT ALL PRIVILEGES ON ${schema}.* TO '${account}'@'%';"
done
docker exec "$CID" mysql -uroot -proot-password -e "${ISO_SQL} FLUSH PRIVILEGES;" >/dev/null 2>&1

export COLLABORATION_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/collaboration_test"
export GRAPH_EXECUTION_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/graph_execution_test"
export PRODUCT_ACCEPTANCE_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/product_acceptance_test"
export COORDINATION_POC_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/coordination_poc"
export ISSUE17_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue17_test"
export ISSUE18_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue18_test"
export ISSUE19_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue19_test"
export ISSUE20_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue20_test"
export ISSUE21_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue21_test"
export ISSUE22_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue22_test"
export ISSUE23_TEST_URL="jdbc:mysql://127.0.0.1:${MYSQL_PORT}/issue23_test"

# 这一批隔离库套件把 SQL 侧 NOW(6) 写入和 JVM 侧 Timestamp 写入放在同一列比较
# （GraphExecutionTest 的 lease 心跳最典型），所以 JVM 时区必须与 MySQL 时区一致。
# 容器默认 UTC，而 Windows 开发机是 +08，差 8 小时会让租约看起来已过期、被竞争者抢走。
# GitHub runner 上两边本来就是 UTC，这里显式对齐；JAVA_TOOL_OPTIONS 会传给 forked surefire JVM。
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Duser.timezone=UTC"
mvn -o test -Dtest='CollaborationRunTest,GraphExecutionTest,ProductSchemaTest,ControlledReferenceApiTest,DiagnosisTaskApiTest,DiagnosisTaskRecoveryTest,DoctorReviewApiTest,PatientAuthorizationApiTest,PatientDraftTest,PatientExplanationApiTest,PatientFollowUpApiTest,CoordinationMySqlTest' "$@"
unset JAVA_TOOL_OPTIONS

echo "==> verify green"
