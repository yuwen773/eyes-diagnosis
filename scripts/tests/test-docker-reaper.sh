#!/usr/bin/env bash
# Safety acceptance for scripts/docker-test-resources.sh --apply-safe.
#
# Builds a miniature host state:
#   * stopped container owned by us         -> must be removed
#   * named volume held by that container   -> must be removed in the same pass
#   * unheld named volume owned by us       -> must be removed
#   * running container owned by us         -> must survive
#   * running container of another project  -> must survive
#   * STOPPED eye-diagnosis dev service      -> must survive (compose project /
#     eye.protected 标签把它挡在 owner 分支之前；2026-11-21 的 P0：曾经会删)
#
# If any survivor is deleted, the reaper is unsafe and this test fails.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RESOURCES="$ROOT/scripts/docker-test-resources.sh"
# shellcheck source=scripts/lib/docker-images.env
. "$ROOT/scripts/lib/docker-images.env"
# Reuse the harness's MSYS docker() wrapper so `--mount ... dst=/data` is not
# rewritten to a Windows path before Docker sees it.
# shellcheck source=scripts/lib/docker-test-harness.sh
. "$ROOT/scripts/lib/docker-test-harness.sh"

SUITE="reaper-$(date -u +%Y%m%dT%H%M%SZ | tr '[:upper:]' '[:lower:]')-$$"
SUITE="$(printf '%s' "$SUITE" | sed -E 's/[^a-z0-9-]+/-/g')"
STOPPED="$SUITE-stopped"
RUNNING="$SUITE-running"
OTHER="$SUITE-other"
STOPPED_VOL="$SUITE-stopped-vol"
UNHELD_VOL="$SUITE-unheld-vol"
DEV="$SUITE-devservice"
DEV_VOL="$SUITE-devservice-vol"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }

cleanup() {
  docker rm -f -v "$STOPPED" "$RUNNING" "$OTHER" "$DEV" >/dev/null 2>&1 || true
  docker volume rm -f "$STOPPED_VOL" "$UNHELD_VOL" "$DEV_VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null || { echo "docker required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon unreachable" >&2; exit 1; }
docker image inspect "$EYE_TEST_IMAGE" >/dev/null 2>&1 || docker pull "$EYE_TEST_IMAGE" >/dev/null

echo "== reaper safety suite $SUITE (image ${EYE_TEST_IMAGE}) =="
cleanup

docker volume create --label "eye.owner=eye-diagnosis" --label "eye.run-id=$SUITE" "$STOPPED_VOL" >/dev/null
docker volume create --label "eye.owner=eye-diagnosis" --label "eye.run-id=$SUITE" "$UNHELD_VOL" >/dev/null

# Stopped, owned, holds a named volume.
docker run -d --name "$STOPPED" \
  --label "eye.owner=eye-diagnosis" --label "eye.run-id=$SUITE" \
  --mount "type=volume,src=${STOPPED_VOL},dst=/data" \
  "$EYE_TEST_IMAGE" true >/dev/null
sleep 1

# Stopped eye-diagnosis dev service (compose project + eye.protected) -> must survive.
# This is the exact shape docker-compose.yml produces; before 2026-11-21 the owner
# branch matched first and both the container and its volume landed in the SAFE set.
docker volume create   --label "eye.owner=eye-diagnosis" --label "eye.run-id=$SUITE"   --label "eye.kind=dev-service" --label "eye.protected=true"   --label "com.docker.compose.project=eye-diagnosis" "$DEV_VOL" >/dev/null
docker create --name "$DEV"   --label "eye.owner=eye-diagnosis" --label "eye.run-id=$SUITE"   --label "eye.kind=dev-service" --label "eye.protected=true"   --label "com.docker.compose.project=eye-diagnosis"   --mount "type=volume,src=${DEV_VOL},dst=/data"   "$EYE_TEST_IMAGE" true >/dev/null

# Running, owned -> ACTIVE_OWNED, must survive.
docker run -d --name "$RUNNING" \
  --label "eye.owner=eye-diagnosis" --label "eye.run-id=$SUITE" \
  "$EYE_TEST_IMAGE" sleep 60 >/dev/null

# Running, other project -> must survive.
docker run -d --name "$OTHER" \
  --label "eye.owner=other-project" --label "eye.run-id=$SUITE" \
  "$EYE_TEST_IMAGE" sleep 60 >/dev/null

bash "$RESOURCES" --apply-safe --run-id "$SUITE" >/tmp/reaper-apply.log 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then pass "apply-safe exited 0"; else fail "apply-safe exited $rc"; cat /tmp/reaper-apply.log >&2; fi

exists_container() { docker inspect "$1" >/dev/null 2>&1; }
exists_volume() { docker volume inspect "$1" >/dev/null 2>&1; }

if exists_container "$STOPPED"; then fail "stopped owned container survived"; else pass "stopped owned container removed"; fi
if exists_volume "$STOPPED_VOL"; then fail "volume of stopped container survived"; else pass "volume of stopped container removed"; fi
if exists_volume "$UNHELD_VOL"; then fail "unheld owned volume survived"; else pass "unheld owned volume removed"; fi

if exists_container "$RUNNING" && [ "$(docker inspect -f '{{.State.Running}}' "$RUNNING")" = "true" ]; then
  pass "running owned container survived"
else
  fail "running owned container was removed or stopped"
fi
if exists_container "$OTHER" && [ "$(docker inspect -f '{{.State.Running}}' "$OTHER")" = "true" ]; then
  pass "other-project container survived"
else
  fail "other-project container was removed or stopped"
fi

if exists_container "$DEV"; then pass "protected dev-service container survived"; else fail "protected dev-service container was removed"; fi
if exists_volume "$DEV_VOL"; then pass "protected dev-service volume survived"; else fail "protected dev-service volume was removed"; fi

# No prune may appear in the apply log.
if grep -qE 'docker (system|volume|container|image|network) prune' /tmp/reaper-apply.log; then
  fail "apply log contains a global prune"
else
  pass "apply path used no global prune"
fi

cleanup
echo
echo "== reaper safety result: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ]
