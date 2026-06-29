#!/usr/bin/env bash
# 烟雾测试：验证 setup-github-facade.sh 的 CLI 解析与 dry-run 输出
# 跑在 --dry-run --skip-github 模式下，不连真实 GitHub
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/../setup-github-facade.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

# --- 测试 1: --help 应输出帮助并 exit 0 ---
output=$("$SCRIPT" --help 2>&1) || { echo "FAIL: --help exited non-zero"; exit 1; }
echo "$output" | grep -q "Usage:" || { echo "FAIL: --help missing 'Usage:'"; exit 1; }
echo "$output" | grep -q -- "--dry-run" || { echo "FAIL: --help missing --dry-run flag"; exit 1; }
echo "PASS: test_help"

# --- 测试 2: 不传任何参数 + skip-github 应运行完整流程但不发网络请求 ---
# 在仓库根目录跑（--skip-github 避免任何 gh 调用）
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
output=$(cd "$ROOT_DIR" && "$SCRIPT" --dry-run --skip-github 2>&1) || \
  { echo "FAIL: dry-run exited non-zero"; echo "$output"; exit 1; }
echo "$output" | grep -q "DRY RUN" || { echo "FAIL: missing DRY RUN marker"; echo "$output"; exit 1; }
echo "$output" | grep -q "gh api.*default_branch=master" || { echo "FAIL: missing default_branch patch"; exit 1; }
echo "$output" | grep -q "gh repo edit.*--add-topic spring-ai" || { echo "FAIL: missing topic spring-ai"; exit 1; }
echo "$output" | grep -q "gh repo edit.*--add-topic mcp" || { echo "FAIL: missing topic mcp"; exit 1; }
echo "PASS: test_dry_run"

# --- 测试 3: 仓库根目录的 LICENSE 必须与 fixture 一致 ---
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LICENSE="${ROOT_DIR}/LICENSE"
FIXTURE="${SCRIPT_DIR}/fixtures/expected-MIT.txt"
test -f "$LICENSE" || { echo "FAIL: LICENSE missing at repo root"; exit 1; }
test -f "$FIXTURE" || { echo "FAIL: fixture missing: $FIXTURE"; exit 1; }
diff -q "$LICENSE" "$FIXTURE" >/dev/null || \
  { echo "FAIL: LICENSE content differs from fixture"; diff "$LICENSE" "$FIXTURE" | head -20; exit 1; }
echo "PASS: test_license_content"
