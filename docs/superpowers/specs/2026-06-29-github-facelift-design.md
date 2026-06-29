# GitHub 项目门面补齐 · 设计文档

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-29 |
| 状态 | **待用户审阅** |
| 仓库 | `yuwen773/eyes-diagnosis` |
| 范围 | 门面最小集（5 件事） |

## 1. 背景

通过 GitHub API 抓取 `yuwen773/eyes-diagnosis` 仓库元数据后，发现仓库"门面"存在以下问题：

| 问题 | 证据 | 影响 |
|---|---|---|
| 默认分支指向 `feature/agentic-rag` | API: `default_branch: "feature/agentic-rag"` | 访问者首页看不到 `master` 分支已存在的 README.md |
| 无 LICENSE | API: `license: null`；raw.githubusercontent.com 404 | 默认 "All rights reserved"，他人无法合法 fork/二次分发 |
| 仓库描述无信息量 | API: `description: "eyes-diagnosis"` | 搜索/列表里看不出项目做什么 |
| 无 Topics 标签 | API: `topics: []` | 无法通过 GitHub Topics 搜索到 |
| 无 Social Preview | API: 无 `openGraphImageUrl` | 分享到社交平台没有封面图 |

注：`master` 分支已有详尽中文 `README.md`（6161 字节），本次**不重写** README——切换默认分支后即自动可见。

## 2. 目标与非目标

### 2.1 目标
- 仓库首次访问者能看到完整的 README.md
- 项目具有明确的开源许可证
- 项目可通过 Topics 被搜索到
- 分享仓库链接时有像样的预览图
- 全部操作可重跑（幂等），失败可回滚

### 2.2 非目标
- 不引入 CI / CD / Release 流程
- 不新增 GitHub Issue / PR 模板
- 不写 CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CHANGELOG
- 不改 master 分支提交历史
- 不重写或翻译 README.md
- 不引入 Makefile 等新约定

## 3. 决策记录

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 范围 | 门面最小集（5 件事） | 用户选择 "推荐" |
| 2 | Social Preview 图源 | 复用 `frontend/src/assets/banner1.png` | 零成本；图中含产品视觉 |
| 3 | LICENSE 类型与署名 | MIT, Copyright (c) 2026 长沙理工大学 | 学生作品友好；以学校名义发起 |
| 4 | GitHub 设置执行方式 | gh CLI 脚本（持久化） | 可重跑、失败可恢复、脚本即文档 |
| 5 | Description 文案 | "基于 Spring AI + Vue 3 + EfficientNet 的眼科 AI 辅助诊断平台，支持多模态 Agent 对话、RAG 知识库与眼底影像分类 (长沙理工大学)" | 覆盖技术栈 + 业务场景 + 主体 |
| 6 | Topics 列表 | `spring-ai, vue3, medical-ai, rag, mcp` | 5 个推荐标签 |

## 4. 文件布局

```
eye-diagnosis/
├── LICENSE                            ← 新建（MIT 全文）
├── docs/
│   ├── social-preview.png             ← 新建（从 banner1.png 复制）
│   └── superpowers/
│       └── specs/
│           └── 2026-06-29-github-facelift-design.md   ← 本文件
├── scripts/
│   ├── setup-github-facade.sh         ← 新建（核心脚本）
│   └── tests/
│       └── test-setup-github-facade.sh  ← 新建（脚本烟雾测试）
└── (master 分支其他文件全部不动)
```

约束：
- 不修改 `pom.xml`、前端依赖、Java 源码
- `frontend/src/assets/banner1.png` 只读，不被脚本修改
- 脚本只依赖：`bash` + `curl` + `gh` + `jq`（均在常规开发环境可用）

## 5. 脚本接口（外部契约）

```bash
scripts/setup-github-facade.sh [选项]

选项：
  --dry-run           只打印 gh 命令，不真正调用（默认 false）
  --skip-license      跳过 LICENSE 检查/创建（默认 false）
  --skip-github       跳过所有 GitHub API 调用（默认 false）
  --social-preview <path>
                      自定义 Social Preview 图路径（默认 docs/social-preview.png）
  --help              打印帮助

退出码：
  0  全部成功
  1  前置检查失败（gh 未登录、依赖缺失、LICENSE 异常）
  2  GitHub API 调用失败
  3  最终校验失败
```

## 6. 数据流（脚本执行步骤）

### 步骤 1 · 前置检查
- `command -v gh && gh auth status` → 必须已登录
- `command -v jq` → 必须存在
- `test -f LICENSE` → 缺失则用 here-doc 写入 MIT 标准全文（内容见下"§6.1 MIT 全文"）
- `test -f docs/social-preview.png` → 缺失则 `cp frontend/src/assets/banner1.png docs/social-preview.png`
- 失败 → exit 1

#### §6.1 MIT 全文（here-doc 模板）

脚本用 here-doc 写入 LICENSE，内容为 MIT 官方标准文本，Copyright 行替换为 `Copyright (c) 2026 长沙理工大学`。其他字句保持 MIT License 原文（spdx.org/licenses/MIT.html）。这样 LICENSE 是法律可执行的 MIT，不是"近似 MIT"。

### 步骤 2 · 切换默认分支
```bash
gh api -X PATCH /repos/:owner/:repo -f default_branch=master
```
- 先 `gh repo view --json defaultBranch` 比对，已是 master 则跳过
- 失败：指数退避重试 3 次，仍失败 → exit 2

### 步骤 3 · 设置元数据
```bash
gh repo edit :owner/:repo \
  --description "基于 Spring AI + Vue 3 + EfficientNet 的眼科 AI 辅助诊断平台，支持多模态 Agent 对话、RAG 知识库与眼底影像分类 (长沙理工大学)" \
  --add-topic spring-ai --add-topic vue3 \
  --add-topic medical-ai --add-topic rag \
  --add-topic mcp
```
- `gh repo edit` 本身幂等；`--add-topic` 增量添加
- 失败 → exit 2

### 步骤 4 · 上传 Social Preview
```bash
gh api -X POST /repos/:owner/:repo \
  -H "Accept: application/vnd.github+json" \
  -F "image=@docs/social-preview.png"
```
- 200/201 → 成功
- 422 (already exists) → 视为幂等成功
- 其他失败 → exit 2

### 步骤 5 · 校验
```bash
STATE=$(gh repo view --json defaultBranch,description,repositoryTopics,openGraphImageUrl)
assert $STATE.defaultBranch == "master"
assert echo "$STATE.description" | grep -q "Spring AI"
assert topics ⊇ {spring-ai, vue3, medical-ai, rag, mcp}
assert [ -n "$STATE.openGraphImageUrl" ]  # 非空即视为已上传
```
- 任一断言失败 → exit 3，输出"实际 vs 期望"对比

## 7. 错误处理矩阵

| 失败模式 | 检测点 | 处理 |
|---|---|---|
| `gh` 未安装 | 步骤 1 | exit 1，提示 `brew install gh` / 官网下载 |
| `gh` 未登录 | 步骤 1 | exit 1，提示 `gh auth login` |
| `jq` 缺失 | 步骤 1 | exit 1，提示 `apt/brew install jq` |
| LICENSE 已存在但内容不对 | 步骤 1 | 不覆盖，提示人工确认，exit 1 |
| PATCH default_branch 失败 | 步骤 2 | 重试 3 次（指数退避 1s/2s/4s），仍失败 exit 2 |
| Social Preview 422 already exists | 步骤 4 | 视为成功，继续到校验 |
| 校验失败 | 步骤 5 | 输出实际值，exit 3，提示人工核查 |
| SIGINT 中断 | 任意 | `trap` 打印"已完成的步骤可重跑"提示消息 |

## 8. 幂等性

依赖两层：

1. **命令本身幂等**（不需要额外状态）：
   - `gh api PATCH default_branch` —— 已经是 master 时 GitHub 接受为 no-op
   - `gh repo edit --description` —— 重复设同一字符串无副作用
   - `gh repo edit --add-topic` —— 重复加同一 topic 会被去重
   - `gh api POST social-preview` 上传相同图 → 422 already exists → 步骤 4 已识别为成功

2. **本地文件幂等**：LICENSE / social-preview.png 已存在则不覆盖。

因此**不需要单独的 `.omc/facade-state.json`**——脚本在每步开头做"读取-比对-再操作"即可。删除原计划的状态文件，简化脚本与文档。

`trap cleanup EXIT` 仅保留用于：在脚本被 SIGINT 中断时打印"已完成的步骤可重跑"提示消息。

## 9. 测试策略

| 测试 | 方法 | 位置 | 目的 |
|---|---|---|---|
| 烟雾测试 | 跑 `--dry-run --skip-github` | `scripts/tests/test-setup-github-facade.sh` | 验证脚本能解析参数、打印预期命令、不发网络请求 |
| LICENSE 内容快照 | diff 本地 `LICENSE` 与 fixture | 同上 | 防止 LICENSE 文本被手滑改坏 |
| 元数据契约 | grep 脚本源码，断言 description 字符串与 5 个 topics 都存在 | 同上 | 防止后续改文案漏改 |
| 端到端冒烟 | 在真实仓库跑脚本 | **手动**（需 `gh auth login`），验收清单第 11 节记录结果 | 真实环境验证 |

测试文件本身**不连真实 GitHub**，全部跑在本地 mock 模式下。

## 10. 验收清单

执行后必须全部满足：

- [ ] `LICENSE` 文件存在于仓库根目录
- [ ] `LICENSE` 内容为 MIT 标准文本，Copyright 行包含 "长沙理工大学"
- [ ] `docs/social-preview.png` 存在（1280×640 PNG）
- [ ] GitHub 仓库设置：默认分支 = `master`
- [ ] GitHub 仓库设置：Description = 第 3 节决策 #5 文案
- [ ] GitHub 仓库设置：Topics ⊇ {`spring-ai`, `vue3`, `medical-ai`, `rag`, `mcp`}
- [ ] GitHub 仓库设置：Social Preview 图已上传并可见
- [ ] 访问 `https://github.com/yuwen773/eyes-diagnosis` 根目录直接显示 README.md 内容
- [ ] 第二次运行 `scripts/setup-github-facade.sh` 应当全部跳过，0 改动，exit 0

## 11. 实施顺序（写实现计划时会展开）

1. 在工作树创建 `LICENSE`（本地 commit）
2. 复制 `docs/social-preview.png`（本地 commit）
3. 写 `scripts/setup-github-facade.sh`
4. 写 `scripts/tests/test-setup-github-facade.sh`
5. 跑本地烟雾测试
6. 手动 `gh auth login` 后端到端跑一次
7. 按验收清单逐项核查
8. commit + push

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `gh api` PATCH default_branch 在某些情况下需先有 master 分支 | 仓库已有 master；脚本先 `gh repo view` 确认 |
| Social Preview 图 GitHub 会自动 resize / 转码 | 上传 1280×640 即可，GitHub 自动处理 |
| description 含中文，编码问题 | 脚本统一使用 UTF-8；gh CLI 内部处理 |
| 用户未 `gh auth login` | 步骤 1 提前拦截，附带清晰提示 |
| 仓库是 public，PATCH 元数据有审计日志 | 这是预期行为；提交后用户可在 GitHub 审计日志看到 |

## 13. 后续可扩展（不在本次范围）

- 加 `.github/workflows/ci.yml`（后端 mvn test + 前端 npm run build + 算法 pytest）
- 加 CONTRIBUTING.md / SECURITY.md / Issue 模板
- 加 CHANGELOG.md 与 Release 流程
- README 加 CI 徽章 / Codecov 徽章 / 演示 GIF
- 启用 GitHub Discussions
