# shellcheck shell=bash
# Docker test resource lifecycle harness.
#
# Source this file from any test entry point:
#
#   . "$ROOT/scripts/lib/docker-test-harness.sh"
#   eye_docker_init                       # generates EYE_DOCKER_RUN_ID + labels
#   eye_docker_trap_teardown              # EXIT/INT/TERM/HUP -> teardown + assert_clean
#
# Contract:
#   * Every container / volume / network this run creates carries three labels:
#       eye.owner=<namespace>   (default eye-diagnosis)
#       eye.run-id=<unique run> (one per test invocation)
#       eye.kind=test|evidence  (test resources are disposable)
#   * `eye_docker_teardown` removes ONLY resources carrying this run's run-id.
#     It never calls `docker prune`, never touches other owners, running
#     containers, the dev compose project, or unlabeled legacy resources.
#   * `eye_docker_assert_clean` turns "no leftover resources" into an explicit
#     exit condition, so a green test suite cannot stand in for resource
#     reclamation.
#
# Environment knobs:
#   EYE_DOCKER_OWNER      default eye-diagnosis
#   EYE_DOCKER_KIND       default test
#   EYE_DOCKER_RUN_ID     default <kind>-<utc>-<sha>-<pid>-<rand>
#   EYE_DOCKER_STATE_DIR  default <repo>/.tmp-docker-runs (gitignored)
#   EYE_DOCKER_PULL       missing|never|always (default missing)
#   EYE_DOCKER_KEEP       1 = keep resources for post-mortem (reaper can list)
#
# The functions are intentionally plain bash (no jq / python) so they run on
# Git Bash and GitHub's ubuntu-latest alike.

if [ -n "${EYE_DOCKER_HARNESS_LOADED:-}" ]; then
  return 0
fi
EYE_DOCKER_HARNESS_LOADED=1

# Git Bash / MSYS rewrites arguments that look like Unix paths (/data,
# /var/lib/mysql) into Windows paths before docker sees them. Container mount
# destinations must stay POSIX-absolute. Scope the workaround to docker calls
# ONLY (a global export also breaks the Maven launcher, whose classpath is an
# MSYS path that must be converted).
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    docker() {
      MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' command docker "$@"
    }
    ;;
esac

EYE_DOCKER_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EYE_DOCKER_REPO_ROOT="$(cd "$EYE_DOCKER_LIB_DIR/../.." && pwd)"

eye_docker__sanitize() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9.-]+/-/g; s/^-+//; s/-+$//'
}

eye_docker_require() {
  # `type -P` searches PATH and ignores the docker() wrapper function above.
  type -P docker >/dev/null 2>&1 || {
    echo "docker is required for this test entry point" >&2
    return 1
  }
  docker info >/dev/null 2>&1 || {
    echo "docker daemon is not reachable" >&2
    return 1
  }
}

# eye_docker_init must be called directly (not via command substitution):
# it sets globals used by every other function.
eye_docker_init() {
  : "${EYE_DOCKER_OWNER:=eye-diagnosis}"
  : "${EYE_DOCKER_KIND:=test}"
  : "${EYE_DOCKER_PULL:=missing}"
  : "${EYE_DOCKER_KEEP:=0}"
  : "${EYE_DOCKER_STATE_DIR:=$EYE_DOCKER_REPO_ROOT/.tmp-docker-runs}"

  if [ -z "${EYE_DOCKER_RUN_ID:-}" ]; then
    local sha ts rnd
    sha="$(cd "$EYE_DOCKER_REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo nogit)"
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    rnd="$(printf '%04x' $((RANDOM % 65536)))"
    EYE_DOCKER_RUN_ID="${EYE_DOCKER_KIND}-${ts}-${sha}-$$-${rnd}"
  fi

  EYE_DOCKER_RUN_ID="$(eye_docker__sanitize "$EYE_DOCKER_RUN_ID")"
  EYE_DOCKER_OWNER="$(eye_docker__sanitize "$EYE_DOCKER_OWNER")"
  EYE_DOCKER_KIND="$(eye_docker__sanitize "$EYE_DOCKER_KIND")"

  export EYE_DOCKER_OWNER EYE_DOCKER_KIND EYE_DOCKER_RUN_ID
  export EYE_DOCKER_PULL EYE_DOCKER_KEEP EYE_DOCKER_STATE_DIR

  mkdir -p "$EYE_DOCKER_STATE_DIR"
  EYE_DOCKER_REGISTRY="$EYE_DOCKER_STATE_DIR/$EYE_DOCKER_RUN_ID.resources"
  : > "$EYE_DOCKER_REGISTRY"
  EYE_DOCKER_TEARDOWN_DONE=0

  EYE_DOCKER_LABEL_ARGS=(
    --label "eye.owner=$EYE_DOCKER_OWNER"
    --label "eye.run-id=$EYE_DOCKER_RUN_ID"
    --label "eye.kind=$EYE_DOCKER_KIND"
    --label "eye.created-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  )
}

eye_docker_container_name() {
  printf 'eye-%s-%s\n' "$EYE_DOCKER_RUN_ID" "$(eye_docker__sanitize "${1:?role required}")"
}

eye_docker_volume_name() {
  printf 'eye-vol-%s-%s\n' "$EYE_DOCKER_RUN_ID" "$(eye_docker__sanitize "${1:?suffix required}")"
}

eye_docker_register() {
  printf '%s\t%s\n' "${1:?type}" "${2:?name}" >> "$EYE_DOCKER_REGISTRY"
}

eye_docker_volume_create() {
  local vol="${1:?volume name required}"
  docker volume create "${EYE_DOCKER_LABEL_ARGS[@]}" --label "eye.role=volume" "$vol" >/dev/null
  eye_docker_register volume "$vol"
}

# Run a container with the run labels and a fixed pull policy. Callers pass the
# normal `docker run` flags (including -d / --name / image / command).
eye_docker_run_named() {
  local name="${1:?container name required}"
  shift
  docker run --pull="$EYE_DOCKER_PULL" --name "$name" "${EYE_DOCKER_LABEL_ARGS[@]}" "$@"
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    eye_docker_register container "$name"
  fi
  return "$rc"
}

# Wait until a probe command succeeds. Usage:
#   eye_docker_wait_ready 90 docker exec "$cid" mysqladmin ping -h127.0.0.1 ...
eye_docker_wait_ready() {
  local tries="${1:?tries required}"
  shift
  local i
  for ((i = 0; i < tries; i++)); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Print the host port mapped to a container port (first mapping).
eye_docker_host_port() {
  local name="${1:?container name required}"
  local cport="${2:?container port required}"
  docker port "$name" "$cport" 2>/dev/null | head -n 1 | awk -F: '{print $NF}'
}

eye_docker_require_image() {
  local img="${1:?image required}"
  if docker image inspect "$img" >/dev/null 2>&1; then
    return 0
  fi
  case "${EYE_DOCKER_PULL:-missing}" in
    never)
      echo "image $img is not present locally and EYE_DOCKER_PULL=never" >&2
      return 1
      ;;
    *)
      echo "image $img not present locally; pulling once" >&2
      docker pull "$img" >/dev/null
      ;;
  esac
}

# Remove ONLY this run's resources. Idempotent; safe to call from EXIT and
# signal traps. Never calls prune and never filters by image/name globs.
eye_docker_teardown() {
  if [ "${EYE_DOCKER_TEARDOWN_DONE:-0}" = 1 ]; then
    return 0
  fi
  if [ "${EYE_DOCKER_KEEP:-0}" = 1 ]; then
    EYE_DOCKER_TEARDOWN_DONE=1
    echo "EYE_DOCKER_KEEP=1: kept resources for run $EYE_DOCKER_RUN_ID" >&2
    echo "  inspect/reap: $EYE_DOCKER_REPO_ROOT/scripts/docker-test-resources.sh --run-id $EYE_DOCKER_RUN_ID" >&2
    return 0
  fi
  EYE_DOCKER_TEARDOWN_DONE=1

  local id
  # Containers first. -v removes anonymous volumes attached to them; named
  # volumes are removed explicitly below.
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    docker rm -f -v "$id" >/dev/null 2>&1 || true
  done < <(docker ps -aq --filter "label=eye.run-id=$EYE_DOCKER_RUN_ID" 2>/dev/null || true)

  while IFS= read -r id; do
    [ -n "$id" ] || continue
    docker volume rm -f "$id" >/dev/null 2>&1 || true
  done < <(docker volume ls -q --filter "label=eye.run-id=$EYE_DOCKER_RUN_ID" 2>/dev/null || true)

  while IFS= read -r id; do
    [ -n "$id" ] || continue
    docker network rm "$id" >/dev/null 2>&1 || true
  done < <(docker network ls -q --filter "label=eye.run-id=$EYE_DOCKER_RUN_ID" 2>/dev/null || true)

  # Registry fallback: covers the (rare) case where a label write was lost.
  if [ -f "${EYE_DOCKER_REGISTRY:-}" ]; then
    local type name
    while IFS=$'\t' read -r type name; do
      [ -n "${name:-}" ] || continue
      case "$type" in
        container) docker rm -f -v "$name" >/dev/null 2>&1 || true ;;
        volume) docker volume rm -f "$name" >/dev/null 2>&1 || true ;;
        network) docker network rm "$name" >/dev/null 2>&1 || true ;;
      esac
    done < "$EYE_DOCKER_REGISTRY"
    rm -f "$EYE_DOCKER_REGISTRY"
  fi
  return 0
}

# Teardown AND the cleanliness assertion run on every exit path, not just the
# green one: a run that dies mid-maven must not be able to leak quietly. Set
# EYE_DOCKER_CLEAN=1 after calling eye_docker_assert_clean yourself to avoid a
# duplicate assertion; EYE_DOCKER_KEEP=1 skips it entirely.
eye_docker__on_exit() {
  local rc=$?
  eye_docker_teardown
  if [ "${EYE_DOCKER_KEEP:-0}" != 1 ] && [ "${EYE_DOCKER_CLEAN:-0}" != 1 ]; then
    eye_docker_assert_clean || rc=1
  fi
  exit "$rc"
}

eye_docker_trap_teardown() {
  trap 'eye_docker__on_exit' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

# Exit non-zero if any container/volume/network still carries this run-id.
eye_docker_assert_clean() {
  local run_id="${1:-${EYE_DOCKER_RUN_ID:-}}"
  [ -n "$run_id" ] || {
    echo "assert_clean: empty run id" >&2
    return 2
  }
  local c v n
  c="$(docker ps -aq --filter "label=eye.run-id=$run_id" 2>/dev/null | wc -l | tr -d ' ')"
  v="$(docker volume ls -q --filter "label=eye.run-id=$run_id" 2>/dev/null | wc -l | tr -d ' ')"
  n="$(docker network ls -q --filter "label=eye.run-id=$run_id" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$c" = 0 ] && [ "$v" = 0 ] && [ "$n" = 0 ]; then
    echo "clean: run $run_id has no leftover containers/volumes/networks"
    return 0
  fi
  echo "LEAK: run $run_id containers=$c volumes=$v networks=$n" >&2
  docker ps -a --filter "label=eye.run-id=$run_id" --format '  container {{.ID}} {{.Names}} {{.Status}}' >&2 || true
  docker volume ls --filter "label=eye.run-id=$run_id" --format '  volume {{.Name}}' >&2 || true
  docker network ls --filter "label=eye.run-id=$run_id" --format '  network {{.Name}}' >&2 || true
  return 1
}
