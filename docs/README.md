# docs/ 索引

按用途分组。新增文档时归到对应分组；过期文档就地删除，不要在别处复述。

## 约定与真源

| 文档 | 何时读 |
|---|---|
| `agent-worktree-conventions.md` | 在多个工作树里跑 git、杀 Windows 进程、清理临时验证产物 |
| `backend-split.md` | 改动 `frontend/` 或 `algorithm/` 共享目录，判断是否需要人工搬运到另一条后端线 |
| `flyway-migration-history-plan.md` | 新增迁移版本、处理 V8 checksum、`flyway repair`、分支版本号撞车 |
| `../DESIGN.md` | 写 `web/` 页面 / 组件 / 样式，或评审前端 diff（**Iris 2.0 · Adaptive Visual System**，目标规范；令牌事实以 `web/src/styles/tokens.css` 为准） |
| `design/IRIS_2_DESIGN_REFERENCE_BRIEF.md` | 查 Iris 2.0 的视觉参考来源与取舍（A/B/F/G/H/I 代号定义、原始链接） |
| `design/iris-2-rule-change-matrix.md` | 查旧「白色仪器」规则改成了什么、为什么改、落地到哪一步 |
| `design/iris-2-implementation-roadmap.md` | 查首页 / 管理端 / 协作台各自的实施顺序、范围与验收门禁 |
| `design/iris-2-r2-5-product-shell-audit.md` | 查 R2.5 全站视觉审计（逐路由现状/目标/复用/风险）与 Shared Product Shell 的 PR 拆分 |
| `design-system.md` | 仅 `frontend/`（Vue **已弃用**线）青绿 `--iris-*` 的旧规则，不再是产品前端真源 |
| `testing/2026-10-19-test-audit.md` | 质疑某个测试是否真的调用了被测实现 |
| `reproducibility/p1_f01_fold_repair.md` | 追溯 P1-F01 冻结折修复的来历 |

## 知识库

- `眼科疾病知识库.md` — 领域语料说明
- `知识库使用指南.md` — RAG 文档上传 / 检索的使用说明

## 计划与规格（按时间倒序，检出时以文件名为准）

- `plans/` — 2026-04 的移植、Admin UI、gRPC、MCP、find-lock、用户中心、会话管理设计/实施计划
- `superpowers/specs/` — 设计规格：GitHub 门面、仓库深度整理、P2 系列基线 / watchdog / GPU matrix / epoch loop / fold0 smoke、React 管理后台移植
- `superpowers/plans/` — 对应实施计划：P2 系列、React 管理后台 / Agent 对话页移植、Java 管理后台缺陷修复

> `specs/` 与 `plans/` 是分批归档的历史快照，只描述当时的决策；**当前真源永远是代码与迁移**，
> 不要在 implement 时把它们当作现行契约。冻结的算法侧契约见 `algorithm/p1/`（只读）。

## 架构评审报告

`/improve-codebase-architecture` 的报告写到系统临时目录（`%TEMP%` / `$TMPDIR`），
文件名 `architecture-review-<timestamp>.html`，**不入库**。需要回看时用
`ls "$TMPDIR"/architecture-review-*.html` 或 `%TEMP%` 下同名模式查找。

## 不在这里的东西

- 领域词汇表与模块边界 → 仓库根 `GLOSSARY.md`
- 代码风格与判断类约定 → 仓库根 `CODING_STANDARDS.md`
- 后端验证命令 → `scripts/verify.sh`
- 本机环境事实（MySQL 端口/账号）→ 主检出目录的 `CLAUDE.local.md`（不入库，工作树不自动继承）；Codex 侧在 `~/.codex/AGENTS.md`。
