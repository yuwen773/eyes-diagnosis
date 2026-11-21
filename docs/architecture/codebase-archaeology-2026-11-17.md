# Iris 代码库考古：架构演变、有意设计与历史包袱审计

| 项 | 值 |
|---|---|
| 报告日期 | 2026-11-17 |
| 审计对象 | `D:\Work\code\eye-diagnosis\.claude\worktrees\system-config` |
| 审计基线 | `feat/system-config-center` @ `3c302504`（`docs(config-center): 加入系统配置中心 PRD 与 WP-00 审计交付物`） |
| 分支位置 | 从 `ui` 线 `f42065e4` 切出；`merge-base(HEAD, master) = a0efaf46`；HEAD 领先 `master` **170** 个提交 |
| 方法 | Git 全历史遍历（`git log --all` / `gh pr view` / `git merge-base --is-ancestor`）+ 三条独立审计线（Git/PR 考古、决策文档对账、代码包袱实证）交叉验证。修订轮（2026-11-17）补充了 PR/issue 正文引用核对、Agent 运行时护栏核查、Git 对象体积测量与分支收敛拓扑 |
| 纪律 | 全程只读。所有"无引用"结论均先用 `git grep -n <模式> HEAD -- <路径>` 在 HEAD 上核对；未采信脏工作区的构建绿；未修改任何源文件。注意 `git grep` 只能证明"未发现指定模式的静态引用"，不能排除人工调用、动态调用、PR/issue 正文引用与外部工作流依赖——因此报告中的删除项一律表述为**候选**，实际执行前必须通过第 6 节的核验清单 |
| 修订 | 2026-11-17 第二轮：根据独立审查意见修订六处（删除风险措辞、Agent 护栏、安全治理、分支收敛、Issue #81 状态、体积统计与清理收益）。2026-11-18 第三轮：新增 §4.4 样式体系审计（Custom CSS-first + Tailwind v4 辅助、Cascade Layers 风险与混合体系路线） |

---

## 0. 执行摘要

1. **这份代码库的包袱主要不在代码，而在叙事。** 真正的死代码很少且多为低风险配置/依赖；最大的三块——`frontend/`、约 148 MiB 截图证据、大量"待办/规划中"设计文档——都是**有意保留的历史记录或跨线共享资产**，删除收益远小于踩空风险。
2. **真正该做的是更新文档状态表**：`DESIGN.md §7/§8` 与 `docs/design/iris-2-rule-change-matrix.md` 里大量"PR #52 未合并 / 令牌取不到 / 管理端仍是旧外观 / U1·U5·U6 规划中"的条目已被当前代码推翻；冻结记录的 tip 与例外清单也不自洽。这两件事不改一行产品代码，却能让后续所有"这算不算冻结面 / 还要不要合 PR #52"的判断不再踩空。
3. **"当前主干"不是一个点，而是一片分叉的森林。** 任何"可安全删除"的判断都必须先限定在哪条线上——很多"包袱"在另一条线是活的。第 1.1 节给出可执行的分支收敛方案。
4. **本报告是静态审计，不是删除许可。** 所有删除项都是"候选"，均需按第 6 节逐项核验用途、所有者、测试与回退方法，并在删除后实际跑编译、测试、迁移与端到端兼容性验证。
5. **安全相关遗留需要治理计划而非仅登记**：MD5→BCrypt 迁移路径、细粒度权限、Provider/API Key 保护与 CSRF 风险都要按第 5.1 节的实际认证载体判断，不能只凭"缺注解"下结论。
6. **样式体系是 Custom CSS-first + Tailwind v4 辅助，不是 Tailwind-first**（§4.4）。令牌桥接在 `origin/ui` 已存在，但业务页面实际 utility 只有 `sr-only`（7 处），20,975 行手写 CSS 全无 `@layer`。真正风险是 Cascade Layers 优先级不一致，建议先做 CSS Architecture Audit，再走"混合设计体系"路线，不做全面 utility 化。

---

## 1. 前提纠正：三条"已知背景"与实测不符

在讨论包袱之前，必须先纠正三条会误导判断的背景说法。

| 背景说法 | 实测结果 | 证据 |
|---|---|---|
| "Java 线 = master，Python 线 = feature/python-backend，不再互相合并" | **成立，但"去 Java"只发生在 Python 分支**：`63931d7b`（移除 Java 活跃资产）、`3eff1639`（archive tag）、`a0756cc9`（分叉约定）全部只在 `feature/python-backend` 上；master 从未删除 Java。双线 fork point = `d74784ea`（2026-07-26） | `git branch -a --contains 63931d7b` → 仅 Python 线；`git merge-base master feature/python-backend` → `d74784ea` |
| "PR #68 已合并但生产未启用" | **PR #68 至今仍是 DRAFT / OPEN**：`state: OPEN`、`mergedAt: null`。其后端内容经 `d0f6b59e`（2026-11-15 "merge(backend): 合入 PR #68"）只进入 `feat/iris21-multiagent-integration` 线，**不在 master**。CLAUDE.md 写"主线 PR #68"是规划语义，不是已合并事实 | `gh pr view 68 --json state,mergedAt`；`git merge-base --is-ancestor d0f6b59e master` → `NO` |
| "UI 冻结后 tip 6ae633b8" | tag `iris-ui-v2.1-freeze-20261115` @ `80f53f7f` 成立；#88–#90 后有**第二枚 tag** `iris-ui-v2.1.1-optical-20261116` @ `6ae633b8`；`origin/ui` 已到 `9d3c5317`，本地 `ui` 另有评审线 `cf9e9351` | `git tag -l`；逐个 `git log -1 <ref>` |

另有一条重要的方法论纠正：**真正的 `git revert` 提交：0 条**。`git log --all --grep='^Revert\|^revert'` 的唯一命中 `d74784ea` 是 PR 正文里"tried and reverted"的叙述，属假阳性。大量**关闭态 PR 不是被放弃**——R2.5（#61–#67）、Visual Completion（#69–#72）、Admin（#73–#77）的内容都经集成 PR（`release/iris2-r2-5-integration` / `382ec512` / `c4842d93` / `86332427`）合入了。只看 `gh pr list` 的 CLOSED 会系统性误判。

还有一个必须掌握的分叉事实：本工作树领先 `master` 170 个提交且**完整包含 master**；`algorithm/` 与 master 逐字节一致（`git rev-parse HEAD:algorithm == master:algorithm`）。仓库里同时有 7 条活跃分支与 HEAD 相差 100~1800 个文件，其中多 Agent 分支 `6ba65478` 与本基线分叉 533 文件 / +68,725 行。

### 1.1 分支收敛方案（待决策，非既成事实）

**核心问题**：Iris 下一阶段以哪条线作为实际集成基线？报告只描述分叉是不够的，以下给出可执行的收敛提案。

**当前拓扑（2026-11-17 实测）**：

```
d74784ea (2026-07-26 双线 fork point)
├── master            a0efaf46  (11-10, #42 — 停在此处，落后 ui 170 提交)
│   └── feature/python-backend  c7b1b88e  (已"去 Java"，不再互合)
└── ui                cf9e9351  (11-16 本地 tip；origin/ui = 9d3c5317)
    └── 6ae633b8 (tag iris-ui-v2.1.1-optical-20261116)
        └── f42065e4 → 04ff3ed0 → 3c302504 (本工作树，+配置中心 PRD/WP-00)
    │
    └── feat/iris21-multiagent-integration  9a6dbcb6 (11-17 tip, PR #87 OPEN → ui)
        ├── d0f6b59e : PR #68 后端内容已合入此处（非独立分支）
        └── 290d6f15 : PR #93 已合入此处（11-17 MERGED）
            └── codex/iris-roundtable-3 3cad9514 / codex/realtime-* 等评审线
```

**祖先关系 ≠ 功能内容等价**（必须区分的两件事）：

| 事实 | 证据 | 含义 |
|---|---|---|
| `d0f6b59e`（PR #68 后端内容）是 `290d6f15` 和 `feat/iris21-multiagent-integration` 的**祖先** | `git merge-base --is-ancestor d0f6b59e 290d6f15` → YES；对 `feat/iris21-multiagent-integration` 同样 YES | #68 内容**已经**在 #87 线上，不应把 #68 当作独立分支再合一次 |
| `290d6f15` **不是** `codex/realtime-product-acceptance`（#68 的 head 分支 tip `10173ae9`）的祖先 | `git merge-base --is-ancestor 290d6f15 codex/realtime-product-acceptance` → NO | #68 这条 head 分支与集成线已经分叉，直接"再合 #68"会把旧状态的提交重新引入，产生重复/冲突 |
| PR #93 的 base = `feat/iris21-multiagent-integration`、head = `codex/iris-roundtable-3`，状态 MERGED（11-17 09:27Z） | `gh pr view 93` | Roundtable 内容已进入 #87 线，不是独立待办 |
| PR #87 base = `ui`，状态 OPEN；`feat/iris21-multiagent-integration` tip 已有 11-17 的 `app.css` 冲突记录 | `gh pr view 87`；`9a6dbcb6` commit message | #87 合并存在已知冲突，**合并≠验收通过** |

**建议的收敛顺序（需人批准，本报告不擅自执行）**：

1. **确定唯一集成基线**：以 `feat/iris21-multiagent-integration`（#87 线）为功能集成主干，`ui` 为 UI 冻结基线。理由：它已包含 #68 后端内容 + #93 Roundtable 内容，是唯一同时承载两条工作流的线；`master` 只作 Java 线发布快照，不再作为集成起点。
2. **差异对账（合并前必做）**：对 `HEAD`（配置中心基线）与 `9a6dbcb6`（#87 tip）执行 `git diff --stat` 与逐目录对账，重点核对三处已知重叠：`application.yml` 配置项（尤其 WP-00 M1–M5 涉及的键）、`db/migration/` 版本占用（V18–V28）、`web/src/styles/app.css`（#87 线已记录冲突）、`WebFilter` / `SameOriginFilter`（配置中心 PRD 的安全前提）。
3. **配置中心改挂到收敛后的基线**：本分支 `3c302504` 只含文档，无代码冲突风险；但 WP-00 审计结论明确"只对 `f42065e4` 成立"，合并后必须在 `9a6dbcb6`（或其后继）上重跑 CFG-AUDIT-01/02，再把 PRD 从"待评审"推进。
4. **冲突处理顺序**：先解 `app.css`（UI 冻结面，需例外授权），再解迁移版本（V29 起或重新编号），最后解配置项；每步保留可回退 tag。
5. **失败回退策略**：每一步合并前打 annotated tag（如 `pre-integration-<date>`）；若验收失败，用 `git revert -m 1 <merge>` 回退合并提交（本仓至今无 revert 先例，但这是回退合并的正确做法），不 force push、不重写已发布历史。
6. **Issue #81 的状态语义**：维持 OPEN 是合理的，标注为 **Fix pending merge**——待 #87 合入目标分支且三条 smoke 在目标分支验收通过后关闭（见第 2 节末尾的修正）。

> 注意：上述是**提案**。三条活跃线（`ui`、#87 集成线、`master` / Python 线）的最终归属涉及产品决策，必须由人确认后才能执行合并。

---

## 2. 架构演变时间线

| 日期 | hash / PR | 事件 | 架构影响 |
|---|---|---|---|
| 2026-04-23/24 | `dd66e872`, PR #1 | MCP 服务入库；删除 `sys.path workaround` | 有意清理早期补丁 |
| 2026-07-23 | `a0e56a0f`/`45a57895`/`13a6aac5`/`c04ee1ac` | Flyway 引入、上传状态机 + 补偿、BCrypt、SSE 兼容 `tool-confirm` 与历史 `mcp-confirm` | 基础设施成型；**首个明确的历史数据兼容补丁** |
| 2026-07-24/25/26 | PR #2–#6；`d74784ea` | P2-01r OOF 完整性修复 + P2-02a 稳定性探针 / watchdog | **双线 fork point** |
| 2026-07-28 / 08-07 | `v1.0.0-rc1`@`0a664f64`；`release/v1.0.0`@`5ac742f0` | Java 线发布候选与工作流 C1 | 现为陈旧发布工件（落后 master 122 / 领先 27） |
| 2026-10-12→10-18 | `0a098db1`…`63931d7b`…`a75fe048`；tag `archive/java-before-python-retirement-2026-10-17`@`3eff1639` | Python 线：FastAPI 兼容基线 → 工作流 → **"去 Java"**（仅 Python 线移除 Java 活跃资产） | 双线分叉的实质起点；Java 资产以 tag 封存而非 revert |
| 2026-10-19/20 | PR #9/#10/#11/#12/#13 | 死文件清理、Phase 3 sub-style B、测试审计修复、CI 接线（Python 线） | 前端大扫除；Phase 3 后随 Vue 弃用而作废 |
| 2026-11-04 | `f06b2994`（master）/ `a0756cc9`（Python 线） | **同一份 `docs/backend-split.md` 在两条线各提交一次** | "共享目录人工搬运"范式的活证据 |
| 2026-11-06/08 | `0786f764`（WIP: preserve working tree）、`f5c9fb15`（图片上传去重与回滚） | 远程合并前的应急 WIP 提交；上传回滚是业务能力而非 revert | 唯一一条字面 WIP 补丁提交 |
| 2026-11-09/10 | PR #32–#40 | 后端缺陷票收口、新闻生命周期建模 `4a3f0ac`、患者/医生协作流程 | 写路径与状态词汇变更，直接触发后续前端适配 |
| **2026-11-10** | `5dbef3cb`（web subtree @`917c7cd`）、`b00eda27`（CI 移根）、PR #41、PR #42 | Vue `frontend/` 标弃用；`web/` 以 subtree 入仓；CI → 根 `verify.yml` 的 web job；React 适配新闻生命周期 | **产品前端主线切换**（结构性迁移，非补丁）。#42 用"历史快照横幅"保留被 `4a3f0ac` 推翻的旧文档，是有意保留历史 |
| 2026-11-12/13 | PR #52/#53/#60；#61–#67（R2.5 栈）；#68（DRAFT）；#69–#72 | 账号隔离 P0 + Iris 2.0 四场景设计真源；R2.5 共享外壳；多 Agent 运行时；视觉大改 | 多数 PR 显示 CLOSED 但内容经集成 PR 合入，非丢弃 |
| 2026-11-13 | `3778987c`；PR #73/#74（经 `c4842d93`）；PR #75–#77（经 `86332427`/#78） | **Flyway V15–V17 冲突整合、V18–V27 重排冻结**；图标治理 / 账号卡；管理端预览套件 | 冲突源于双线各自改迁移；冻结是明确的止血设计 |
| 2026-11-14/15 | PR #78/#79/#80/#82/#83/#85/#86；`ea257d37`/`95beeef6`；tag `80f53f7f` | 管理端七页精修；**UI 冻结 tag + #85 冻结记录**；#86 恢复四条冒烟 | 冻结基线；之后一般优化登记 Issue |
| 2026-11-15/16 | `d0f6b59e`、`a970602b`；PR #87（DRAFT）；#88–#91；tag `6ae633b8` | PR #68 后端与 React 协作台分别合入**集成分支**（非 master）；受理游标竞态修复 + Issue #81 冒烟真实化；光学标 / 画布 / Prism + 滚动条进 ui | 多 Agent 内容长期停留在独立线；本工作树即从 #90 切出 |
| 2026-11-16 | `3c302504` | 配置中心 PRD + WP-00 审计（8 文件 / +2005 行） | 主动的收敛设计，不是补丁 |
| 2026-11-17 | PR #93（MERGED 到集成分支 `290d6f15`）；#92/#94/#95（DRAFT） | Roundtable 3.0 工作台 + 折叠导航管理员入口补齐 | 集成分支继续演进；ui/master 未动 |

### 真正停留在草案、从未落地的工作

- **PR #14**：Java 多智能体架构 v3 设计稿，OPEN/DRAFT 自 11-05，无后续合入。
- **PR #7**：P2-02A T3/T4 矩阵 + P2-02B epoch runner，CLOSED 未合并；只有后续 #8 的 fold-0 smoke 合入。
- **Issue #81**（三条 Playwright smoke 失败）至今 OPEN（`gh issue view 81` → `state: OPEN`、`closedAt: null`）。**这不是状态失同步，而是合理的流程状态**：对应修复所在的 PR #87（`base: ui`，`state: OPEN`）尚未合入 `ui`。若团队执行"合并并验收后才关闭 Issue"的规则，保持 OPEN 是正确的。正确标注为 **Fix pending merge**——待 #87 在目标分支完成 CI 与验收后关闭。Issue 正文所列的三个失败（`.chroma-card` 选择器漂移、依赖特定账号数据、依赖外网 LLM）均已确认属测试维护问题，不是产品缺陷。

---

## 3. 有意设计（仍成立，不要动）

| 设计 | 证据与说明 |
|---|---|
| **双后端线并行、拒绝自动合并** | `docs/backend-split.md` 明确"不再互相合并、共享目录人工搬运、生产切流独立决策"，把 ADR 0001 的"完全 Python 化"目标改为暂停执行。两条线在 11-04 各提交一次同一份文档，是这一范式的活证据 |
| **Vue 弃用 / React 产品化** | PR #41 明确"deprecated 2026-11-10 起、保留可运行以便回溯"；`web/` 经 subtree 入仓，CI 统一到根 `verify.yml`。`frontend/README.md:1-8`、`frontend/package.json:4`、`docs/backend-split.md:50-56`、`docs/design-system.md:1-7` 口径一致 |
| **Iris 2.0/2.1 设计系统与冻结流程** | PR #53 四场景 + 组件矩阵；`web/src/components/shell/` 只有 `ProductHeader.tsx`，无第二套顶栏；三套语义色互不顶替（`tokens.css:47-65,182`）；双主题与纸面原语不翻转（`DESIGN.md §3.2`、`tokens.css:27,607`）。**冻结作为规则仍被各方执行**——配置中心 PRD/ADR 据此申请解冻例外 |
| **Flyway 纪律** | 12 个迁移文件 = V1–V9 + V15–V17，与 `docs/flyway-migration-history-plan.md` 一致，无重复版本号 / 重复 SQL；V10–V14 空号是给其他分支预留（V17 头注明）。MySQL 5.7（3306）忽略 CHECK、域值在 Java 守——本机 3306 仍是 5.7.19，约束真实 |
| **配置中心"代码注册真源 + DB 只存值"** | ADR D1（`:20-35`）明确否决 DB schema 与自动导入 Spring Environment，与 `CODING_STANDARDS.md`"一个概念一个真源"一致，不制造第二真源。WP-00 确认"运行时可动态解析的配置 = 0"是真实痛点，PRD 立项理由成立 |
| **冻结面需单独解封** | PRD:7/120/645、ADR D10:178-188、`configuration-boundary.md:128`、`phase0-review.md:122` 对 `AdminNav` 第七项、`index.html` title/favicon、品牌 Provider 接入三处均写明"仅记录申请范围，不构成批准"。已核实 `AdminNav.tsx` 当前恰为 6 项、无 settings 路由，前提成立 |
| **`@AuthCheck` 只有 user/admin 两档** | `config-center-adr.md:114`、`configuration-boundary.md:131`；代码确认无 CSRF / SameOrigin / 细粒度权限。这是 PRD 立项理由之一，约束真实 |

---

## 4. 历史遗留（保留但已弃用 / 陈旧）

### 4.1 弃用但仍存活的目录

**`frontend/`（121 文件 / 1,010,099 B）** —— 最大单项，但不是"本工作树无引用"，而是**活耦合**：

- `verify.yml:153-168` 的 `frontend` job 仍跑 `npm ci → lint:check → test --run → build`；而弃用提交 `27357eea` **反而新增了 `lint:check`**（`git show 27357eea -- .github/workflows/verify.yml` 可证）。`pom.xml` 无 frontend-maven-plugin、无 dist 拷贝，`web/` 源码零 import——删目录的唯一硬阻塞就是 CI job。
- 跨线更麻烦：`feature/python-backend` 持有**178 文件的不同版本**（重构前，旧青绿 `#1b7f6b`），其 CI 还做 `git diff --exit-code -- frontend/src/api`（`feature/python-backend:.github/workflows/verify.yml:45-47,132`）。`docs/backend-split.md:34,46-56` 明确写共享目录各持一份。
- `frontend/package-lock.json`（315,186 B，占该目录 31%）被 `verify.yml:164` 的 `cache-dependency-path` 点名，只能随整个目录一起处理。

**陈旧发布工件**：`release/v1.0.0`、`v1.0.0-rc1`，均落后 master 122 / 领先 27~23 个提交。

**双线重复资产**：本线 `src/main/proto/diagnosis.proto` vs Python 线 `contracts/diagnosis.proto`；Python 线 `.scratch/auto-accept-20261018/` 验收日志。

### 4.2 陈旧文档本身是包袱（最值得清理的一类）

`docs/README.md:3` 自己写着"过期文档就地删除，不要在别处复述"，但没有被执行：

| 陈旧条目 | 来源 | 被什么推翻 |
|---|---|---|
| "`--brand-*` / `.iris2` / `--radius-xl\|2xl` 只在 PR #52，尚未进入 `ui`"、🅿 表"取不到令牌" | `DESIGN.md:26,1299-1302,1353`；`docs/design/iris-2-rule-change-matrix.md:9,84,107`；`iris-2-implementation-roadmap.md:29-40` | 令牌在 `tokens.css:91,119-120,182,457` 已定义；相关 PR 全已合入。**这是最大包袱**：会误导读者"开发前先合并 PR #52"。冻结条自己也承认"解冻时先按当前代码核对 §8"（`DESIGN.md:72`） |
| "管理端仍是旧 B 档 0 圆角、墨色主按钮"、Purple SaaS 🗓 规划中 | `DESIGN.md:1324,1358` | `tokens.css:149-152` 有 `--admin-primary:#6d28d9`，`admin.css:12,76,171` 用 8–12px 圆角，7 页与 6 项 AdminNav 已落地；同文档头部 2026-11-13 条已自相矛盾 |
| U1/U3/U5/U6 仍 🗓；"页脚策略不一致（仅首页有品牌页脚）"待办 | `DESIGN.md:1325-1351` | §8 自己把 U6 "认证页橙色 LaserFlow"标"已修"（`:1356`），代码 grep `LaserFlow` 零命中；U5 新闻页标已修（`:1349`）；§1.6.2:232-244 已定义四档页脚，R2.5-01 已落实 |
| "`npm run lint` 应进 CI，本机 `npm ci` 未完成、基线未验证" | `CODING_STANDARDS.md:43` | `verify.yml:190` 已有 `npm run lint` 硬门，注释 `:174` 明写"lint 自 B3 批次起是硬门，不再 continue-on-error"。约束已消失 |
| `IRIS_2_DESIGN_REFERENCE_BRIEF` "当前起点 `ui@4039ad7`、PR #52 head `22b159d` 未合并" | 同文件 `:16,102` | 文首 `:9-10` 已自行加注是编制快照，属低危包袱 |

### 4.3 冻结记录内部不自洽（需人工裁定）

- **规则正文**：`DESIGN.md:50-72`——冻结基线 tag `80f53f7f` @ 2026-11-15 13:03；**冻结后主动视觉迭代停止、一般优化登记 Issue #84、例外仅限阻断性故障与安全修复**。
- **事实**：冻结后（同为 11-16）发生了 `04ff3ed0`（落地页首屏换 Prism，删 1747 行 / 加 923 行）与 `f42065e4`（全站统一自定义滚动条）——两笔**主动视觉迭代，无例外记录**。二者均已用 `git merge-base --is-ancestor iris-ui-v2.1-freeze-20261115 <commit>` 确认是冻结 tag 的后代。记忆只为 #88–#90 记录了用户放行。
- 另有文档写"此后 `ui` 只前进到文档合并 `7ec746fb`"，与 `ui` 实际已到 `6ae633b8` 再加提交直接冲突（该表述实际留存在 `docs/testing/ui-multiagent-baseline-sync-20261115-ui.md:5,37` 等集成线文档中，`DESIGN.md` 当前版本已无此句，属记忆表述偏差）。
- **判断**：冻结作为"一般优化需登记 Issue"的规则仍被各方当作有效约束，但冻结记录里的 tip / 例外清单已陈旧、不自洽。需补一份自洽的例外清单，否则后续"冻结面判定"会继续踩空。

### 4.4 样式体系双轨：Custom CSS-first + Tailwind v4 辅助（新增审计）

> 本轮新增审计。用户提供的判断（Custom CSS-first + Tailwind v4 辅助，而非 Tailwind-first）经实测**成立**。这里记录可复核的证据、真实风险面与建议路线。注意本工作树 HEAD 是 `f42065e4`，比用户核对的 `origin/ui`（`9d3c5317`）旧，Tailwind 令牌桥接只存在于 `origin/ui`。

**实测事实（HEAD 与 origin/ui 对照）**：

| 维度 | 实测 | 证据 |
|---|---|---|
| Tailwind 安装 / 构建 | `tailwindcss@^4` + `@tailwindcss/vite@^4` + `prettier-plugin-tailwindcss@^0.8.1`，Vite 插件已接入 | `web/package.json`；`web/vite.config.ts:2,8` `plugins: [react(), tailwindcss()]` |
| Tailwind 加载 | `web/src/index.css:1` `@import "tailwindcss"` | HEAD 与 origin/ui 一致 |
| 令牌桥接 | **仅 origin/ui 有**：`index.css:25-37` 的 `@theme inline` 映射 12 个语义色（`--fg`、`--surface`、`--brand-primary`、`--admin-primary`、`--signal`、`--risk-*` 等）；本工作树 HEAD 无此块 | `git diff HEAD origin/ui -- web/src/index.css`；`git show origin/ui:web/src/index.css` |
| 深色主题 | **仅 origin/ui 有**：`@custom-variant dark (&:where(.dark, .dark *))`，把 Tailwind 默认 `prefers-color-scheme` 改绑到 `html.dark` | 同上 `:18` |
| shadcn 配置 | `web/components.json` 存在（`style: base-nova`、`css: src/index.css`、`tailwind.config: ""`），但**不代表页面采用 Tailwind 组件体系** | 对照实际组件类名 |
| Utility 使用 | 业务页面实际使用的 Tailwind utility **只有 `sr-only`（TSX 中 7 处）**；无 `flex`/`grid`/`p-*`/`gap-*`/`text-sm`/`dark:`/`hover:`/`md:` 等。类名几乎全是 `.form`、`.field`、`.news__meta`、`.admin-btn`、`.readout__value` 等手写语义类 | 全仓扫描 171 个 TS/TSX 文件；`sr-only` 静态计数 7（另 `app.css:102` 自定义了同名 `.sr-only`，故 `git grep` 全词计数为 8） |
| 手写 CSS 体量 | HEAD 25 个 CSS 文件 / **20,975 行**，`origin/ui` 同法实测 29 个 / **23,154 行**（`web/scripts/audit/css-boundary-audit.mjs` 可复跑）；`app.css` 4,545 行、`admin.css` 3,983 行、`agent.css` 1,902 行、`admin-redesign.css` 1,884 行、`brand.css` 1,418 行 | Python 逐文件统计（排除 `.r2-baseline`、`node_modules`、`dist`） |
| CSS 分层 | **无任何 `@layer { }` 块声明**（HEAD 与 origin/ui 均是）；手写 CSS 全部未分层。唯一的分层用法是 `fonts-subset.css` 两条 `@import … layer(fonts)`，只作用于字体、不改变业务规则的层叠顺序 | `git grep -n '@layer ' HEAD/origin/ui -- 'web/src'` → 空；`git grep -n 'layer(' …` → 仅字体导入两行 |

**Cascade Layers 风险核实（用户指出的重点，成立）**：

Tailwind v4 的 utility 位于 `@layer utilities`。按 CSS 层叠规则，**未分层声明优先于已分层声明**（同等来源、同重要性），因此：

```css
/* 未分层（Iris 手写 CSS） */
.iris-card { padding: 16px; }
/* @layer utilities 里的 p-8 */
```

`<div className="iris-card p-8">` 中 `p-8` **不会**按直觉覆盖 `.iris-card` 的 `padding`。这不是 Tailwind 失效，而是两套体系没有统一分层。注意限定：该规则针对冲突的普通声明；`!important` 有另一套优先级机制，"手写 CSS 永远压过 utility"的绝对化说法不准确。目前全仓没有任何 `@layer`，所以这个风险是**结构性的、尚未爆发的**——因为几乎没有业务代码真的混用 utility 与手写类，一旦开始混用就会踩到。

**判断与路线**：Iris 现在是 **Custom CSS-first + Tailwind v4 辅助**，令牌桥接已存在（origin/ui），但 Tailwind 的工程收益尚未充分体现。这不一定是坏事——项目有成熟令牌、复杂光学品牌视觉、管理端 SaaS 组件、医学影像和 Agent 工作台，不适合全量 utility 化。三种路线中推荐 **B：混合设计体系**：

```
Iris Design Tokens（唯一语义真源 · Light/Dark/Brand/Admin）
        ├── Tailwind v4：布局、响应式、间距、简单状态 utility
        └── Iris CSS：语义组件、复杂视觉、品牌动效
                  ↓
      Iris Product UI（用户端 / 管理端 / 影像判读 / Agent 协作）
```

具体约定（建议，需团队确认后写入 `DESIGN.md`）：简单布局优先 Tailwind；跨页复用业务组件优先 Iris 自有组件；复杂光学视觉 / 医学影像 / 动画保留专属 CSS；语义颜色只能从 Iris 令牌获得；**需要被 utility 覆盖的组件样式逐步放入 `@layer components`**；不强制迁移老代码，**更不允许一次性把全部 CSS 包进 `@layer`**（会改变已有覆盖关系，回归风险不可控）。

**2026-11-18 增补**：审计已从手数变成可复跑的工具——`web/scripts/audit/css-boundary-audit.mjs`（`cd web && npm run check:css-boundary`），输出 utility 计数、混用明细、CSS 分层与 `!important` 统计；职责边界规则见 `docs/architecture/css-architecture-contract.md`（提案，未生效）。

**优先级**：先做一次 **Tailwind / CSS Architecture Audit**，不要马上重构。审计范围应包括：逐页 utility / 手写类混用矩阵、`@layer` 引入的分层迁移路径、双主题 + `.is-admin` 上下文下的 utility 取值验证、以及视觉回归测试缺口（当前仅 `web/scripts/evidence/visual-completion.mjs` 一个证据脚本，无自动化 CSS 回归）。

---

## 5. 为解决已不存在 / 已迁移问题引入的补丁

| 补丁 | 历史用途 | 现状核实 | 判断 |
|---|---|---|---|
| `c04ee1ac`（07-23）SSE `mcp-confirm` → `tool-confirm` | 旧事件名兜底 | **仍活跃**：`ChatHistoryService.java:86` 至今写 `"mcp-confirm"`；`AgentMessageMapper.java:13` 排序 CASE 仍引用；`web/src/lib/agentStream.ts:130-134` 双 case 映射，测试 `agentStream.test.ts:68-89` 钉住；`docs/superpowers/plans/2026-11-08-react-agent-page.md:606` 明确"DB 存量 subType=`mcp-confirm` 的消息" | **不能删**——不是假想问题 |
| `8e9a2cd0`（10-13）兼容旧会话空子类型 | Python 线去 Java 后的消息形状回归 | 只在 Python 线，master 不含 | 需 DBA 确认生产存量会话后定 |
| `f253489f`（11-14）历史工具卡兼容 | PR #68 集成 | 只在集成线，有测试保护 | 随 PR #68 一起决策 |
| `hash-algorithm` 配置（`application.yml:92`） | 曾可配哈希算法 | `git grep hash-algorithm HEAD -- ':!docs'` 仅此一行；代码硬编码 `SHA-256`（`DiagnosisServiceImpl.java:394`、`DocumentProcessingService.java:47`、`DocumentParser.java:59`） | **死配置**，WP-00 M3 |
| `agent.max-iterations` / `model-call-limit` | Agent 迭代 / 模型调用护栏 | `AgentConstants.java:12-13` 定义；类有 **3 个注入点**（`DiagnosisAgent.java:85`、`ChatMessageWriter.java:35`、`AgentController.java:45`），但这两个字段**无人读取**。实际读取的是 `getHistoryTruncateLength/Reserve`（`ChatMessageWriter.java:99-100`）与 `getMaxHistoryPageSize`（`AgentController.java:106`）。进一步核查 `buildAgent()`（`DiagnosisAgent.java:93-104`）未设置任何迭代 / 递归 / 步数上限，SSE 流（`:130` 起）也无 Flux 级 timeout 或取消传播；全仓仅 MCP 工具调用有 30/60s 超时（`MCPManager.java:42,150`） | **不可当普通死配置删除**。这可能是一个真实缺失的护栏：重复工具调用、Token 消耗失控、任务无法终止都有可能发生。必须先核实运行时是否已有其他有效限制（框架默认值、调用次数、执行时长、Token 预算、取消机制）；若没有，应**补齐有效护栏并接线**，而不是仅删除配置。WP-00 M5 的建议"删除或接线"中，**接线优先** |
| `rag.evaluation.enabled` | RAG 测试开关 | `application.yml:119-120` 无消费者；实际门禁是 `RUN_RAG_EVALUATION_TESTS`（`RAGEvaluationTest.java:18`） | **死配置**，WP-00 M4 |
| Chroma `tenant-name` / `database-name` | 旧向量库配置 | `application-server.example.yml:33-34` 无消费者，`VectorStoreConfig.java:41-42` 硬编码 | **死配置**，WP-00 M2 |
| `caffeine` 依赖（`pom.xml:144-146`） | 旧 Spring Cache 方案 | `git grep -E "Caffeine\|@Cacheable\|@EnableCaching\|CacheManager" HEAD -- 'src/**/*.java'` → 0 命中；yml 也无相关配置；缓存实走手写 ConcurrentHashMap + Redis | **可删**（先跑 `mvn dependency:analyze`） |
| `shadcn` / `class-variance-authority` / `tw-animate-css` | 早期 shadcn 脚手架 | web 源码零引用（`git grep -l -F <dep> HEAD -- 'web/src/**'` → 0）；`cn` 来自独立 clsx/tailwind-merge 封装，不是 cva；但 `web/.prettierrc:10` 仍配 `"tailwindFunctions": ["cn", "cva"]` | **可删**（连带 `.prettierrc` 的 `cva`） |
| `setup-github-facade.sh` + 测试 + `docs/social-preview.png`（1,076,747 B） | 2026-06 一次性 GitHub 门面设置（切默认分支、上传 Social Preview、设 topics） | `git grep setup-github-facade HEAD -- '.github/**' 'scripts/verify.sh'` → 无；入口文档无引用；只在一次性任务记录 `docs/superpowers/plans/2026-06-29-github-facelift.md` 里；脚本里 `vue3` topic 已过时；图已上传到 GitHub | **可删** |
| 16 个 Java 文件的 `* @Description TODO` | 建类 Javadoc 模板占位 | `git grep -n "@Description TODO" HEAD -- 'src/main/java/**'` → 16 处，从未填写，纯注释 | **可删**（零行为影响） |

**先例**：`dd66e872`（2026-04-23）主动删除 `sys.path workaround`，说明这类补丁在本仓有被主动回收的先例。

### 5.1 安全遗留的治理计划（不能只登记"不能删"）

第 7 节把若干安全相关兼容路径标为"不能删"，这是对的，但保留只是起点，还需要可执行的治理。

**A. MD5 → BCrypt 存量用户迁移**

- 现状：`PasswordService.java:13-15,21,32-38` 保持双校验（BCrypt cost 12 优先；32 位 hex 走 legacy MD5，salt `"yuwen"`），命中 legacy 返回 `needsUpgrade=true`；`UserServiceImpl.java:140-147` 在登录成功后即时升级。`PasswordServiceTest.java:25-28` 覆盖。
- 待核查（需 DBA / 生产库只读查询，本报告未做）：**仍为 MD5 的存量用户数量**、 migrated 覆盖率、是否存在长期不登录因而永不升级的账号、是否已设强制重置策略、是否有升级成功率监控。
- 建议治理：设定迁移完成条件（如 MD5 账号占比阈值）；对超期未登录的 MD5 账号强制重置；给升级路径加日志 / 指标（升级次数、失败数）；达到阈值后移除 legacy 分支并补一次迁移核查。

**B. 权限模型与配置中心安全边界**

- 现状：基线只有 `@AuthCheck(mustRole=...)` 的 user / admin 两档（全仓 30+ 处使用），`config-center-adr.md:114`、`configuration-boundary.md:131` 已确认无细粒度权限。认证载体是 Spring Session + Redis（`application-server.example.yml:14` `store-type: redis`），Cookie 30 天（`application.yml:6-9`）。
- **CSRF 判断要基于实际载体，不能只看"缺注解"**：Cookie 承载的会话确实需要评估跨站请求风险，但可利用性取决于 SameSite 属性、CORS 白名单（`CorsConfig.java:11,18,28` 精确 Origin 白名单）、请求 Content-Type 约定与是否接受简单请求。**当前基线无 SameOrigin / CSRF 过滤器是事实，但是否存在可利用漏洞需要结合上述载体属性做专项评估**；多 Agent 分支新增的 `SameOriginFilter` 尚未合入，配置中心 PRD 已决定自带 Same-Origin 校验（ADR D11），合并后需收敛重复逻辑。
- 配置中心将管理 Provider、API Key、模型开关，这些是高价值目标。上线前应具备：**权限矩阵**（谁可查看 / 编辑 / 发布 / 回滚，MVP 暂用部署期 yml 白名单授予 userId 列表）、**操作审计**（谁在何时改了哪个键、发布 diff、回滚链）、**密钥保护**（`SECRET_REF` 只存 `env:NAME` 引用，永不存明文，且需轮转机制）。这三项在 ADR / API 契约中已有设计，但属于**上线门禁**，需在 WP-01/WP-04 落地时实证，不能因 WP-00 PASS 而放行。

**C. 其他在役兼容路径的退出条件**

| 兼容路径 | 退出条件（建议） |
|---|---|
| `mcp-confirm` 旧事件名（`agentStream.ts:130-134`、`ChatHistoryService.java:86`） | 生产库确认无 `subType='mcp-confirm'` 的历史消息，且所有活跃客户端已升级到 `tool-confirm` |
| `PasswordService` legacy MD5 | 见 A 节迁移完成条件 |
| `NewsLifecycleService:196` DRAFT→PUBLISHED | 前端发布路径完全统一为 `status=1` 且历史草稿清洗完成 |
| `AdminNewsEditPage` `legacyHtml` | 库中旧 HTML 文章全部转成新结构 |

---

## 6. 删除候选清单（按优先级，均非直接执行许可）

> **重要限定**：`git grep` 无引用只能证明"未发现指定模式的静态引用"，不能排除人工调用、动态调用、外部工作流、PR/issue 正文引用与历史审计依赖。以下所有条目都是**候选**，每一项在删除前必须逐条核验**用途、所有者、测试覆盖、外部引用与回退方法**，并在删除后实际跑编译 / 测试 / 迁移 / 端到端兼容性验证。

### 6.1 删除前的逐项核验清单（适用于所有档位）

| 核验项 | 具体动作 |
|---|---|
| 静态引用 | `git grep -n <模式> HEAD -- <路径>`；对 master / ui / feature/python-backend 各 ref 重复 |
| 外部引用 | `gh pr list --state all --json number,body` 与 `gh issue list` 中搜索路径 / 文件名——**已发现反例**：`docs/testing/iris-optical-logo-20261116/` 虽仓库内零引用，却被已合并 PR #88 / #89 的描述引用为验收证据 |
| 所有者 | `git log -1 --format='%an %ad %h' -- <路径>` 找到最近维护者并确认（本节 6.2 四组候选的最近提交者均为 `yuwen`） |
| 用途与测试 | 对照 `package.json` scripts、`scripts/verify.sh`、CI job、README / docs 索引；确认是否有对应的 smoke / 验收脚本 |
| 回退方法 | 删除前记录所在 commit 与路径，用 `git checkout <commit> -- <path>` 即可恢复；涉及多文件删除应先打 tag |
| 删除后验证 | 按影响面跑：Java → `scripts/verify.sh`；web → `npm run typecheck && npm run test && npm run build && npm run lint`；迁移 → Flyway 集成测试；端到端 → 相关 smoke |

### 6.2 低风险删除候选

| # | 候选 | 影响面 / 已核验证据 | 仍需核验 |
|---|---|---|---|
| 1 | 16 处 `@Description TODO` 注释行 | 纯注释，0 行为影响；最近改动 2025-10-15 | 无需额外测试；删除后编译一次确认 |
| 2 | `scripts/setup-github-facade.sh` + `scripts/tests/test-setup-github-facade.sh` + `scripts/tests/fixtures/expected-MIT.txt` + `docs/social-preview.png` | ~1.09 MB；CI / 入口文档零引用；只在一次性任务记录里；脚本里 `vue3` topic 已过时；图已上传到 GitHub；最近改动 2026-10-20 | 确认 GitHub 仓库侧 Social Preview 仍在用（删仓库副本不影响已上传图）；确认无人本地复跑该脚本 |
| 3 | `docs/testing/iris-optical-logo-20261116/`（18 文件，591,017 B） | 仓库内零引用；对 master / ui / python-backend 三 ref 同样 0；最近改动 2026-11-16 | **已被 PR #88 / #89 描述引用为验收证据**——需证据 owner 签字，或保留 README 只删截图；删前确认无外部审计链接指向该目录 |
| 4 | `web/scripts/evidence/` 中 3 个脚本：`admin-doc-preview-e2e.mjs`、`refine-shots.mjs`、`visual-completion.mjs` | 共 21,473 B；各自 basename 只命中文件自己的用法注释，package.json 11 条 script 无对应入口；最近改动 2026-11-13 | 确认本地无人习惯手动 `node scripts/evidence/<name>.mjs` 复跑；确认对应证据 README 不依赖它们重建 |

### 第 2 档 — 需同步 master/ui 或跑一次检查

| # | 目标 | 前置动作 |
|---|---|---|
| 5 | `hash-algorithm`、`rag.evaluation.enabled` 两组死配置 | 确认无外部运维脚本读取；master / ui 也有此键，需同步。**`agent.max-iterations`/`model-call-limit` 不在此列**——见第 5 节，应先核实 / 补齐运行时护栏，删除不是首选 |
| 6 | `pom.xml` 的 `caffeine` | 先跑 `mvn dependency:analyze` 排除传递依赖影响；删后跑 `scripts/verify.sh` |
| 7 | web 三个无用 npm 依赖 + `.prettierrc:10` 的 `cva` | 改后跑 `npm run typecheck && npm run test && npm run build && npm run lint`（双主题都验证，见 `web-react-dual-theme` 记忆） |
| 8 | `application-server.example.yml:33-34` Chroma `tenant-name`/`database-name` | 示例文件风险低，master / ui 同样有 |

### 第 3 档 — 本分支不单独决定，需跨线协调

| # | 目标 | 为何不能本分支单删 |
|---|---|---|
| 9 | **`frontend/` + `verify.yml` 的 frontend job** | 必须先撤 CI job（`verify.yml:153-168`），并与 master / Python 线同步删；Python 线 CI 仍依赖它，且其 `frontend/` 是 178 文件的不同版本 |
| 10 | `skills-lock.json`（7,239 B，根目录） | 唯一"被 gitignore 但仍被跟踪"的文件（`git check-ignore --no-index` 全量核对所得）；无消费者，但 master / ui / Python 线都跟踪它 |
| 11 | `docs/` 中 61 份逐字节相同图片副本（52 个 hash 组，10,019,292 B ≈ 9.56 MiB） | 技术上安全（同 blob hash），但每份都被证据 README 当作某一轮评审产物引用（r1 初版 / r2 功能复审重拍 / r3 视觉复审重拍），需证据 owner 签字，不能自动去重 |

---

## 7. 明确不要删（看似包袱，实际仍被引用）

| 目标 | 为什么不能删 |
|---|---|
| `agent/service/TitleGenerationService.java:46-53` | 名为 LLM、实为截断的占位实现（TODO 接 DashScope），但**是活行为**：`ChatHistoryService.java:36,50` 注入并调用 → `AgentController.java:183` → `web/src/lib/api.ts:237` → AgentPage。删了会断标题生成 |
| `security/PasswordService.java` + `UserServiceImpl.java:140,147` | legacy MD5（salt `"yuwen"`）+ 登录时升级 BCrypt，是**在役的存量用户迁移路径**，有 `PasswordServiceTest.java:25-28` 覆盖 |
| `service/NewsLifecycleService.java:196` DRAFT→PUBLISHED "兼容通道" | 前端"发布"按钮直接发 `status=1`，`NewsStatusTransitionTest.java:76` 明确注释不能打断 |
| `web/src/lib/agentStream.ts:130,191` 的 `TOOL_CONFIRM` / `tool-result`→`tool-response` 映射 | 为兼容存量数据保留，有活调用与测试 |
| `web/src/pages/admin/AdminNewsEditPage.tsx:218,316-317,358,512` 的 `legacyHtml` | 库里确有旧 HTML 文章，读写两侧都活，测试里 16 处 `LEGACY_HTML` |
| `MessageType.java:11` 的 `TOOL_RESULT`、`ChatHistoryService.java:81` 的 `saveToolResultMessage` | 看似"无调用者的死代码"，但正是已知缺口"SSE 不发 tool-response"的修复接缝 |
| 12 个 `src/main/resources/db/migration/V*.sql` | Flyway 校验与历史决定，一律 register-only；V10–V14 空号是预留 |
| `web/DESIGN.md`（10,644 B） | 不是根 `DESIGN.md` 的过时副本，是 `CLAUDE.md:124`、`web/src/styles/README.md:4` 点名的 web 速查真源 |
| `web/scripts/evidence/` 其余 20 个脚本 | 逐个 basename 检查都有 `docs/**/README.md` 引用 |
| `docs/assets/iris2/`（490 文件 / 33.1 MB）、`docs/design/admin-pages-polish/`（224 文件 / 47.6 MB）、`docs/design/admin-redesign-after/`（157 文件 / 25.7 MB） | 均为 HEAD 内 README 索引的验收证据，`docs/README.md:18-19,32-40` 明确"归档快照"定位；ui / 各 UI 分支也带同一份，删了会与 UI 分支分叉 |
| `docs/plans/*`（14）、`docs/superpowers/{plans,specs}/*`（19）、`docs/design-system.md` | 显式归档的实现计划 / 规格，`CLAUDE.md:52` 与 docs/README 说明历史资料有意保留 |
| 3 个中文名文件：`docs/眼科疾病知识库.md`、`docs/知识库使用指南.md`、`docs/plans/2026-04-22-agent-diagnosis移植设计.md` | 正经的知识库内容与迁移设计，不是 `.gitignore` 里提到的中文临时文档 |
| `application.yml:17` `spring.profiles.active: local,dev` | 这两个 yml 不在工作树（被 ignore、worktree 不继承），只存在于主检出目录且含真实凭据。这是环境事实，不是死配置，**不要"修"** |
| `algorithm/` 全部（177 文件 / 860,292 B） | 树 hash 与 master 完全一致，CI 实跑 `generate_proto.py` + 4 组 pytest。Python 线的大件（web/、requirements-web*、pyproject.toml、contracts/）**只存在于 `feature/python-backend`**，本工作树没有可删的东西 |
| `docs/backend-split.md` 里指向 `docs/python-worktree-progress.md` 等三个不存在的链接 | 指向另一条分支的文档，是有意的跨分支链接，不是断链垃圾 |

**规模参照（第二轮已校正）**：`git ls-tree -r -l HEAD docs | awk '{s+=$4} END {print s}'` 实测 **154,737,318 B**；按二进制换算约 **147.6 MiB**（154,767,553 B 亦约 147.6 MiB，之前报告中"151.6 MiB"的换算是错的），按十进制约 154.8 MB。注意 `du -cb | tail -1` 会误报 17.9 MB（那只统计最后一批 xargs）。

**清理收益必须重新解释**：Git 对相同内容有 blob 对象复用机制——工作树里的 61 份重复图片副本（52 个 hash 组 / 9.56 MiB）在 git 对象库里**只存一份**，删除工作树副本几乎不会减小远端仓库的历史体积。`git count-objects -vH` 实测：约 20,425 个 in-pack 对象、pack 体积 **1.11 GiB**，松散对象 241.79 MiB —— 体积大头在**提交历史与已删除文件的旧 blob**，不在当前 HEAD 的工作树。因此：

- 删除当前截图副本的收益是**降低工作树 / checkout 体积与认知负担**，不是减小仓库体积；
- 真正想减少仓库体积，需要另做**历史体积 / 对象分布 / 大文件溯源**分析（`git rev-list --objects --all | git cat-file --batch-check` 按大小排序、查找历史大 blob），并评估 `git filter-repo` / BFG 重写历史的代价——这会改写所有 commit hash，**属于高风险操作，本报告不建议执行**；
- 第 6 节所有候选的收益应按"工作树整洁度 / CI 成本 / 维护认知成本"衡量，不应按"节省 X MiB 仓库体积"宣传。

---

## 8. 建议行动（按投入产出排序）

1. **更新 `DESIGN.md §7/§8` 与 `docs/design/iris-2-rule-change-matrix.md` 的过期状态表**（第 4.2 节五条）。不改产品代码，消除"PR #52 未合并"这类误导。
2. **给 UI 冻结记录补一份自洽的例外清单**，明确 `04ff3ed0`、`f42065e4` 与 #88–#90 的授权依据，并统一 tip 表述（第 4.3 节）。
3. **先定集成基线，再谈清理**（第 1.1 节）。以 #87 线为功能集成主干、`ui` 为 UI 冻结基线；**绝不未经差异对账就把 #68 当作独立分支再合一次**——其后端内容已在 `d0f6b59e` 进入 #87 线，而 head 分支 `codex/realtime-product-acceptance` 与集成线已分叉。
4. **核实并补齐 Agent 运行时护栏**（第 5 节）。`maxIterations` / `modelCallLimit` 注入后无人读取，`buildAgent()` 与 SSE 流无迭代 / 超时 / 取消限制——先确认框架默认值与外部限制，缺失则接线实现，不要当作普通死配置删除。
5. **给安全遗留制定治理计划**（第 5.1 节）：MD5→BCrypt 存量用户核查与退出条件；配置中心的权限矩阵 / 操作审计 / 密钥保护作为上线门禁；CSRF 风险结合 Cookie + Redis Session 的实际载体做专项评估。
6. **按 6.1 核验清单处理低风险候选**（原"第 1 档四项"），逐项确认用途、所有者、PR/issue 正文引用、测试与回退方法；删除后按影响面跑编译 / 测试 / 迁移 / e2e 验证。**这是静态审计，不构成删除许可。**
7. **执行配置 / 依赖清理**（原第 2 档），每项前置动作不可省；WP-00 已登记 M2–M5，但 Agent 两项以第 4 条为准。
8. **`frontend/` 的处置单独立项**：跨 master / ui / Python 三线协调，先撤 CI job 再删目录；不要在本分支顺手删。
9. **Issue #81 标注 Fix pending merge**：#87 合入目标分支且 smoke 验收通过后再关闭，当前 OPEN 是合理状态。
10. **仓库体积另立专题**：如需减小远端体积，先做历史对象分布分析；删当前截图副本只降低工作树体积，不改变 git 历史。
11. **样式体系先审计、后治理**（§4.4）：先做 Tailwind / CSS Architecture Audit（utility 与手写类混用矩阵、`@layer` 迁移路径、双主题 utility 取值、视觉回归缺口），不马上重构；确认走"混合设计体系"后再把职责边界与优先级规则写入 `DESIGN.md`。

---

## 附录：核心证据命令速查

```bash
# 分支拓扑
git rev-list --left-right --count master...HEAD
git merge-base HEAD master && git merge-base HEAD ui
git log --all --graph --date=short --pretty=format:'%h %ad %d %s'

# PR 状态与分支收敛
gh pr view 68 --json number,title,state,mergedAt,closedAt,baseRefName,headRefName
gh pr view 87 --json number,state,mergedAt,baseRefName,headRefName
gh pr view 93 --json number,state,mergedAt,baseRefName,headRefName
gh issue view 81 --json number,state,closedAt
git merge-base --is-ancestor d0f6b59e master && echo YES || echo NO
git merge-base --is-ancestor d0f6b59e 290d6f15 && echo YES || echo NO   # #68 内容已在 #87 线
git merge-base --is-ancestor 290d6f15 codex/realtime-product-acceptance && echo YES || echo NO  # head 已分叉

# Agent 护栏核查（不能只查 getter 名，要查注入点与构建路径）
git grep -n -E 'AgentConstants|maxIterations|modelCallLimit' HEAD -- 'src/main/**'
git grep -n 'agentConstants\.' HEAD -- 'src/main/**'
git grep -n -E 'ReactAgent|timeout\(|cancel\(|maxIteration' HEAD -- 'src/main/java/**/agent/**'

# 外部引用核查（git grep 之外必须做）
gh pr list --state all --limit 200 --json number,body | grep -o '<path-or-name>[^" ]*'

# 冻结先后关系
git merge-base --is-ancestor iris-ui-v2.1-freeze-20261115 04ff3ed0 && echo AFTER
git merge-base --is-ancestor iris-ui-v2.1-freeze-20261115 f42065e4 && echo AFTER

# 死配置核实
git grep -n "hash-algorithm" HEAD -- ':!docs'
git grep -n -E "getMaxIterations|getModelCallLimit|maxIterations|modelCallLimit" HEAD
git grep -n -E "Caffeine|@Cacheable|@EnableCaching|CacheManager" HEAD -- 'src/**/*.java'

# 无引用 / 跨线核实
git grep -l "iris-optical-logo-20261116" HEAD
git grep -n "setup-github-facade" HEAD -- '.github/**' 'scripts/verify.sh'
git branch -a --contains 63931d7b
git ls-files -z | git check-ignore -z --no-index --stdin   # 注意 --no-index

# 体积与对象分布（清理收益重新解释）
git ls-tree -r -l HEAD docs | awk '{s+=$4} END {print s}'
git count-objects -vH
git rev-list --objects --all | git cat-file --batch-check='%(objectsize) %(rest)' | sort -rn | head

# 样式体系审计（§4.4；注意本工作树 HEAD 比 origin/ui 旧）
git show origin/ui:web/src/index.css | grep -n -E '@theme|@custom-variant|@layer'
git grep -n -E '@layer ' HEAD -- 'web/src/**/*.css'          # 空 = 未分层
git grep -n -I -o 'sr-only' HEAD -- 'web/src/**' | wc -l     # 8（7 处 className + app.css 同名定义）
git diff HEAD origin/ui -- web/src/index.css web/package.json
```

> 中文核对：本机控制台按 GBK 渲染，工具结果里中文会花（`admin-viz__body` 显示成 `admin-cmsiz__body`）。文件本身一直是对的；必要时用 `python -c` + `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')` 读取，不要据终端显示改文件。
