#!/usr/bin/env bash
# Static contract checks for Docker test resources.
#
# These are deliberately cheap grep assertions: they catch the exact regressions
# that caused the 40GB anonymous-volume pile-up — image-tag drift between local
# and CI, dropping the `-v` from teardown, and re-introducing a global prune.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=scripts/lib/docker-images.env
. "$ROOT/scripts/lib/docker-images.env"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }

check_eq() {
  local label="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then pass "$label = $want"; else fail "$label: expected '$want', got '$got'"; fi
}

check_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -qF -- "$needle" "$file"; then pass "$label"; else fail "$label (missing '$needle' in ${file#"$ROOT"/})"; fi
}

CI="$ROOT/.github/workflows/verify.yml"
COMPOSE="$ROOT/docker-compose.yml"
VERIFY="$ROOT/scripts/verify.sh"
HARNESS="$ROOT/scripts/lib/docker-test-harness.sh"

ci_images() {
  local svc="$1"
  grep -E "^[[:space:]]+image: ${svc}" "$CI" | sed -E 's/.*image:[[:space:]]*//' | tr -d '\r' | sort -u
}

# ---- image pins -----------------------------------------------------------
mysql_ci="$(ci_images 'mysql:' | tr '\n' ' ' | sed 's/ $//')"
redis_ci="$(ci_images 'redis:' | tr '\n' ' ' | sed 's/ $//')"
chroma_ci="$(ci_images 'ghcr.io/chroma-core/chroma:' | tr '\n' ' ' | sed 's/ $//')"

check_eq "CI mysql image(s)" "$MYSQL_IMAGE" "$mysql_ci"
check_eq "CI redis image(s)" "$REDIS_IMAGE" "$redis_ci"
check_eq "CI chroma image" "$CHROMA_IMAGE" "$chroma_ci"

compose_chroma="$(grep -E '^[[:space:]]+image:' "$COMPOSE" | sed -E 's/.*image:[[:space:]]*//' | tr -d '\r' | sort -u | tr '\n' ' ' | sed 's/ $//')"
check_eq "compose chroma image" "$CHROMA_IMAGE" "$compose_chroma"

# ---- local entry points use the harness ----------------------------------
check_contains "verify.sh sources the harness" "scripts/lib/docker-test-harness.sh" "$VERIFY"
check_contains "verify.sh initializes a run id" "eye_docker_init" "$VERIFY"
check_contains "verify.sh installs teardown traps" "eye_docker_trap_teardown" "$VERIFY"
check_contains "verify.sh asserts cleanliness" "eye_docker_assert_clean" "$VERIFY"

# ---- CI actually runs the resource gates --------------------------------
check_contains "CI runs the lifecycle gate" "test-docker-lifecycle.sh" "$CI"
check_contains "CI runs the reaper safety gate" "test-docker-reaper.sh" "$CI"
check_contains "reaper exposes assert-clean" "--assert-clean" "$ROOT/scripts/docker-test-resources.sh"

# ---- teardown removes anonymous volumes ----------------------------------
check_contains "harness removes containers with -v" "docker rm -f -v" "$HARNESS"

# ---- compose dev service is explicitly protected -------------------------
check_contains "compose pins pull_policy: missing" "pull_policy: missing" "$COMPOSE"
check_contains "compose declares project name" "name: eye-diagnosis" "$COMPOSE"
check_contains "compose labels owner" "eye.owner" "$COMPOSE"
check_contains "compose labels protection" "eye.protected" "$COMPOSE"

# ---- no global prune anywhere in runnable files --------------------------
prune_hits="$(
  grep -rnE 'docker (system|volume|container|image|network) prune' \
    "$ROOT/scripts" "$ROOT/.github" \
    --include='*.sh' --include='*.yml' --include='*.yaml' 2>/dev/null \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true
)"
if [ -z "$prune_hits" ]; then
  pass "no global docker prune in scripts/ or .github/"
else
  fail "global docker prune found:"
  echo "$prune_hits" >&2
fi

echo
echo "== static contract result: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ]
