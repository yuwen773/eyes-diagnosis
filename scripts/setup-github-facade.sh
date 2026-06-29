#!/usr/bin/env bash
# scripts/setup-github-facade.sh
# 一站式、幂等的 GitHub 仓库门面设置脚本
# 详见 docs/superpowers/specs/2026-06-29-github-facelift-design.md
set -euo pipefail

# --- 默认值 ---
DRY_RUN=false
SKIP_LICENSE=false
SKIP_GITHUB=false
SOCIAL_PREVIEW_PATH="docs/social-preview.png"
EXPECTED_TOPICS=(spring-ai vue3 medical-ai rag mcp)
EXPECTED_DESCRIPTION_FRAGMENT="Spring AI"
EXPECTED_DEFAULT_BRANCH="master"
EXPECTED_OWNER="yuwen773"
EXPECTED_REPO="eyes-diagnosis"

# --- 帮助 ---
print_help() {
  cat <<'USAGE'
Usage: setup-github-facade.sh [选项]

设置 yuwen773/eyes-diagnosis 仓库的 GitHub 门面配置。

选项：
  --dry-run           只打印 gh 命令，不真正调用（默认 false）
  --skip-license      跳过 LICENSE 检查/创建（默认 false）
  --skip-github       跳过所有 GitHub API 调用（默认 false）
  --social-preview <path>
                      自定义 Social Preview 图路径（默认 docs/social-preview.png）
  --help              打印此帮助

退出码：
  0  全部成功
  1  前置检查失败
  2  GitHub API 调用失败
  3  最终校验失败

USAGE
}

# --- 工具：执行或打印 gh 命令 ---
run_gh() {
  if $DRY_RUN; then
    echo "[DRY RUN] gh $*"
  else
    gh "$@"
  fi
}

# --- 步骤 1: 前置检查 ---
preflight() {
  if ! $SKIP_GITHUB; then
    command -v gh >/dev/null 2>&1 || { echo "ERROR: gh not installed" >&2; exit 1; }
    gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not logged in. Run: gh auth login" >&2; exit 1; }
  fi
  command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not installed" >&2; exit 1; }
}

# --- 步骤 2: 切默认分支 ---
switch_default_branch() {
  if $DRY_RUN; then
    # NOTE: dry-run 模式跳过 live `gh repo view` 预检查，保持 dry-run 真正不连网。
    # 若需看到 `[skip] already master` 行为，去掉此 early-return（会引入 1 次 live read-only 调用）。
    run_gh api -X PATCH "repos/${EXPECTED_OWNER}/${EXPECTED_REPO}" -f "default_branch=${EXPECTED_DEFAULT_BRANCH}"
    return 0
  fi
  local current
  current=$(gh repo view "${EXPECTED_OWNER}/${EXPECTED_REPO}" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || echo "")
  if [[ "$current" == "$EXPECTED_DEFAULT_BRANCH" ]]; then
    echo "[skip] default branch already $EXPECTED_DEFAULT_BRANCH"
    return 0
  fi
  local attempt=0 max=3
  while (( attempt < max )); do
    if run_gh api -X PATCH "repos/${EXPECTED_OWNER}/${EXPECTED_REPO}" -f "default_branch=${EXPECTED_DEFAULT_BRANCH}"; then
      return 0
    fi
    attempt=$((attempt+1))
    sleep $((1 << attempt))  # 指数退避 2s/4s/8s
  done
  echo "ERROR: failed to switch default branch after $max attempts" >&2
  exit 2
}

# --- 步骤 3: 设置 description + topics ---
set_metadata() {
  local desc="基于 Spring AI + Vue 3 + EfficientNet 的眼科 AI 辅助诊断平台，支持多模态 Agent 对话、RAG 知识库与眼底影像分类 (长沙理工大学)"
  local topic_args=()
  for t in "${EXPECTED_TOPICS[@]}"; do
    topic_args+=(--add-topic "$t")
  done
  run_gh repo edit "${EXPECTED_OWNER}/${EXPECTED_REPO}" --description "$desc" "${topic_args[@]}"
}

# --- 步骤 4: 上传 Social Preview ---
upload_social_preview() {
  if $DRY_RUN; then
    # dry-run：直接打印 gh 命令，不进入 $(...) 捕获路径
    run_gh api -X POST "repos/${EXPECTED_OWNER}/${EXPECTED_REPO}" \
      -H "Accept: application/vnd.github+json" \
      -F "image=@${SOCIAL_PREVIEW_PATH}"
    return 0
  fi
  if [[ ! -f "$SOCIAL_PREVIEW_PATH" ]]; then
    echo "ERROR: social preview not found: $SOCIAL_PREVIEW_PATH" >&2
    exit 1
  fi
  # 真实模式：捕获输出以便处理 422 already-exists
  local out
  out=$(gh api -X POST "repos/${EXPECTED_OWNER}/${EXPECTED_REPO}" \
    -H "Accept: application/vnd.github+json" \
    -F "image=@${SOCIAL_PREVIEW_PATH}" 2>&1) || {
    if echo "$out" | grep -q "already exists\|422"; then
      echo "[skip] social preview already uploaded"
      return 0
    fi
    echo "ERROR: failed to upload social preview" >&2
    echo "$out" >&2
    exit 2
  }
}

# --- 步骤 5: 校验 ---
verify() {
  local state
  state=$(gh repo view "${EXPECTED_OWNER}/${EXPECTED_REPO}" \
    --json defaultBranch,description,repositoryTopics,openGraphImageUrl 2>/dev/null) || {
    echo "ERROR: verify failed to read repo state" >&2; exit 3; }

  local actual_branch actual_desc actual_topics actual_og
  actual_branch=$(echo "$state" | jq -r '.defaultBranchRef.name')
  actual_desc=$(echo "$state" | jq -r '.description')
  actual_topics=$(echo "$state" | jq -r '.repositoryTopics[]?.name' | sort | tr '\n' ',')
  actual_og=$(echo "$state" | jq -r '.openGraphImageUrl // ""')

  local ok=true
  [[ "$actual_branch" == "$EXPECTED_DEFAULT_BRANCH" ]] || { echo "FAIL: defaultBranch=$actual_branch want=$EXPECTED_DEFAULT_BRANCH"; ok=false; }
  echo "$actual_desc" | grep -q "$EXPECTED_DESCRIPTION_FRAGMENT" || { echo "FAIL: description missing '$EXPECTED_DESCRIPTION_FRAGMENT'"; ok=false; }
  for t in "${EXPECTED_TOPICS[@]}"; do
    echo "$actual_topics" | grep -q "$t" || { echo "FAIL: missing topic $t"; ok=false; }
  done
  [[ -n "$actual_og" ]] || { echo "FAIL: openGraphImageUrl is empty"; ok=false; }

  $ok || exit 3
  echo "[ok] all assertions passed"
}

# --- 主流程 ---
main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=true; shift ;;
      --skip-license) SKIP_LICENSE=true; shift ;;
      --skip-github) SKIP_GITHUB=true; shift ;;
      --social-preview) [[ -z "$2" ]] && { echo "ERROR: --social-preview requires a non-empty path" >&2; exit 1; }; SOCIAL_PREVIEW_PATH="$2"; shift 2 ;;
      --help) print_help; exit 0 ;;
      *) echo "ERROR: unknown option $1" >&2; print_help >&2; exit 1 ;;
    esac
  done

  # --skip-github 隐含 dry-run 行为：所有步骤以打印方式运行，不连真实 GitHub
  if $SKIP_GITHUB; then
    DRY_RUN=true
  fi

  # NOTE: plan 原用 `$SKIP_GITHUB && echo ... || verify` 链式模式（known footgun，
  # 在 verify 失败时 echo 仍 exit 0 会掩盖错误）。此处改用直白 if/else + || exit N。
  preflight
  switch_default_branch || exit 2
  set_metadata || { echo "ERROR: gh repo edit failed" >&2; exit 2; }
  upload_social_preview || exit 2
  if $DRY_RUN; then
    echo "[dry-run] skipping verify (no actual changes to assert)"
  elif ! $SKIP_GITHUB; then
    verify
  else
    echo "[skip-github] skipping verify"
  fi
  echo "[done] facade setup complete"
}

main "$@"
