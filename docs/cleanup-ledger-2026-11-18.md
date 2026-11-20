# 考古报告逐项清理台账（2026-11-18）

> **来源**：`docs/architecture/codebase-archaeology-2026-11-17.md`（在 `feat/system-config-center` 线
> `3c302504`，**不在 `ui`**）。本文只记录「处理到哪一步、哪条报告结论需要修正、
> 哪些还等 owner 拍板」，不复述报告内容——要看结论与证据请直接读报告。
>
> **口径**：每项一个 Draft PR，不直接合并；合并时机由 owner 决定。

## 1. 已交付

| PR | 项 | 结果 |
|---|---|---|
| #104 | `DESIGN.md` 状态表按当前代码重写（清掉「PR #52 未合并」误导） | CI 7/7 |
| #105 | UI 冻结后的例外与放行登记（`docs/design/iris21-ui-freeze-exceptions.md`） | CI 7/7 |
| #106 | 三组无消费者的死配置键（`hash-algorithm`、`rag.evaluation.*`、Chroma `tenant-name`/`database-name`） | CI 7/7 |
| #107 | 16 处从未填写的 `@Description TODO` | CI 7/7 |
| #108 | 未使用的 `caffeine` 依赖 | CI 7/7 |
| #109 | 一次性 GitHub 门面脚本与截图（约 1.09 MB） | CI 7/7 |
| #110 | `web/.prettierrc` 里已不存在的 `cva` | CI 7/7 |
| #112 | **Agent 运行时护栏接线**（报告 §5 的 P0）：工具调用预算 + 图步数上限 | CI 7/7，新增 8 个测试 |
| #113 | 安全遗留治理计划（MD5→BCrypt、配置中心门禁、CSRF 载体判定） | CI 7/7 |
| #114 | 停止跟踪 `skills-lock.json`（报告第 10 项的安全子集） | 见 PR |

「CI 7/7」指 `backend-compile / backend-unit / flyway-mysql / frontend / python / watchdog / web`。

## 2. 报告事实修正

### 2.1 拓扑数字已过期

| 指标 | 报告（11-17） | 实测（2026-11-18） |
|---|---|---|
| `origin/ui` | `9d3c5317` | **`b805377f`** |
| `ui` 领先 `master` | 170 提交 | **239 提交**（`master` 相对 `ui` 领先 0） |
| `master` | `a0efaf46` | `a0efaf46`（未动） |
| `feat/iris21-multiagent-integration` | `9a6dbcb6` | `9a6dbcb6`（未动） |
| PR #87 | OPEN | OPEN、Draft |

影响：报告 §1.1 收敛提案里的「差异对账」必须在 `b805377f` 上重做，
不能沿用针对 `9d3c5317` 的结论。

### 2.2 `web/scripts/evidence/` 三个脚本「无外部引用」不成立

报告结论是这三个脚本（`admin-doc-preview-e2e.mjs`、`refine-shots.mjs`、
`visual-completion.mjs`）只在自身的用法注释里出现，可删。实测结果相反：

| 脚本 | 引用的 PR | PR 状态 |
|---|---|---|
| `visual-completion.mjs` | #69「Iris 2.0 · Visual Completion」 | CLOSED（Draft，未合并） |
| `refine-shots.mjs` | #74「账号菜单与会话交互精修」 | CLOSED（Draft，未合并） |
| `admin-doc-preview-e2e.mjs` | #76「知识库文档工作台预览」 | CLOSED（Draft，未合并） |

复核方法：`gh pr list --state all --limit 120 --json body`（85 个 PR 命中 3 处）。

**处理：不删。** 报告自己的删除条件要求「确认对应证据 README / 复跑不依赖它们」，
这三份 PR 正文把它们当作证据生成器引用；删掉会让历史证据描述指向不存在的脚本，
而留存成本只有 21 KB。将来要删，先在这三条 PR 上留下「脚本已入 history」的说明。

### 2.3 `docs/testing/iris-optical-logo-20261116/`

报告已注明「被已合并 PR #88 / #89 引用为验收证据，需证据 owner 签字」。
复核一致：仓库内零引用成立，外部引用确实存在（18 文件 / 591,017 B）。**不在本轮处理**。

## 3. 待 owner 决策（本轮不动）

| 项 | 报告位置 | 为什么不能自动做 |
|---|---|---|
| 分支收敛整体顺序 | §1.1 | 三条线的归属是产品决策；且需按 §2.1 的新拓扑重算对账 |
| `frontend/` + `verify.yml` 的 frontend job | §6.2 第 9 项 | 跨线共享：Python 线的 CI 仍依赖它，且其 `frontend/` 是 178 文件的不同版本。必须先撤 CI job 再谈删目录 |
| `docs/` 中 61 份逐字节相同图片 | §6.2 第 11 项 | 技术上安全（同 blob），但每份都被某轮评审 README 引用，需证据 owner 签字 |
| `docs/testing/iris-optical-logo-20261116/` | §6.2 第 3 项 | 同上；折中方案（删截图留 README）也需签字 |
| CSS 契约 §9 的三项待决 | PR #103 | 是需要拍板的规则取舍，不是代码问题 |
| Issue #81 标 `Fix pending merge` | §1.1 第 6 条 | 仓库管理动作，且语义取决于 #87 的合并计划 |

## 4. 复跑与回退

- 本台账与它引用的 PR 都不改运行时行为（#112 例外，见其正文的验证读数）。
- 删除类 PR（#106–#110、#114）逐条在正文里写了恢复方法：`git checkout <sha> -- <path>`。
- 需要重跑验证时：后端 `scripts/verify.sh`；`web/` 用
  `npm run typecheck && npm run test && npm run build && npm run lint`。
