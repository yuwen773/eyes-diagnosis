# Release Candidate Readiness

**当前状态：`CONDITIONAL`（第二轮 NO_GO 的 6 条阻断已逐条整改、本地门禁全绿；能否解除 NO_GO 取决于独立复验）**

> `CONDITIONAL` 的含义只有一条：**我们自己这一侧能证明的都证明了，但结论不由我们下**。
> 两轮独立审查的 NO_GO 结论未被修改，也不会被本文件覆盖；复验通过之前不构成 GO。
>
> 正式发版、合并 `ui` / `master`、打 tag、GitHub Release、部署、生产开关变更
> **全部需要 owner 明确批准**，本轮未执行、也不会自动执行。
> 候选 PR #119 仍是 **Draft**。

## 1. 候选标识

| 项 | 值 |
|---|---|
| 候选分支 | `integration/iris-release-candidate`（已推送 origin） |
| **候选代码 SHA** | `f6b08841`（第二轮整改的最后一个代码提交；其后仅 `docs/**`） |
| 基线 | `origin/ui@1ff9c71c` |
| 建议版本号 | `v1.1.0-rc.1`（编号不变；本轮整改不新增功能） |
| 数据库迁移 | 最高 `V29__knowledge_index_version.sql`（相对基线**新增 1 条**，只加一列可空列） |
| 冻结 tag | `iris-ui-v2.1-freeze-20261115` = `80f53f7f`（本地与远端均未移动，已核对） |
| 候选 PR | [#119](https://github.com/yuwen773/eyes-diagnosis/pull/119)（Draft → `ui`） |

## 2. 两轮 NO_GO 的逐条处置

台账见 `codex-no-go-remediation.md`（§1–§7 第一轮、§9 第二轮）。
第一轮结论：P0-01 关闭，其余 6 条在第二轮复验时仍 STILL_OPEN。

| 编号 | 第二轮结论 | 本轮整改 | 回归证据 |
|---|---|---|---|
| P0-01 | CLOSED（未回退） | 未改动 | 既有 15 条用例 |
| P0-02 | STILL_OPEN → 已整改 | 归档「可证实才算成功」 | 87 断言 / 12 例 |
| P1-01 | STILL_OPEN → 已整改 | 先提交后发送 + 中断即取消 + 实时映射补字段 | 4 条后端用例 + 2 条前端门禁用例 |
| P1-02 | STILL_OPEN → 已整改 | 服务端索引版本 + CAS + 版本准入 | 4 条用例 + 真实 Chroma 探测器 |
| P1-03 | STILL_OPEN → 已整改 | 服务端 `subType` + 逐张归属复核 + 受保护取图端点 | `AgentAttachmentTrustTest` + 前端 4 处 |
| P1-04 | STILL_OPEN → 已整改（文档） | 手册重写四项验收与逐表对账；测试改名 | `FlywayMySqlIntegrationTest` 5/5 |
| P1-05 | STILL_OPEN → 已整改 | 最后模型节点仍要求工具时追加终止说明 | `AgentBudgetExhaustionTest` 新场景 + 真实 MySQL 用例 |

## 3. 已完成的验证（绑定 `f6b08841`）

| 门禁 | 结果 |
|---|---|
| 本地 `scripts/verify.sh` 三段 | ✅ pass1 `762/0/0`（303 skip 按设计）、pass2 `10/0/0`、pass3 `303/0/0`，`verify green` |
| Web 单测 / 类型 / Lint / 构建 | ✅ 97 文件 1039 用例；`typecheck`/`lint`/`build` exit 0 |
| 工作树归档故障注入 | ✅ 87 断言 / 12 例 |
| GitHub Actions | 见 `verification-matrix.md` §2.9（含一次 `docs-contract` 失败与修复记录） |

逐 SHA 明细见 `verification-matrix.md` §2.9（G-3 见 §2.7，不稳定用例治理见 §2.8）。

## 4. 仍未关闭的门禁

| 编号 | 门禁 | 为什么没关闭 | 需要什么才能关 |
|---|---|---|---|
| **R-1** | **独立复验** | 自验收不能代替独立复验；NO_GO 由审查方给出，也要由审查方解除 | 审查方对本候选复跑复现脚本并出具结论 |
| G-3 | 真实 DashScope → SSE 全链路 | ⚠️ **回到 OPEN**：上一轮 5 场景的原始证据（SSE / 历史 / 审计 / 提供方记录）在收尾时被删除，独立审查无法交叉核验；本轮无凭据、未重跑 | 提供凭据重跑并**保留脱敏证据** |
| G-3 残余 | 视觉工具**成功**路径、真实对象存储上传 | 占位 COS 凭据 → `qwen-vl-plus` 从未被真实调用 | 需要一套可用的对象存储凭据后重跑视觉链路 |
| G-5 | 双主题 / 响应式**截图**证据 | 断言式门禁已跑，截图证据仍缺可核验的构建内容指纹 | 复核或重出截图并归档 |

## 5. 医疗与生产默认值（未改动）

| 边界 | 现状 |
|---|---|
| 医生正式复核写入门禁 | 保持关闭策略（旧 master 产物会恢复该写入，故不可作为回退产物） |
| 多 Agent 协作生产开关 | `eye-diagnosis.collaboration.*` 全 `false`；前端入口 `VITE_COLLABORATION_ENABLED` 未设置 |
| 「模型推理 ≠ 医学证据」措辞 | 未回退；含「工具返回内容不可用，本次结果不能当作医学证据」 |
| 未核验资质不得冒充已认证医生 | 未改动 |
| 知识库来源筛选 / 语料播种 | `rag.source-type.enabled=false`、`rag.corpus.seed-enabled=false` |

## 6. 终态声明

- 终态：**`CONDITIONAL`**
- 判定时间：2026-11-19（+08:00）
- 代码 SHA：`f6b08841`（其后仅 `docs/**`）
- 结论：第二轮 6 条开放阻断逐条整改，每条都有走真实执行路径的用例（含真实 MySQL 注入写失败、
  真实 Chroma REST 故障注入、真实 ReactAgent 图）；本地三段全量与前端四道门禁全绿；
  **但 G-3 的原始证据已不可核验（已回到 OPEN）、G-5 截图证据仍缺、独立复验未完成**，
  因此不构成 GO。
- 下一步：交独立审查对 `f6b08841` 复验；如需重启 G-3，须提供凭据并保留脱敏证据。
- **未执行、等待 owner 批准**：合并 `ui` / `master`、正式打 tag、GitHub Release、部署、生产开关变更。
