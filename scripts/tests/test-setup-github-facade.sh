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
