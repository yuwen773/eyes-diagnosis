# PR 处置矩阵（2026-11-19）

> 分类只有五种：`INCLUDE` 本版本纳入 / `ABSORB` 已被其他集成提交包含 /
> `DEFER` 推迟下一版本 / `SUPERSEDED` 已有替代实现 / `HOLD` 活跃开发或不可裁定。
> ABSORB 必须有 Git 祖先证据。

| PR | 分支 | HEAD | 标题 | 处置 | 依据 |
|---|---|---|---|---|---|
| #111 | `feat/r3-agent-correctness` | `03932ab7` | R3 Agent 正确性 | **INCLUDE** | 已合入集成分支（`995097fc`），冲突与 P0/P1 处理见 `conflict-resolution.md` |
| #112 | `fix/agent-runtime-guardrails` | `a6962631` | Agent 运行时护栏 | **INCLUDE** | 已合入（`eaa8f409`），预算 + 递归上限接线完成 |
| #101 | `fix/system-states-r2` | `1010def3` | System States R2 | **INCLUDE** | 已 Ready、8/8 CI 绿、不改冻结视觉范围，Batch 2 |
| #105 | `docs/ui-freeze-exceptions` | `ecd1610a` | UI 冻结例外登记 | **INCLUDE** | 纯文档，补齐冻结期例外口径 |
| #106 | `chore/remove-dead-configs` | `59a1ff5f` | 移除死配置键 | **INCLUDE** | 删除无消费者配置，需 rebase 解冲突 |
| #107 | `chore/remove-todo-javadoc` | `a0c9ebc5` | 删除 TODO 占位 | **INCLUDE** | 纯注释清理，MERGEABLE |
| #108 | `chore/remove-caffeine` | `d08c97bd` | 移除未用依赖 | **INCLUDE** | 依赖清理，MERGEABLE |
| #109 | `chore/remove-github-facade` | `4abbfca4` | 删除一次性脚本 | **INCLUDE** | 删除未被引用的门面脚本与截图 |
| #110 | `chore/remove-web-deps` | `0548a0c3` | prettierrc 清理 | **INCLUDE** | 单行配置修正 |
| #113 | `docs/security-governance` | `75b6ed0a` | 安全遗留治理计划 | **INCLUDE** | 纯文档，不改变运行时行为 |
| #114 | `chore/untrack-skills-lock` | `b192d3d9` | 停止跟踪 skills-lock | **INCLUDE** | 仓库卫生 |
| #115 | `docs/cleanup-ledger-2026-11-18` | `57873d04` | 考古清理台账 | **INCLUDE** | 纯文档 |
| #116 | `chore/worktree-hygiene` | `2919e7fc` | 工作树收尾脚本 | **INCLUDE** | 依赖 #115 堆叠，先合 #115 |
| #102 | `feat/brand-script-and-progress` | `2c9d07ba` | 品牌字标 + NProgress | **DEFER** | 触碰 `tokens.css` / `brand.css` / 品牌层，落在 2026-11-15 UI 冻结范围内；需视觉评审与冻结例外审批 |
| #103 | `feat/system-config-center` | `5ed2652c` | CSS 边界契约 + 审计 | **DEFER** | PR 内混入配置中心 PRD/ADR（§2.3 明确不纳入），与 CSS 契约应拆成两个 PR 后再提 |
| #104 | `docs/design-status-refresh` | `f3592a09` | 设计状态表重写 | **DEFER** | 纯文档但与 `DESIGN.md` 大面积冲突（151 行），本版本无产品价值，留给文档批次 |
| #68 | `codex/realtime-product-acceptance` | `10173ae9` | 多 agent 实时协作 | **ABSORB** | `git merge-base --is-ancestor` 证实该分支是 `origin/ui` 的祖先，内容已随 #117 进入 ui |
| #14 | `worktree-java-multi-agent-arch` | `65727431` | Java 多智能体设计稿 | **ABSORB** | 同上，分支已完全包含于 `origin/ui` |

## 汇总

- **INCLUDE**：14 个（其中 2 个已实际合入： #111、 #112）
- **DEFER**：3 个（#102 冻结范围、#103 混入配置中心、#104 文档冲突）
- **ABSORB**：2 个（#68、#14，祖先关系已证实）
- **HOLD / SUPERSEDED**：0 个

## 说明

- 本表不因为「PR 多」而批量合并；每一项都要么有产品价值，要么是零风险清理，
  要么有 Git 祖先证据。
- #111 合入后，`feat/r3-agent-correctness` 分支本身不关闭、不 force push；
  集成树上另有 P0/P1 修复提交（`1d69698c`），需要时以集成分支为准。
