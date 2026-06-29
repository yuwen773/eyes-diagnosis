# GitHub 项目门面补齐 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `yuwen773/eyes-diagnosis` 仓库补齐 5 项 GitHub 门面配置（默认分支 / LICENSE / Description+Topics / Social Preview / README 可见性），通过一个持久化、可重跑的 bash 脚本完成。

**Architecture:** 5 件事的本地部分（LICENSE 文件、Social Preview 图副本）用 git commit 落地；GitHub 设置部分（切默认分支、设元数据、上传 Social Preview）由幂等 bash 脚本 `scripts/setup-github-facade.sh` 通过 `gh` CLI 调用。脚本自带前置检查、4 步操作、最终校验，配 `scripts/tests/test-setup-github-facade.sh` 做 TDD 烟雾测试。

**Tech Stack:** bash 4+ / `gh` CLI / `jq` / `curl`（全部常规开发环境已具备；不新增项目依赖）

**Spec 文档：** `docs/superpowers/specs/2026-06-29-github-facelift-design.md`

---

## File Structure

本次实施涉及 5 个新文件：

| 路径 | 类型 | 职责 |
|---|---|---|
| `LICENSE` | 新建 | MIT 许可证全文（Copyright © 2026 长沙理工大学） |
| `docs/social-preview.png` | 新建 | 从 `frontend/src/assets/banner1.png` 复制，1280×640 PNG |
| `scripts/setup-github-facade.sh` | 新建 | 核心脚本：4 步幂等操作 + 校验 |
| `scripts/tests/test-setup-github-facade.sh` | 新建 | bash 烟雾测试，验证 CLI 解析 / dry-run 输出 / 文件逻辑 |
| `scripts/tests/fixtures/expected-MIT.txt` | 新建 | LICENSE 内容快照测试的 fixture |

不修改任何已有源文件。

---

## Task 1: 添加 MIT LICENSE 文件

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: 写入 LICENSE 文件**

在仓库根目录创建 `LICENSE`，内容是 MIT 官方标准全文，把 Copyright 行替换为本项目署名。

```bash
cat > LICENSE <<'EOF'
MIT License

Copyright (c) 2026 长沙理工大学

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
```

- [ ] **Step 2: 验证文件内容**

Run: `head -3 LICENSE && echo "---" && grep "长沙理工大学" LICENSE`
Expected:
- `head` 输出包含 `MIT License`、`Copyright (c) 2026 长沙理工大学`、`Permission is hereby granted`
- `grep` 命中 "长沙理工大学"

- [ ] **Step 3: 验证文件大小**

Run: `wc -c LICENSE`
Expected: 大约 1067 字节（±10 字节正常）

- [ ] **Step 4: 提交**

```bash
git add LICENSE
git commit -m "feat: add MIT LICENSE

Copyright (c) 2026 长沙理工大学

Closes: 门面补齐任务 #1"
```

---

## Task 2: 复制 Social Preview 图

**Files:**
- Create: `docs/social-preview.png`

- [ ] **Step 1: 复制源图**

Run:
```bash
cp frontend/src/assets/banner1.png docs/social-preview.png
```

- [ ] **Step 2: 验证文件存在且尺寸正确**

Run:
```bash
test -f docs/social-preview.png && \
  python -c "from PIL import Image; im=Image.open('docs/social-preview.png'); print(im.size)" 2>/dev/null || \
  file docs/social-preview.png
```

Expected: 输出 `banner1.png` 的尺寸（1280×640 或类似横版尺寸），或 `file` 命令输出包含 `PNG image data, 1280 x 640`。

如果 `file` 报告尺寸不是 1280×640，使用 ImageMagick 调整：

```bash
command -v magick && magick docs/social-preview.png -resize 1280x640 docs/social-preview.png || \
  echo "WARNING: cannot resize, original size retained"
```

- [ ] **Step 3: 提交**

```bash
git add docs/social-preview.png
git commit -m "feat: add Social Preview image (1280x640)

Source: frontend/src/assets/banner1.png
Used as: GitHub repository social preview / Open Graph image"
```

---

## Task 3: 测试脚手架 + 脚本 stub

**Files:**
- Create: `scripts/tests/test-setup-github-facade.sh`
- Create: `scripts/setup-github-facade.sh`

- [ ] **Step 1: 写第一个失败的测试**

创建 `scripts/tests/test-setup-github-facade.sh`：

```bash
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
```

- [ ] **Step 2: 运行测试，验证它失败**

Run: `bash scripts/tests/test-setup-github-facade.sh`
Expected: FAIL，输出 "No such file or directory"（脚本还不存在）

- [ ] **Step 3: 创建脚本 stub（只实现 --help）**

创建 `scripts/setup-github-facade.sh`：

```bash
#!/usr/bin/env bash
# scripts/setup-github-facade.sh
# 一站式、幂等的 GitHub 仓库门面设置脚本
# 详见 docs/superpowers/specs/2026-06-29-github-facelift-design.md
set -euo pipefail

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

main() {
  if [[ "${1:-}" == "--help" ]]; then
    print_help
    exit 0
  fi
  echo "ERROR: not yet implemented" >&2
  exit 1
}

main "$@"
```

- [ ] **Step 4: 给脚本加可执行权限并运行测试，验证通过**

Run:
```bash
chmod +x scripts/setup-github-facade.sh scripts/tests/test-setup-github-facade.sh
bash scripts/tests/test-setup-github-facade.sh
```

Expected: 输出 `PASS: test_help`，exit 0

- [ ] **Step 5: 提交**

```bash
git add scripts/setup-github-facade.sh scripts/tests/test-setup-github-facade.sh
git commit -m "feat(scripts): setup-github-facade.sh scaffold + smoke test

Script is a stub that only handles --help. Subsequent tasks add
preflight, --dry-run, and full operation steps.

Test: scripts/tests/test-setup-github-facade.sh
- Verifies --help exits 0 and contains Usage/--dry-run markers"
```

---

## Task 4: 实现 CLI 参数解析（dry-run / skip-license / skip-github）

**Files:**
- Modify: `scripts/setup-github-facade.sh`
- Modify: `scripts/tests/test-setup-github-facade.sh`

- [ ] **Step 1: 在测试文件中追加新测试**

在 `scripts/tests/test-setup-github-facade.sh` 的 `trap` 行之前追加：

```bash
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
```

- [ ] **Step 2: 运行测试，验证它失败**

Run: `bash scripts/tests/test-setup-github-facade.sh`
Expected: FAIL，输出 "FAIL: missing DRY RUN marker"（因为脚本现在只实现 --help）

- [ ] **Step 3: 重写脚本，加入参数解析 + dry-run 模式**

完整替换 `scripts/setup-github-facade.sh` 内容：

```bash
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
  local current
  current=$(gh repo view "${EXPECTED_OWNER}/${EXPECTED_REPO}" --json defaultBranch -q '.defaultBranch' 2>/dev/null || echo "")
  if [[ "$current" == "$EXPECTED_DEFAULT_BRANCH" ]]; then
    echo "[skip] default branch already $EXPECTED_DEFAULT_BRANCH"
    return 0
  fi
  local attempt=0 max=3
  while (( attempt < max )); do
    if run_gh api -X PATCH "/repos/${EXPECTED_OWNER}/${EXPECTED_REPO}" -f "default_branch=${EXPECTED_DEFAULT_BRANCH}"; then
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
  if [[ ! -f "$SOCIAL_PREVIEW_PATH" ]]; then
    echo "ERROR: social preview not found: $SOCIAL_PREVIEW_PATH" >&2
    exit 1
  fi
  # GitHub 返回 422 表示已存在，视为幂等成功
  local out
  out=$(run_gh api -X POST "/repos/${EXPECTED_OWNER}/${EXPECTED_REPO}" \
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
  actual_branch=$(echo "$state" | jq -r '.defaultBranch')
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
      --social-preview) SOCIAL_PREVIEW_PATH="$2"; shift 2 ;;
      --help) print_help; exit 0 ;;
      *) echo "ERROR: unknown option $1" >&2; print_help >&2; exit 1 ;;
    esac
  done

  preflight
  $SKIP_GITHUB || switch_default_branch || exit 2
  $SKIP_GITHUB || set_metadata || exit 2
  $SKIP_GITHUB || upload_social_preview || exit 2
  $SKIP_GITHUB && echo "[skip-github] skipping verify" || verify
  echo "[done] facade setup complete"
}

main "$@"
```

- [ ] **Step 4: 运行测试，验证它通过**

Run: `bash scripts/tests/test-setup-github-facade.sh`
Expected: 输出 `PASS: test_help` 和 `PASS: test_dry_run`，exit 0

- [ ] **Step 5: 提交**

```bash
git add scripts/setup-github-facade.sh scripts/tests/test-setup-github-facade.sh
git commit -m "feat(scripts): implement full facade setup with --dry-run

Adds 5 steps: preflight / switch default branch / set metadata /
upload social preview / verify. --dry-run prints gh commands
without executing; --skip-github bypasses all network calls.

All gh commands are themselves idempotent (per spec §8).
Test now covers --help and --dry-run --skip-github modes."
```

---

## Task 5: 添加 LICENSE fixture 测试

**Files:**
- Create: `scripts/tests/fixtures/expected-MIT.txt`
- Modify: `scripts/tests/test-setup-github-facade.sh`

- [ ] **Step 1: 写 fixture 文件**

创建 `scripts/tests/fixtures/expected-MIT.txt`：

```
MIT License

Copyright (c) 2026 长沙理工大学

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: 在测试文件中追加 LICENSE diff 测试**

在 `scripts/tests/test-setup-github-facade.sh` 的 trap 之前追加：

```bash
# --- 测试 3: 仓库根目录的 LICENSE 必须与 fixture 一致 ---
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LICENSE="${ROOT_DIR}/LICENSE"
FIXTURE="${SCRIPT_DIR}/fixtures/expected-MIT.txt"
test -f "$LICENSE" || { echo "FAIL: LICENSE missing at repo root"; exit 1; }
test -f "$FIXTURE" || { echo "FAIL: fixture missing: $FIXTURE"; exit 1; }
diff -q "$LICENSE" "$FIXTURE" >/dev/null || \
  { echo "FAIL: LICENSE content differs from fixture"; diff "$LICENSE" "$FIXTURE" | head -20; exit 1; }
echo "PASS: test_license_content"
```

- [ ] **Step 3: 运行测试，验证它通过**

Run: `bash scripts/tests/test-setup-github-facade.sh`
Expected: 三个测试全部 PASS（test_help / test_dry_run / test_license_content），exit 0

- [ ] **Step 4: 提交**

```bash
git add scripts/tests/fixtures/expected-MIT.txt scripts/tests/test-setup-github-facade.sh
git commit -m "test(scripts): add LICENSE content snapshot test

Fixture-based test prevents accidental modification of the MIT
license text. Catches hand-edits that could break the legal effect."
```

---

## Task 6: 端到端冒烟测试（手动，需 `gh auth login`）

**Files:** 无新文件

- [ ] **Step 1: 确认 gh 已登录**

Run: `gh auth status`
Expected: 输出 "Logged in to github.com as <user>"

如未登录：在终端输入 `! gh auth login`（用 bang 前缀让命令在本会话运行），按提示选择 HTTPS / 浏览器登录。

- [ ] **Step 2: dry-run 一次确认输出符合预期**

Run: `bash scripts/setup-github-facade.sh --dry-run`
Expected: 输出包含以下 5 行 `[DRY RUN] gh ...`：
- `api -X PATCH /repos/yuwen773/eyes-diagnosis -f default_branch=master`
- `repo edit yuwen773/eyes-diagnosis --description ... --add-topic ...`
- `api -X POST /repos/yuwen773/eyes-diagnosis ... -F image=@docs/social-preview.png`

- [ ] **Step 3: 真实执行一次**

Run: `bash scripts/setup-github-facade.sh`
Expected: 脚本按步骤执行，无 ERROR 输出，结尾输出 `[done] facade setup complete` 和 `[ok] all assertions passed`

- [ ] **Step 4: 二次执行验证幂等性**

Run: `bash scripts/setup-github-facade.sh`
Expected: 输出包含 `[skip] default branch already master` 和 `[skip] social preview already uploaded`，exit 0

- [ ] **Step 5: GitHub 网页肉眼核查验收清单**

打开 `https://github.com/yuwen773/eyes-diagnosis`，对照 spec §10 验收清单逐项打勾：

- [ ] `LICENSE` 文件存在
- [ ] `LICENSE` 内容为 MIT 全文
- [ ] `docs/social-preview.png` 存在
- [ ] 默认分支 = `master`
- [ ] Description = "基于 Spring AI + Vue 3 + EfficientNet 的眼科 AI 辅助诊断平台，..."
- [ ] Topics 包含 `spring-ai` `vue3` `medical-ai` `rag` `mcp`
- [ ] Social Preview 图显示在仓库设置中
- [ ] 仓库首页直接显示 README.md
- [ ] 二次跑脚本 0 改动

- [ ] **Step 6: 提交执行结果记录（可选）**

如果验收有偏差，在本目录新增 `docs/superpowers/plans/2026-06-29-github-facelift-run-log.md` 记录实际输出与偏差。否则跳过此步。

---

## Task 7: 最终提交 + 推送

**Files:** 无新文件

- [ ] **Step 1: 确认 git 状态干净**

Run: `git status`
Expected: `nothing to commit, working tree clean`（所有本地提交都已经在前面任务中完成）

- [ ] **Step 2: 推送到 origin**

Run: `git push origin master`
Expected: 5~6 个新 commit 推送到 origin/master

- [ ] **Step 3: 验证 GitHub 远程已同步**

Run: `git log --oneline origin/master -5`
Expected: 看到 Task 1~6 的 commit 都在 origin/master 上

---

## Self-Review

**1. Spec coverage:**
- Spec §3 决策 #1（门面最小集）→ Task 1~6 共同实现 ✅
- Spec §3 决策 #2（Social Preview = banner1.png）→ Task 2 ✅
- Spec §3 决策 #3（MIT + 长沙理工大学）→ Task 1 ✅
- Spec §3 决策 #4（gh CLI 脚本）→ Task 3~4 ✅
- Spec §3 决策 #5（Description 文案）→ Task 4（脚本里硬编码）✅
- Spec §3 决策 #6（5 个 topics）→ Task 4（脚本里数组）✅
- Spec §5 接口（CLI 选项 / 退出码）→ Task 4 ✅
- Spec §6.1 MIT 全文 → Task 1 + Task 5 fixture ✅
- Spec §6 数据流 5 步 → Task 4（脚本主体）✅
- Spec §7 错误处理矩阵 → Task 4（preflight / set -e / 退出码）✅
- Spec §8 幂等性（命令自身幂等）→ Task 4（用 `gh repo view` 比对 + 步骤 4 的 422 处理）✅
- Spec §9 测试策略 → Task 3~5（bash 烟雾测试 + LICENSE fixture）✅
- Spec §10 验收清单 → Task 6 Step 5 ✅

**2. Placeholder scan:** 无 "TBD" / "TODO" / "implement later"。所有代码完整。

**3. Type consistency:** 脚本里变量名 `EXPECTED_TOPICS` / `EXPECTED_DEFAULT_BRANCH` / `EXPECTED_OWNER` / `EXPECTED_REPO` 在 Task 4 中定义并全程使用，函数 `preflight` / `switch_default_branch` / `set_metadata` / `upload_social_preview` / `verify` 在 Task 4 全部定义，Task 6 dry-run 输出引用方式与 Task 4 实现一致。
