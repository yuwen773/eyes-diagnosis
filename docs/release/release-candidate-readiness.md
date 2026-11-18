# Release Candidate Readiness

**当前状态：`RC_BLOCKED`（面向 owner 的判定；不得据此发布）**

> 正式发版、合并 `ui` / `master`、打 tag、GitHub Release、部署、生产开关变更
> **全部需要 owner 明确批准**，本轮未执行、也不会自动执行。

## 1. 候选标识

| 项 | 值 |
|---|---|
| 候选分支 | `integration/iris-release-candidate`（已推送 origin） |
| 候选 HEAD | `dcf68d0f` |
| 基线 | `origin/ui@1ff9c71c` |
| 建议版本号 | `v1.1.0-rc.1` |
| 数据库迁移 | 最高 `V28__agent_tool_audit.sql`；**相对基线无新增迁移** |
| 冻结 tag | `iris-ui-v2.1-freeze-20261115` = `80f53f7f`（本地与远端均未移动，已核对） |

## 2. 已纳入并验证的内容

| 内容 | 提交 | 状态 |
|---|---|---|
| #112 Agent 运行时护栏（预算 + 递归上限） | `eaa8f409` | 定向单测绿 |
| #111 R3 Agent（时间契约、资源闭环、结构化来源） | `995097fc` | 定向单测绿 |
| P0 工具异常误判（框架 1.1.2.2） | 含于 `995097fc` | **端到端**用例 `AgentToolFailureEndToEndTest` 绿 |
| P1 旧回合步骤被 streaming 叫醒 | `1d69698c` | 回归绿 |
| #101 System States R2 | `8ad5d38c` | web 全量绿 |
| #106–#110、#113–#116 工程清理与文档 | `25f679dd`…`b433b931` | 编译 + 全量 web 绿 |
| 评审整改（C 的两条 P1、A/B 的 P2） | `9924ed33`、`dcf68d0f` | 定向 + web 全量绿 |
| 发布说明、升级/回滚手册、本组台账 | `3c1fdf19`、`17accb95` | 已入库 |

## 3. 仍未关闭的门禁（RC_BLOCKED 的直接原因）

| 编号 | 门禁 | 为什么没关闭 | 需要什么才能关 |
|---|---|---|---|
| G-1 | **后端全量 `scripts/verify.sh`（三段）在当前 HEAD 上未跑完** | 上一轮运行中宿主机内存不足（仅剩 0.5 GB），进程被系统终止，不是测试失败 | 释放内存后重跑一次；约 15 分钟、峰值约 1.8 GB |
| G-2 | **GitHub Actions 20 个 job 未跑** | `verify.yml` 只在 `pull_request` 与 push `master` 触发；候选分支已推送但未开 PR | owner 决定是否开 PR（会触发全部门禁） |
| G-3 | **真实后端链路未验证** | 需要真实 DashScope 凭据与完整依赖栈 | 提供凭据后在可用环境跑一轮冒烟 |
| G-4 | **Playwright `web-e2e-system-states`（14 条）未跑** | 本机缺 chromium-1254，安装被中止 | 装浏览器后 `npm run test:e2e -- --grep "Iris System States R2"` |
| G-5 | **双主题 / 响应式截图证据缺失** | 需浏览器 | 见 `DESIGN.md` 回归口径 |

> G-1 是**本地可执行**的门禁，不属于「外部环境无法执行」；
> 因此终态是 `RC_BLOCKED` 而不是 `RC_READY_WITH_EXTERNAL_GATES`。
> 若 G-1 关闭，且 G-2/G-3/G-4/G-5 仍未执行，可改为
> `RC_READY_WITH_EXTERNAL_GATES`（仅限内部候选审查，不等同所有门禁通过）。

## 4. 四路独立 Review 结论

| Reviewer | 视角 | 判定 | 处置 |
|---|---|---|---|
| A | Agent / Java | `PASS_WITH_P2` | P2-1 幽灵步骤、P2-3 字节上限、P2-4 端到端证据 → 已修；P2-2/P2-5 登记为债务 |
| B | React / UI | `PASS_WITH_P2` | running 帧冒充结果 → 已修 |
| C | 安全与医学 | `BLOCKED` → 两条 P1 已修 | 影像分析假成功、图片先落库后校验 → 已修并有回归 |
| D | QA / 发版 | `BLOCKED` → 部分关闭 | 交付物入库、文档口径、SHA 过期 → 已修；CI 未跑 → 仍开放（G-2） |

无 reviewer 报告 P0。A 用字节码独立复核了 P0 修复的三层前提（拦截链顺序、`alwaysThrow`
真抛、逃逸后会话继续），并指出此前缺端到端证据——已补。

## 5. 医疗与生产默认值（未改动）

| 边界 | 现状 |
|---|---|
| 医生正式复核写入门禁 | 保持关闭策略 |
| 多 Agent 协作生产开关 | `eye-diagnosis.collaboration.*` 全 `false`；前端入口 `VITE_COLLABORATION_ENABLED` 未设置 |
| 「模型推理 ≠ 医学证据」措辞 | 未回退 |
| 未核验资质不得冒充已认证医生 | 未改动 |
| 知识库来源筛选 / 语料播种 | `rag.source-type.enabled=false`、`rag.corpus.seed-enabled=false` |

## 6. 终态声明

- 终态：**`RC_BLOCKED`**
- 判定时间：2026-11-19 01:40（+08:00）
- 结论：代码与文档层面无已知 P0/P1 未决项；阻断来自**未执行的门禁**（G-1 本地可跑、
  G-2/G-3/G-4/G-5 需要外部条件或 owner 决定）。
- 下一步（按优先级）：关闭 G-1 → 评估 G-4 → G-2/G-3 由 owner 决定。
