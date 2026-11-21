#!/usr/bin/env bash
# 分级验证入口：让「改一两个文件」不必每次都跑 release 级全量。
#
# 为什么要有它：`scripts/verify.sh` 会起一次性 MySQL + Redis + Chroma，
# 跑完整套件（含 Spring 上下文与两个 MySQL 集成门禁），十几分钟起步。它是对的，
# 但不该是每次改动的默认动作——反馈成本被摊到每次小修上，人和 Agent 就会用
# 「少跑」换速度，那才是真正降低门禁。这里把「跑什么」显式化：
# 默认只跑受影响的那一小块，全量仍然是 L3（原样交给 verify.sh）。
#
# 四个级别（规则与影响映射见 docs/testing/verification-levels.md）：
#   L0  静态与差异：git 差异摘要 + 受影响语言的编译/类型检查，不跑任何用例
#   L1  定向测试（默认）：指定的 Java 用例与/或 Vitest 文件
#   L2  定向测试 + 一次性 MySQL/Redis/Chroma：给集成套件用
#   L3  发布级全量：直接调 scripts/verify.sh，不在这里重写
#
# 用法：
#   scripts/verify-fast.sh --level L0
#   scripts/verify-fast.sh --java SessionMessageQueueTest
#   scripts/verify-fast.sh --java 'SessionMessageQueueTest#anEvictedWriteNeverReportsSuccess'
#   scripts/verify-fast.sh --web src/lib/agentStream.test.ts
#   scripts/verify-fast.sh --java FlywayMySqlIntegrationTest --db
#   scripts/verify-fast.sh --level L3
#
# 结果打印成一行 `RESULT: PASS|FAIL|TIMEOUT`，附带代码 SHA 与日志目录。
# 退出码：0 通过；1 失败；124 超时；2 用法错误。
#
# 覆盖：VERIFY_FAST_MYSQL_PORT(33316) / VERIFY_FAST_REDIS_PORT(36389) /
#       VERIFY_FAST_TIMEOUT(900) / MYSQL_IMAGE / REDIS_IMAGE / CHROMA_IMAGE /
#       MVN_FLAGS(-o) / JAVA_HOME
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LEVEL="L1"
JAVA_PATTERNS=()
WEB_PATTERNS=()
NEED_DB=0
WITH_STATIC=0
TIMEOUT_PER_STAGE="${VERIFY_FAST_TIMEOUT:-900}"
MVN_FLAGS="${MVN_FLAGS:--o}"
RUN_ID="$$-$(date +%s)"
LOG_DIR="$ROOT/target/verify-fast/$RUN_ID"

usage() {
  sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)   LEVEL="${2:-}"; shift 2;;
    --java)    JAVA_PATTERNS+=("$2"); shift 2;;
    --web)     WEB_PATTERNS+=("$2"); shift 2;;
    --db)      NEED_DB=1; shift;;
    --static)  WITH_STATIC=1; shift;;
    --timeout) TIMEOUT_PER_STAGE="$2"; shift 2;;
    -h|--help) usage;;
    --) shift; break;;
    *) echo "未知参数：$1" >&2; usage;;
  esac
done
EXTRA_MVN_ARGS=("$@")

case "$LEVEL" in L0|L1|L2|L3) ;; *) echo "--level 只能是 L0/L1/L2/L3" >&2; exit 2;; esac
[[ "$LEVEL" == "L2" ]] && NEED_DB=1
# --db 就是 L2 的意思：级别要如实显示，别让人以为跑的是 L1
[[ $NEED_DB -eq 1 && "$LEVEL" == "L1" ]] && LEVEL="L2"
[[ "$LEVEL" == "L0" ]] && WITH_STATIC=1

if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_HOME="/c/Users/yuwen/.jdks/corretto-21.0.7"
fi
export JAVA_HOME

mkdir -p "$LOG_DIR"
CODE_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
if [[ -n "$(git status --porcelain 2>/dev/null | head -1)" ]]; then DIRTY_LABEL="dirty"; else DIRTY_LABEL="clean"; fi

echo "==> level=$LEVEL sha=$CODE_SHA tree=$DIRTY_LABEL logs=$LOG_DIR"
echo "    java=${JAVA_PATTERNS[*]:-<none>} web=${WEB_PATTERNS[*]:-<none>} db=$NEED_DB static=$WITH_STATIC timeout=${TIMEOUT_PER_STAGE}s"

# ── 阶段执行：盯着进程本身，不看日志猜 ──────────────────────────────────────
# 不 sleep-poll 日志：那既不知道进程死活，也分不清「还在跑」和「已经挂了」。
# 这里挂 PID：进程结束立刻拿到真实退出码；到点先 TERM 再 KILL，明确报 TIMEOUT。
# TIMEOUT 不算通过——超时的阶段什么也没证明。
kill_tree() {
  local pid=$1
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  else
    kill -TERM "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
  fi
}

run_bounded() {
  local label="$1" log="$2"; shift 2
  local started deadline rc
  started=$(date +%s)
  deadline=$(( started + TIMEOUT_PER_STAGE ))
  echo "==> $label（上限 ${TIMEOUT_PER_STAGE}s）"
  "$@" >"$log" 2>&1 &
  local pid=$!
  while kill -0 "$pid" >/dev/null 2>&1; do
    if [[ $(date +%s) -ge $deadline ]]; then
      kill_tree "$pid"
      wait "$pid" >/dev/null 2>&1
      echo "!!! $label TIMEOUT（${TIMEOUT_PER_STAGE}s，已终止本阶段自己的进程）"
      return 124
    fi
    sleep 1
  done
  wait "$pid"; rc=$?
  local elapsed=$(( $(date +%s) - started ))
  if [[ $rc -eq 0 ]]; then echo "    $label PASS (${elapsed}s)"; else echo "    $label FAIL rc=$rc (${elapsed}s)"; fi
  return $rc
}

FAILED_STAGES=()
TIMED_OUT=0

record_stage() {
  local name="$1" rc="$2"
  if [[ $rc -eq 124 ]]; then TIMED_OUT=1; FAILED_STAGES+=("$name(TIMEOUT)");
  elif [[ $rc -ne 0 ]]; then FAILED_STAGES+=("$name"); fi
}

changed_files() {
  { git diff --name-only HEAD 2>/dev/null; git ls-files -o --exclude-standard 2>/dev/null; } | sort -u
}

# ── L0：差异摘要 + 受影响语言的编译 / 类型检查 ──────────────────────────────
run_static() {
  echo "--- L0 静态与差异检查 ---"
  local changed
  changed="$(changed_files)"
  git --no-pager diff --stat HEAD >"$LOG_DIR/git-diff-stat.log" 2>&1 || true
  echo "    改动文件（$(printf '%s\n' "$changed" | grep -c . || true) 个）："
  printf '%s\n' "$changed" | sed 's/^/      /' | head -15

  local rc_any=0 rc
  if printf '%s\n' "$changed" | grep -qE '^(src/|pom\.xml|algorithm/)'; then
    # test-compile 同时覆盖主代码与测试代码的编译错误，不执行任何用例
    run_bounded "java-compile" "$LOG_DIR/java-compile.log" mvn $MVN_FLAGS -DskipTests test-compile
    rc=$?; record_stage "java-compile" $rc; [[ $rc -ne 0 ]] && { tail -20 "$LOG_DIR/java-compile.log"; rc_any=$rc; }
  else
    echo "    （没有 Java / pom 改动，跳过编译）"
  fi

  if printf '%s\n' "$changed" | grep -qE '^web/'; then
    if [[ -x web/node_modules/.bin/tsc ]]; then
      run_bounded "web-typecheck" "$LOG_DIR/web-typecheck.log" bash -c 'cd web && node_modules/.bin/tsc -b'
      rc=$?; record_stage "web-typecheck" $rc; [[ $rc -ne 0 ]] && { tail -20 "$LOG_DIR/web-typecheck.log"; rc_any=$rc; }
    else
      echo "    跳过 web 类型检查：web/node_modules 不存在（先在 web/ 下 npm ci）"
    fi
  else
    echo "    （没有 web/ 改动，跳过类型检查）"
  fi

  return $rc_any
}

# ── 一次性 MySQL + Redis + Chroma（L2 / --db） ─────────────────────────────
MYSQL_CID=""; REDIS_CID=""; CHROMA_CID=""

cleanup_db() {
  # 只删本次运行自己创建的容器；复用到的既有服务（例如 docker-compose 起的 Chroma）不动
  [[ -n "$MYSQL_CID" ]] && docker rm -f "$MYSQL_CID" >/dev/null 2>&1
  [[ -n "$REDIS_CID" ]] && docker rm -f "$REDIS_CID" >/dev/null 2>&1
  [[ -n "$CHROMA_CID" ]] && docker rm -f "$CHROMA_CID" >/dev/null 2>&1
  return 0
}

start_db() {
  command -v docker >/dev/null || { echo "docker is required for --db" >&2; return 1; }
  local mysql_port="${VERIFY_FAST_MYSQL_PORT:-33316}"
  local redis_port="${VERIFY_FAST_REDIS_PORT:-36389}"
  MYSQL_CID="eye-diagnosis-fast-mysql-$RUN_ID"
  REDIS_CID="eye-diagnosis-fast-redis-$RUN_ID"

  echo "==> 起一次性 MySQL 8 (:$mysql_port) + Redis (:$redis_port)"
  docker run -d --name "$REDIS_CID" -p "${redis_port}:6379" "${REDIS_IMAGE:-redis:7-alpine}" >/dev/null || return 1
  docker run -d --name "$MYSQL_CID" \
    -e MYSQL_DATABASE=diagnosis_ci \
    -e MYSQL_USER=eyeuser -e MYSQL_PASSWORD=ci-password \
    -e MYSQL_ROOT_PASSWORD=root-password \
    -p "${mysql_port}:3306" "${MYSQL_IMAGE:-mysql:8.0.26}" >/dev/null || return 1

  local ready=0
  for _ in $(seq 1 90); do
    if docker exec "$MYSQL_CID" mysqladmin ping -h127.0.0.1 -uroot -proot-password >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [[ $ready -eq 1 ]] || { echo "MySQL 未就绪" >&2; return 1; }

  # 集成用例用 root 建库/查 information_schema；eyeuser 供 Spring 数据源使用
  docker exec "$MYSQL_CID" mysql -uroot -proot-password \
    -e "GRANT ALL PRIVILEGES ON *.* TO 'eyeuser'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1

  # Spring 上下文测试要一个活着的 Chroma。:8000 上已经有（docker-compose 起的）就复用，
  # 没有才起一个——不重复占端口，也不去删别人起的服务。
  if curl -fsS --max-time 3 http://127.0.0.1:8000/api/v2/heartbeat >/dev/null 2>&1; then
    echo "    Chroma 已在 :8000 上运行，复用"
  else
    CHROMA_CID="eye-diagnosis-fast-chroma-$RUN_ID"
    docker run -d --name "$CHROMA_CID" -p 8000:8000 \
      -e IS_PERSISTENT=FALSE "${CHROMA_IMAGE:-ghcr.io/chroma-core/chroma:1.0.0}" >/dev/null || return 1
    local chroma_ready=0
    for _ in $(seq 1 60); do
      if curl -fsS --max-time 2 http://127.0.0.1:8000/api/v2/heartbeat >/dev/null 2>&1; then chroma_ready=1; break; fi
      sleep 1
    done
    [[ $chroma_ready -eq 1 ]] || { echo "Chroma 未就绪" >&2; return 1; }
  fi

  local url="jdbc:mysql://127.0.0.1:${mysql_port}"
  export SPRING_PROFILES_ACTIVE=ci
  export SPRING_DATASOURCE_URL="${url}/diagnosis_ci?serverTimezone=UTC"
  export SPRING_DATASOURCE_USERNAME=eyeuser
  export SPRING_DATASOURCE_PASSWORD=ci-password
  export SPRING_FLYWAY_SCHEMAS=diagnosis_ci
  export SPRING_DATA_REDIS_HOST=127.0.0.1
  export SPRING_DATA_REDIS_PORT="$redis_port"
  export FLYWAY_TEST_URL="${url}/diagnosis_ci?serverTimezone=UTC&allowPublicKeyRetrieval=true&useSSL=false"
  export FLYWAY_TEST_USERNAME=root
  export FLYWAY_TEST_PASSWORD=root-password
  export FLYWAY_TEST_SCHEMA=diagnosis_ci
  # SQL 侧 NOW(6) 与 JVM 侧 Timestamp 会进同一列比较，时区必须一致
  export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Duser.timezone=UTC"
  return 0
}

# ── Java 定向测试 ───────────────────────────────────────────────────────────
run_java() {
  local pattern
  pattern="$(IFS=,; echo "${JAVA_PATTERNS[*]}")"
  local started; started=$(date +%s)
  echo "--- Java 定向测试：$pattern ---"
  run_bounded "java:$pattern" "$LOG_DIR/java.log" \
    mvn $MVN_FLAGS test -Dtest="$pattern" -DfailIfNoTests=false \
      -Dsurefire.failIfNoSpecifiedTests=false "${EXTRA_MVN_ARGS[@]}"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    # 名字写错 / 整类 @Disabled / 陈旧 XML 都会让退出码为 0 而实际没跑
    # PYTHONIOENCODING：控制台是 GBK 时 Python 默认按 GBK 写管道，中文提示会花
    PYTHONIOENCODING=utf-8 python scripts/check_surefire_result.py --classes "$pattern" \
      --reports target/surefire-reports --since "$started" --log "$LOG_DIR/java.log" || rc=$?
  fi
  [[ $rc -ne 0 ]] && tail -25 "$LOG_DIR/java.log"
  record_stage "java" $rc
  return $rc
}

# ── Web 定向测试 ────────────────────────────────────────────────────────────
run_web() {
  local files
  files="$(IFS=' '; echo "${WEB_PATTERNS[*]}")"
  echo "--- Web 定向测试：$files ---"
  if [[ ! -x web/node_modules/.bin/vitest ]]; then
    echo "!!! web/node_modules 不存在：先在 web/ 下 npm ci（这一步不在本脚本里做，避免偷偷装依赖）"
    record_stage "web" 1; return 1
  fi
  run_bounded "web:$files" "$LOG_DIR/web.log" \
    bash -c "cd web && node_modules/.bin/vitest run $files"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    # vitest 对「没有测试文件」和「全被 skip」都可能返回 0：跳过不等于通过
    if grep -qE "No test files found" "$LOG_DIR/web.log"; then
      echo "!!! 指定的前端用例没有被执行（No test files found）"; rc=1
    elif grep -qE "^ *Tests +[0-9]* skipped" "$LOG_DIR/web.log" && ! grep -qE "^ *Tests +[1-9][0-9]* passed" "$LOG_DIR/web.log"; then
      echo "!!! 前端用例全部被跳过：跳过不等于通过"; rc=1
    fi
  fi
  [[ $rc -ne 0 ]] && tail -25 "$LOG_DIR/web.log"
  record_stage "web" $rc
  return $rc
}

# ── 主流程 ──────────────────────────────────────────────────────────────────
trap cleanup_db EXIT INT TERM

case "$LEVEL" in
  L0)
    run_static; record_stage "static" $?
    ;;
  L3)
    echo "==> L3：交给 scripts/verify.sh（发布级全量，不在本脚本里重写）"
    bash scripts/verify.sh "${EXTRA_MVN_ARGS[@]}"
    record_stage "verify.sh" $?
    ;;
  L1|L2)
    if [[ ${#JAVA_PATTERNS[@]} -eq 0 && ${#WEB_PATTERNS[@]} -eq 0 ]]; then
      echo "L1/L2 需要 --java 或 --web：显式说明这次改动影响了哪些用例。" >&2
      echo "不知道该跑什么 → docs/testing/verification-levels.md 的影响映射表；" >&2
      echo "确实需要全量 → --level L3。" >&2
      exit 2
    fi
    if [[ $WITH_STATIC -eq 1 ]]; then run_static; record_stage "static" $?; fi
    if [[ $NEED_DB -eq 1 ]]; then
      start_db || { echo "!!! 数据库环境没起来" >&2; echo "RESULT: FAIL — 环境准备失败（不是测试失败）"; exit 1; }
    fi
    [[ ${#JAVA_PATTERNS[@]} -gt 0 ]] && run_java
    [[ ${#WEB_PATTERNS[@]} -gt 0 ]] && run_web
    ;;
esac

echo
echo "------------------------------------------------------------"
echo "level=$LEVEL sha=$CODE_SHA tree=$DIRTY_LABEL logs=$LOG_DIR"
if [[ ${#FAILED_STAGES[@]} -gt 0 ]]; then
  if [[ $TIMED_OUT -eq 1 ]]; then
    echo "RESULT: TIMEOUT — 未通过：${FAILED_STAGES[*]}"
    echo "（超时的阶段没有被证明过，不能当通过）"
    exit 124
  fi
  echo "RESULT: FAIL — 未通过：${FAILED_STAGES[*]}"
  exit 1
fi
echo "RESULT: PASS — $LEVEL"
echo "下一步：跨模块 / 权限 / 迁移 / 证据类改动 → L2（--db）；准备合并 → L3（scripts/verify.sh）"
exit 0
