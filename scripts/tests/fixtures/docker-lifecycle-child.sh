#!/usr/bin/env bash
# Child fixture for scripts/tests/test-docker-lifecycle.sh.
# Starts one labeled container + named volume, then exits in a mode chosen by
# the caller so the parent can prove teardown survives every exit path.
#
# Usage: child.sh <run-id> success|fail|sleep
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

# shellcheck source=scripts/lib/docker-images.env
. "$ROOT/scripts/lib/docker-images.env"
# shellcheck source=scripts/lib/docker-test-harness.sh
. "$ROOT/scripts/lib/docker-test-harness.sh"

EYE_DOCKER_RUN_ID="${1:?run id required}"
MODE="${2:?mode required}"
EYE_DOCKER_KIND=test
eye_docker_init
eye_docker_trap_teardown

eye_docker_require
eye_docker_require_image "$EYE_TEST_IMAGE"

vol="$(eye_docker_volume_name data)"
eye_docker_volume_create "$vol"
name="$(eye_docker_container_name svc)"
eye_docker_run_named "$name" -d \
  --mount "type=volume,src=${vol},dst=/data" \
  "$EYE_TEST_IMAGE" sleep 60 >/dev/null

case "$MODE" in
  success) sleep 0.2 ;;
  fail) echo "intentional failure for lifecycle test" >&2; exit 7 ;;
  sleep) sleep 60 ;;
  *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac
