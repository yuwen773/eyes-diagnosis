#!/usr/bin/env bash
# Docker test resource inventory + safe reaper.
#
# Default is a DRY RUN report: it lists resources, classifies them, and prints
# the exact commands that WOULD run. Nothing is deleted without --apply-safe.
#
# Hard safety rules (enforced here, not just documented):
#   * NEVER runs `docker system|volume|container|image|network prune`.
#   * NEVER deletes a running container.
#   * NEVER deletes resources owned by another project / compose project.
#   * NEVER deletes the eye-diagnosis dev service or its persistent volume.
#   * NEVER guesses ownership for unlabeled legacy resources: they are REPORTED
#     for human review, not auto-deleted.
#   * --apply-safe only removes resources carrying eye.owner=<OWNER> that are
#     stopped/unheld, re-checking state immediately before each deletion.
#
# Usage:
#   scripts/docker-test-resources.sh                 # dry-run report
#   scripts/docker-test-resources.sh --json          # machine-readable counts
#   scripts/docker-test-resources.sh --run-id ID     # focus one test run
#   scripts/docker-test-resources.sh --assert-clean --run-id ID
#   scripts/docker-test-resources.sh --apply-safe    # delete SAFE set only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${EYE_DOCKER_OWNER:-eye-diagnosis}"
MODE="report"
APPLY_SAFE=0
JSON=0
RUN_ID_FILTER=""

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply-safe) APPLY_SAFE=1 ;;
    --json) JSON=1 ;;
    --run-id) RUN_ID_FILTER="${2:?--run-id needs a value}"; shift ;;
    --assert-clean) MODE="assert" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

# ------------------------------------------------------------ assert-clean ---
# Fast path: answer from three label filters only. Do NOT build the full
# inventory (docker system df -v is expensive) for a cleanliness assertion.
if [ "$MODE" = "assert" ]; then
  [ -n "$RUN_ID_FILTER" ] || { echo "--assert-clean requires --run-id" >&2; exit 2; }
  c=$(docker ps -aq --filter "label=eye.run-id=$RUN_ID_FILTER" 2>/dev/null | wc -l | tr -d ' ')
  v=$(docker volume ls -q --filter "label=eye.run-id=$RUN_ID_FILTER" 2>/dev/null | wc -l | tr -d ' ')
  n=$(docker network ls -q --filter "label=eye.run-id=$RUN_ID_FILTER" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$c" = 0 ] && [ "$v" = 0 ] && [ "$n" = 0 ]; then
    echo "clean: run $RUN_ID_FILTER has no leftover resources"
    exit 0
  fi
  echo "LEAK: run $RUN_ID_FILTER containers=$c volumes=$v networks=$n" >&2
  exit 2
fi

# ---------------------------------------------------------------- snapshot ---
ctr_tsv="$(docker ps -a --format '{{.ID}}|{{.Names}}|{{.State}}|{{.Image}}|{{.Label "eye.owner"}}|{{.Label "eye.run-id"}}|{{.Label "eye.kind"}}|{{.Label "eye.protected"}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null || true)"

declare -A CTR_STATE CTR_IMAGE CTR_OWNER CTR_RUNID CTR_KIND CTR_PROT CTR_COMPOSE CTR_ID
declare -A CTR_MOUNTS
while IFS='|' read -r cid name state image owner runid kind prot compose; do
  [ -n "${name:-}" ] || continue
  CTR_ID["$name"]="$cid"
  CTR_STATE["$name"]="$state"
  CTR_IMAGE["$name"]="$image"
  CTR_OWNER["$name"]="$owner"
  CTR_RUNID["$name"]="$runid"
  CTR_KIND["$name"]="$kind"
  CTR_PROT["$name"]="$prot"
  CTR_COMPOSE["$name"]="$compose"
done <<< "$ctr_tsv"

mounts_tsv="$(docker inspect --format '{{.Name}}|{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}},{{end}}{{end}}' $(docker ps -aq) 2>/dev/null || true)"
while IFS='|' read -r n mounts; do
  [ -n "${n:-}" ] || continue
  CTR_MOUNTS["${n#/}"]="$mounts"
done <<< "$mounts_tsv"

vol_names="$(docker volume ls -q 2>/dev/null || true)"
vol_tsv=""
if [ -n "$vol_names" ]; then
  # shellcheck disable=SC2086
  vol_tsv="$(docker volume inspect --format '{{.Name}}|{{.CreatedAt}}|{{index .Labels "eye.owner"}}|{{index .Labels "eye.run-id"}}|{{index .Labels "eye.kind"}}|{{index .Labels "eye.protected"}}|{{index .Labels "com.docker.compose.project"}}' $vol_names 2>/dev/null || true)"
fi

# volume sizes: NAME|SIZE (LAST column of the Local Volumes section)
vol_sizes="$(docker system df -v 2>/dev/null | awk '
  /Local Volumes space usage/ {f=1; next}
  /Build cache usage/ {f=0}
  f && NF>=3 && $1!="VOLUME" {print $1"|"$NF}
' || true)"
declare -A VOL_SIZE
while IFS='|' read -r n sz; do
  [ -n "${n:-}" ] && VOL_SIZE["$n"]="$sz"
done <<< "$vol_sizes"

net_tsv="$(docker network ls --format '{{.ID}}|{{.Name}}|{{.Label "eye.owner"}}|{{.Label "eye.run-id"}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null || true)"
dangling_nets="$(docker network ls --filter dangling=true --format '{{.Name}}' 2>/dev/null || true)"

img_tsv="$(docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedSince}}' 2>/dev/null || true)"

# ------------------------------------------------------------- classifiers ---
is_anon_volume() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }

volume_holders() {
  local vol="$1" out="" c
  for c in "${!CTR_MOUNTS[@]}"; do
    case ",${CTR_MOUNTS[$c]}" in
      *",$vol,"*) out+="$c(${CTR_STATE[$c]}) " ;;
    esac
  done
  printf '%s' "${out% }"
}

classify_container() {
  local name="$1"
  # 保护必须判在归属之前：compose 开发服务自己也带 eye.owner=eye-diagnosis
  # （见 docker-compose.yml），先判 owner 会让「已停止的 dev 容器」落进
  # SAFE_STOPPED，被 --apply-safe 删掉。
  if [ "${CTR_PROT[$name]}" = "true" ] ||
     [ "${CTR_KIND[$name]}" = "dev-service" ] ||
     [ "${CTR_COMPOSE[$name]}" = "eye-diagnosis" ]; then
    echo "PROTECTED_DEV"
  elif [ "${CTR_OWNER[$name]}" = "$OWNER" ]; then
    if [ "${CTR_STATE[$name]}" = "running" ]; then echo "ACTIVE_OWNED"; else echo "SAFE_STOPPED"; fi
  elif [ "${CTR_COMPOSE[$name]}" = "ai-interview" ] || [ "${CTR_COMPOSE[$name]}" = "oncall-agent" ]; then
    echo "OTHER_PROJECT"
  elif [[ "$name" == eye-* || "$name" == iris-* ]]; then
    if [ "${CTR_STATE[$name]}" = "running" ]; then echo "REVIEW_LEGACY_RUNNING"; else echo "REVIEW_LEGACY_STOPPED"; fi
  else
    echo "OTHER_PROJECT"
  fi
}

classify_volume() {
  local name="$1" owner="$2" holders="$3" prot="$4" kind="$5"
  # 同上：开发服务的持久卷带 eye.owner + eye.protected，判在 owner 之前。
  if [ "$prot" = "true" ] || [ "$kind" = "dev-service" ] ||
     [ "$name" = "eye-diagnosis_chroma-data" ]; then
    echo "PROTECTED_DEV"
  elif [ "$owner" = "$OWNER" ]; then
    if [ -z "$holders" ]; then
      echo "SAFE_UNHELD"
    elif [[ "$holders" == *"(running)"* ]]; then
      echo "ACTIVE_OWNED"
    else
      echo "SAFE_HELD_STOPPED"
    fi
  elif is_anon_volume "$name"; then
    echo "REVIEW_ANON"
  elif [[ "$name" == eye-* || "$name" == local-preview_* || "$name" == pr-12-hardening_* ]]; then
    echo "REVIEW_LEGACY_EYE"
  elif [[ "$name" == ai-interview_* || "$name" == milvus* || "$name" == vs45-* ]]; then
    echo "OTHER_PROJECT"
  else
    echo "REVIEW_UNKNOWN"
  fi
}

classify_network() {
  local name="$1" owner="$2" project="$3"
  case "$name" in
    bridge|host|none) echo "SYSTEM"; return ;;
  esac
  if [ "$owner" = "$OWNER" ]; then
    if printf '%s\n' "$dangling_nets" | grep -qx "$name"; then echo "SAFE_DANGLING"; else echo "ACTIVE_OWNED"; fi
  elif [ "$project" = "eye-diagnosis" ]; then
    echo "PROTECTED_DEV"
  elif [[ "$name" == eye-compose* || "$name" == eye-verify* ]]; then
    echo "REVIEW_LEGACY_EYE"
  elif [ "$project" = "ai-interview" ] || [ "$project" = "oncall-agent" ] || [ "$name" = "milvus" ]; then
    echo "OTHER_PROJECT"
  else
    echo "REVIEW_UNKNOWN"
  fi
}

# ---------------------------------------------------------------- pass 1 -----
# Gather classified rows first so --json and the report share one snapshot.
declare -a C_ROWS=() V_ROWS=() N_ROWS=()
declare -A COUNT=()

while IFS='|' read -r cid name state image owner runid kind prot compose; do
  [ -n "${name:-}" ] || continue
  [ -z "$RUN_ID_FILTER" ] || [ "$runid" = "$RUN_ID_FILTER" ] || continue
  cls="$(classify_container "$name")"
  COUNT["C_$cls"]=$(( ${COUNT["C_$cls"]:-0} + 1 ))
  C_ROWS+=("$cls|$cid|$name|$state|$image|$runid")
done <<< "$ctr_tsv"

while IFS='|' read -r name created owner runid kind prot compose; do
  [ -n "${name:-}" ] || continue
  [ -z "$RUN_ID_FILTER" ] || [ "$runid" = "$RUN_ID_FILTER" ] || continue
  holders="$(volume_holders "$name")"
  cls="$(classify_volume "$name" "$owner" "$holders" "$prot" "$kind")"
  COUNT["V_$cls"]=$(( ${COUNT["V_$cls"]:-0} + 1 ))
  V_ROWS+=("$cls|$name|${VOL_SIZE[$name]:-?}|$created|$owner|$runid|$holders")
done <<< "$vol_tsv"

while IFS='|' read -r nid name owner runid project; do
  [ -n "${name:-}" ] || continue
  [ -z "$RUN_ID_FILTER" ] || [ "$runid" = "$RUN_ID_FILTER" ] || continue
  cls="$(classify_network "$name" "$owner" "$project")"
  COUNT["N_$cls"]=$(( ${COUNT["N_$cls"]:-0} + 1 ))
  N_ROWS+=("$cls|$nid|$name|$project")
done <<< "$net_tsv"

if [ "$JSON" = 1 ]; then
  printf '{"owner":"%s","runId":"%s","counts":{' "$OWNER" "$RUN_ID_FILTER"
  first=1
  for k in "${!COUNT[@]}"; do
    [ "$first" = 1 ] || printf ','
    first=0
    printf '"%s":%s' "$k" "${COUNT[$k]}"
  done
  printf '},"safe":{"containers":%s,"volumes":%s,"networks":%s,"volumesUnheld":%s,"volumesHeldStopped":%s}}\n' \
    "${COUNT[C_SAFE_STOPPED]:-0}" \
    "$(( ${COUNT[V_SAFE_UNHELD]:-0} + ${COUNT[V_SAFE_HELD_STOPPED]:-0} ))" \
    "${COUNT[N_SAFE_DANGLING]:-0}" \
    "${COUNT[V_SAFE_UNHELD]:-0}" \
    "${COUNT[V_SAFE_HELD_STOPPED]:-0}"
  exit 0
fi

# ---------------------------------------------------------------- pass 2 -----
echo "=== Docker test resource inventory (dry-run) ==="
echo "owner namespace : $OWNER"
echo "run filter      : ${RUN_ID_FILTER:-<all>}"
echo "host            : $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
echo

echo "--- CONTAINERS ---"
if [ ${#C_ROWS[@]} -eq 0 ]; then echo "  (none)"; fi
for row in "${C_ROWS[@]}"; do
  IFS='|' read -r cls cid name state image runid <<< "$row"
  printf '  [%-17s] %-34s %-10s %s  run=%s\n' "$cls" "$name" "$state" "$image" "${runid:-<none>}"
done
echo

echo "--- VOLUMES ---"
if [ ${#V_ROWS[@]} -eq 0 ]; then echo "  (none)"; fi
for row in "${V_ROWS[@]}"; do
  IFS='|' read -r cls name size created owner runid holders <<< "$row"
  printf '  [%-17s] %-34s %-9s holders=%s\n' "$cls" "$name" "$size" "${holders:-<none>}"
done
echo

echo "--- NETWORKS ---"
if [ ${#N_ROWS[@]} -eq 0 ]; then echo "  (none)"; fi
for row in "${N_ROWS[@]}"; do
  IFS='|' read -r cls nid name project <<< "$row"
  printf '  [%-17s] %-34s project=%s\n' "$cls" "$name" "${project:-<none>}"
done
echo

echo "--- IMAGES (report only; never auto-deleted) ---"
while IFS='|' read -r tag iid size created; do
  [ -n "${tag:-}" ] || continue
  case "$tag" in
    eye-verify:*|eye-python-cpu:*|pr-12-hardening-*) printf '  [REVIEW_LEGACY_EYE_IMAGE] %-42s %-9s %s\n' "$tag" "$size" "$created" ;;
  esac
done <<< "$img_tsv"
echo

echo "--- SUMMARY ---"
for cls in ACTIVE_OWNED SAFE_STOPPED SAFE_UNHELD SAFE_HELD_STOPPED SAFE_DANGLING PROTECTED_DEV \
  REVIEW_LEGACY_RUNNING REVIEW_LEGACY_STOPPED REVIEW_LEGACY_EYE REVIEW_ANON REVIEW_UNKNOWN \
  OTHER_PROJECT SYSTEM; do
  printf '  %-18s containers=%-3s volumes=%-3s networks=%s\n' "$cls" \
    "${COUNT[C_$cls]:-0}" "${COUNT[V_$cls]:-0}" "${COUNT[N_$cls]:-0}"
done
echo
echo "SAFE set (only these are eligible for --apply-safe):"
echo "  containers: ${COUNT[C_SAFE_STOPPED]:-0}  volumes: $(( ${COUNT[V_SAFE_UNHELD]:-0} + ${COUNT[V_SAFE_HELD_STOPPED]:-0} ))  networks: ${COUNT[N_SAFE_DANGLING]:-0}"
echo "Protected: running owned containers, stopped containers still holding volumes,"
echo "           eye-diagnosis compose service/volume, and every other project."
echo "Legacy REVIEW_* rows are reported but never auto-deleted; delete them only by"
echo "explicit human decision after confirming the owner."
echo
echo "This tool never calls docker system/volume/container/image/network prune."

# ---------------------------------------------------------------- apply ------
if [ "$APPLY_SAFE" = 1 ]; then
  echo
  echo "=== --apply-safe: deleting SAFE set (owner=$OWNER) ==="
  removed_c=0; removed_v=0; removed_n=0

  for row in "${C_ROWS[@]}"; do
    IFS='|' read -r cls cid name state image runid <<< "$row"
    [ "$cls" = "SAFE_STOPPED" ] || continue
    now="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo missing)"
    if [ "$now" = "running" ]; then
      echo "  skip (started since snapshot): $name"
      continue
    fi
    docker rm -f -v "$cid" >/dev/null 2>&1 || true
    echo "  removed container $name"
    removed_c=$((removed_c + 1))
  done

  for row in "${V_ROWS[@]}"; do
    IFS='|' read -r cls name size created owner runid holders <<< "$row"
    case "$cls" in
      SAFE_UNHELD|SAFE_HELD_STOPPED) ;;
      *) continue ;;
    esac
    # A volume held by a stopped owner becomes unheld after the container loop
    # above; re-check instead of trusting the snapshot.
    held="$(docker ps -a --filter "volume=$name" -q 2>/dev/null || true)"
    if [ -n "$held" ]; then
      echo "  skip (still held by a container): $name"
      continue
    fi
    docker volume rm -f "$name" >/dev/null 2>&1 || true
    echo "  removed volume $name ($size)"
    removed_v=$((removed_v + 1))
  done

  for row in "${N_ROWS[@]}"; do
    IFS='|' read -r cls nid name project <<< "$row"
    [ "$cls" = "SAFE_DANGLING" ] || continue
    reached="$(docker network inspect -f '{{len .Containers}}' "$nid" 2>/dev/null || echo 0)"
    if [ "$reached" != "0" ]; then
      echo "  skip (network is now attached): $name"
      continue
    fi
    docker network rm "$nid" >/dev/null 2>&1 || true
    echo "  removed network $name"
    removed_n=$((removed_n + 1))
  done

  echo "removed: containers=$removed_c volumes=$removed_v networks=$removed_n"
elif [ "$(( ${COUNT[C_SAFE_STOPPED]:-0} + ${COUNT[V_SAFE_UNHELD]:-0} + ${COUNT[V_SAFE_HELD_STOPPED]:-0} + ${COUNT[N_SAFE_DANGLING]:-0} ))" -gt 0 ]; then
  echo
  echo "Dry-run only. Re-run with --apply-safe to remove the SAFE set above."
fi
