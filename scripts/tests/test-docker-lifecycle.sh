#!/usr/bin/env bash
# Docker test resource lifecycle acceptance.
#
# Proves, on every exit path, that a test run leaves no containers, volumes, or
# networks behind — and that it never touches another project's resources.
#
#   success      normal exit
#   failure      non-zero exit after startup
#   timeout      SIGTERM from `timeout`
#   interrupt    SIGINT (Ctrl-C equivalent)
#   concurrent   three runs in parallel + an unrelated sentinel container
#   repeated     three sequential runs; label namespace returns to baseline
#
# This test uses `busybox` by default (fast). Set EYE_TEST_FULL=1 to add a
# real mysql:8.0.36 case (the image that declares VOLUME /var/lib/mysql).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHILD="$HERE/fixtures/docker-lifecycle-child.sh"
RESOURCES="$ROOT/scripts/docker-test-resources.sh"
# shellcheck source=scripts/lib/docker-images.env
. "$ROOT/scripts/lib/docker-images.env"

SUITE="lc-$(date -u +%Y%m%dT%H%M%SZ | tr '[:upper:]' '[:lower:]')-$$"
SUITE="$(printf '%s' "$SUITE" | sed -E 's/[^a-z0-9-]+/-/g')"
SENTINEL="$SUITE-sentinel"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }

cleanup_sentinel() {
  docker rm -f -v "$SENTINEL" >/dev/null 2>&1 || true
}
trap cleanup_sentinel EXIT INT TERM

assert_clean() {
  local rid="$1"
  if bash "$RESOURCES" --assert-clean --run-id "$rid" >/dev/null 2>&1; then
    pass "no leftover resources for $rid"
  else
    fail "leftover resources for $rid"
    bash "$RESOURCES" --assert-clean --run-id "$rid" >&2 || true
  fi
}

suite_resources() {
  # Count resources whose run-id starts with this suite's unique prefix.
  {
    docker ps -a --format '{{.Label "eye.run-id"}}' 2>/dev/null
    docker volume ls --format '{{.Label "eye.run-id"}}' 2>/dev/null
    docker network ls --format '{{.Label "eye.run-id"}}' 2>/dev/null
  } | grep -c "^${SUITE}" 2>/dev/null || true
}

command -v docker >/dev/null || { echo "docker required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon unreachable" >&2; exit 1; }
command -v timeout >/dev/null || { echo "coreutils timeout required" >&2; exit 1; }

echo "== lifecycle suite $SUITE (image ${EYE_TEST_IMAGE}) =="

# ---- 1. success ----------------------------------------------------------
rid="$SUITE-success"
if bash "$CHILD" "$rid" success; then pass "success path exited 0"; else fail "success path exited non-zero"; fi
assert_clean "$rid"

# ---- 2. failure ----------------------------------------------------------
rid="$SUITE-fail"
set +e
bash "$CHILD" "$rid" fail >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -eq 7 ]; then pass "failure path preserved exit code 7"; else fail "failure path exit code was $rc, expected 7"; fi
assert_clean "$rid"

# ---- 3. timeout (SIGTERM) ------------------------------------------------
rid="$SUITE-timeout"
set +e
timeout 2 bash "$CHILD" "$rid" sleep >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then pass "timeout path killed the run (rc=$rc)"; else fail "timeout path unexpectedly exited 0"; fi
assert_clean "$rid"

# ---- 4. interrupt (SIGINT, escalating to SIGTERM on platforms that defer it)
# Git Bash/MSYS defers a SIGINT trap until the foreground `sleep` returns; a
# real operator pressing Ctrl-C twice (or a supervisor escalating) is the
# realistic path there. The contract under test is: interrupt -> process exits,
# teardown runs, zero leftovers. On Linux the first SIGINT is enough.
rid="$SUITE-int"
bash "$CHILD" "$rid" sleep >/dev/null 2>&1 &
child_pid=$!
sleep 1
kill -INT "$child_pid" 2>/dev/null || true
for _ in $(seq 1 30); do
  kill -0 "$child_pid" 2>/dev/null || break
  sleep 0.1
done
escalated=0
if kill -0 "$child_pid" 2>/dev/null; then
  escalated=1
  kill -TERM "$child_pid" 2>/dev/null || true
fi
set +e
wait "$child_pid"
rc=$?
set -e
if kill -0 "$child_pid" 2>/dev/null; then
  fail "interrupt path left the child process running"
  kill -KILL "$child_pid" 2>/dev/null || true
else
  pass "interrupt path terminated the run (rc=$rc, escalated=$escalated)"
fi
assert_clean "$rid"

# ---- 5. concurrent runs + unrelated sentinel -----------------------------
docker rm -f -v "$SENTINEL" >/dev/null 2>&1 || true
docker run -d --name "$SENTINEL" \
  --label "eye.owner=other-project" \
  --label "eye.test.sentinel=1" \
  "$EYE_TEST_IMAGE" sleep 60 >/dev/null
declare -a pids=()
for i in 1 2 3; do
  bash "$CHILD" "$SUITE-conc-$i" success >/dev/null 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
for i in 1 2 3; do assert_clean "$SUITE-conc-$i"; done
if [ "$(docker inspect -f '{{.State.Running}}' "$SENTINEL" 2>/dev/null)" = "true" ]; then
  pass "unrelated sentinel survived concurrent runs"
else
  fail "concurrent teardown touched an unrelated container"
fi
cleanup_sentinel

# ---- 6. repeated runs return to baseline ---------------------------------
before="$(suite_resources)"
for i in 1 2 3; do
  rid="$SUITE-rep-$i"
  bash "$CHILD" "$rid" success >/dev/null 2>&1 || fail "repeat run $i failed"
  assert_clean "$rid"
done
after="$(suite_resources)"
if [ "$after" -le "$before" ]; then
  pass "repeated runs left no new suite resources (before=$before after=$after)"
else
  fail "repeated runs increased suite resources (before=$before after=$after)"
fi

# ---- 7. optional real MySQL image (VOLUME /var/lib/mysql) ----------------
if [ "${EYE_TEST_FULL:-0}" = 1 ]; then
  rid="$SUITE-full"
  docker rm -f -v "$rid" >/dev/null 2>&1 || true
  (
    set -euo pipefail
    # shellcheck source=scripts/lib/docker-test-harness.sh
    . "$ROOT/scripts/lib/docker-test-harness.sh"
    EYE_DOCKER_RUN_ID="$rid"; export EYE_DOCKER_RUN_ID
    EYE_DOCKER_KIND=test
    eye_docker_init
    eye_docker_trap_teardown
    eye_docker_require_image "$MYSQL_IMAGE"
    vol="$(eye_docker_volume_name mysql-data)"
    eye_docker_volume_create "$vol"
    name="$(eye_docker_container_name mysql)"
    eye_docker_run_named "$name" -d \
      --mount "type=volume,src=${vol},dst=/var/lib/mysql" \
      "$MYSQL_IMAGE" sleep 60 >/dev/null
    sleep 0.5
  ) || fail "real mysql run failed"
  assert_clean "$rid"
fi

echo
echo "== lifecycle suite result: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ]
