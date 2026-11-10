#!/usr/bin/env bash
# 后端全量验证：自带一次性 MySQL 8 服务栈，跑完整的 mvn test（含 contextLoads）。
#
# 为什么需要它：
#   - 不带 profile 时 EyeDiagnosisApplicationTests 因 COS 凭据为空启动失败；
#   - 带 SPRING_PROFILES_ACTIVE=ci 时 application-ci.yml 指向 CI 的
#     127.0.0.1:3306/diagnosis_ci，本机通常没有这套实例；
#   - 两个 MySQL 集成测试（FlywayMySqlIntegrationTest 断言空库 migrate 12 个、
#     UploadTaskMapperMySqlIntegrationTest 直连 JDBC 做 CRUD）与 Spring 上下文
#     的 Flyway 共用一个 schema 会互相污染，故按 CI 的编排分两遍跑。
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

echo "==> pass 1/2: full unit suite (including contextLoads)"
mvn -o test -Dtest='!FlywayMySqlIntegrationTest,!UploadTaskMapperMySqlIntegrationTest' "$@"

# 第二遍要一个从未被 Spring 的 Flyway 碰过的空库。
echo "==> pass 2/2: MySQL integration gates on a fresh schema"
docker exec "$CID" mysql -uroot -proot-password \
  -e "DROP DATABASE IF EXISTS diagnosis_ci; CREATE DATABASE diagnosis_ci CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON diagnosis_ci.* TO 'eyeuser'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1

export FLYWAY_TEST_URL="$IT_URL"
export FLYWAY_TEST_USERNAME=root
export FLYWAY_TEST_PASSWORD=root-password
export FLYWAY_TEST_SCHEMA=diagnosis_ci
mvn -o test -Dtest='FlywayMySqlIntegrationTest,UploadTaskMapperMySqlIntegrationTest' "$@"

echo "==> verify green"
