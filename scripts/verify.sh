#!/usr/bin/env bash
# 后端全量验证：自带一次性 MySQL 8 + Redis 服务栈，跑完整的 mvn test（含 contextLoads）。
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
# 资源生命周期（2026-11-21 起）：
#   - 所有容器 / 卷都带 eye.owner=eye-diagnosis、eye.run-id=<本次运行> 标签；
#   - MySQL / Redis 官方镜像声明了 VOLUME，故必须挂命名卷；teardown 显式删卷，
#     不再留匿名卷（`docker rm -f` 不会删匿名卷，这是历史泄漏的主因）；
#   - 默认用随机宿主端口，多个 verify 可并行；设 VERIFY_MYSQL_PORT /
#     VERIFY_REDIS_PORT 可固定端口；
#   - 正常 / 失败 / 超时 / Ctrl-C 都走同一个 trap；结束时断言本次 run-id
#     已无任何容器、卷、网络残留，残留会让脚本非 0 退出——**失败路径也断言**，
#     不让「测试绿了但卷没删」只在 happy path 才被发现；
#   - EYE_DOCKER_KEEP=1 可保留现场（资源仍有标签，供
#     scripts/docker-test-resources.sh 列出后手动回收）。
#
# 用法：scripts/verify.sh [额外的 mvn 参数...]
# 覆盖：VERIFY_MYSQL_PORT / VERIFY_REDIS_PORT / MYSQL_IMAGE / REDIS_IMAGE / JAVA_HOME
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/lib/docker-images.env
. "$ROOT/scripts/lib/docker-images.env"
# shellcheck source=scripts/lib/docker-test-harness.sh
. "$ROOT/scripts/lib/docker-test-harness.sh"

EYE_DOCKER_KIND=test eye_docker_init
eye_docker_require
eye_docker_trap_teardown

MYSQL_CID="$(eye_docker_container_name mysql)"
REDIS_CID="$(eye_docker_container_name redis)"
MYSQL_VOL="$(eye_docker_volume_name mysql-data)"
REDIS_VOL="$(eye_docker_volume_name redis-data)"

if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_HOME="/c/Users/yuwen/.jdks/corretto-21.0.7"
fi
export JAVA_HOME

echo "==> run id: ${EYE_DOCKER_RUN_ID}"
echo "==> images: ${MYSQL_IMAGE} + ${REDIS_IMAGE}"
eye_docker_require_image "$MYSQL_IMAGE"
eye_docker_require_image "$REDIS_IMAGE"

# 官方镜像声明了 VOLUME；用带标签的命名卷接管，避免匿名卷泄漏。
eye_docker_volume_create "$MYSQL_VOL"
eye_docker_volume_create "$REDIS_VOL"

# 默认 127.0.0.1::<port> 让 Docker 分配空闲宿主端口，避免并发 verify 抢端口。
MYSQL_PORT="${VERIFY_MYSQL_PORT:-}"
REDIS_PORT="${VERIFY_REDIS_PORT:-}"
if [[ -n "$MYSQL_PORT" ]]; then
  MYSQL_PUBLISH="127.0.0.1:${MYSQL_PORT}:3306"
else
  MYSQL_PUBLISH="127.0.0.1::3306"
fi
if [[ -n "$REDIS_PORT" ]]; then
  REDIS_PUBLISH="127.0.0.1:${REDIS_PORT}:6379"
else
  REDIS_PUBLISH="127.0.0.1::6379"
fi

echo "==> starting Redis (container ${REDIS_CID})"
eye_docker_run_named "$REDIS_CID" -d \
  -p "$REDIS_PUBLISH" \
  --mount "type=volume,src=${REDIS_VOL},dst=/data" \
  "$REDIS_IMAGE" >/dev/null

echo "==> starting MySQL 8 (container ${MYSQL_CID})"
eye_docker_run_named "$MYSQL_CID" -d \
  -e MYSQL_DATABASE=diagnosis_ci \
  -e MYSQL_USER=eyeuser \
  -e MYSQL_PASSWORD=ci-password \
  -e MYSQL_ROOT_PASSWORD=root-password \
  -p "$MYSQL_PUBLISH" \
  --mount "type=volume,src=${MYSQL_VOL},dst=/var/lib/mysql" \
  "$MYSQL_IMAGE" >/dev/null

if [[ -z "$MYSQL_PORT" ]]; then
  for _ in $(seq 1 50); do
    MYSQL_PORT="$(eye_docker_host_port "$MYSQL_CID" 3306)"
    [[ -n "$MYSQL_PORT" ]] && break
    sleep 0.2
  done
  [[ -n "$MYSQL_PORT" ]] || { echo "could not discover MySQL host port" >&2; exit 1; }
fi
if [[ -z "$REDIS_PORT" ]]; then
  for _ in $(seq 1 50); do
    REDIS_PORT="$(eye_docker_host_port "$REDIS_CID" 6379)"
    [[ -n "$REDIS_PORT" ]] && break
    sleep 0.2
  done
  [[ -n "$REDIS_PORT" ]] || { echo "could not discover Redis host port" >&2; exit 1; }
fi
echo "==> MySQL on 127.0.0.1:${MYSQL_PORT}, Redis on 127.0.0.1:${REDIS_PORT}"

READY=0
for _ in $(seq 1 90); do
  if docker exec "$MYSQL_CID" mysqladmin ping -h127.0.0.1 -uroot -proot-password >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[[ "$READY" == 1 ]] || { echo "MySQL did not become ready" >&2; exit 1; }

eye_docker_wait_ready 30 docker exec "$REDIS_CID" redis-cli ping \
  || { echo "Redis did not become ready" >&2; exit 1; }

# 集成测试用 root 建库/查 information_schema；eyeuser 供 Spring 数据源使用。
docker exec "$MYSQL_CID" mysql -uroot -proot-password \
  -e "GRANT ALL PRIVILEGES ON *.* TO 'eyeuser'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1

# 第三遍里的故障注入用 CREATE TRIGGER 制造写失败（回滚语义），而 MySQL 8 默认开启
# binlog，非 SUPER 账号建触发器会被 1419 拒绝。CI 的 mysql:8.0 服务同样需要这一项。
docker exec "$MYSQL_CID" mysql -uroot -proot-password \
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
mvn -o test -Dtest='!FlywayMySqlIntegrationTest,!UploadTaskMapperMySqlIntegrationTest,!ToolAuditMySqlIntegrationTest,!ToolTerminalPersistenceMySqlIntegrationTest' "$@"

# 第二遍要一个从未被 Spring 的 Flyway 碰过的空库。
echo "==> pass 2/3: MySQL integration gates on a fresh schema"
docker exec "$MYSQL_CID" mysql -uroot -proot-password \
  -e "DROP DATABASE IF EXISTS diagnosis_ci; CREATE DATABASE diagnosis_ci CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON diagnosis_ci.* TO 'eyeuser'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1

export FLYWAY_TEST_URL="$IT_URL"
export FLYWAY_TEST_USERNAME=root
export FLYWAY_TEST_PASSWORD=root-password
export FLYWAY_TEST_SCHEMA=diagnosis_ci
mvn -o test -Dtest='FlywayMySqlIntegrationTest,UploadTaskMapperMySqlIntegrationTest,ToolAuditMySqlIntegrationTest,ToolTerminalPersistenceMySqlIntegrationTest' "$@"

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
docker exec "$MYSQL_CID" mysql -uroot -proot-password -e "${ISO_SQL} FLUSH PRIVILEGES;" >/dev/null 2>&1

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

# 资源回收属于验收的一部分：删干净并断言，不以单测绿代替。
# trap 在失败/中断路径做同样的事；这里显式跑一次，让通过路径的输出顺序是 clean → green。
eye_docker_teardown
EYE_DOCKER_CLEAN=1   # 下面已经断言过，trap 不必再跑一遍
eye_docker_assert_clean
echo "==> verify green"
