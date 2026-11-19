# Iris 夜间发版攻坚台账 · 2026-11-19 → 2026-11-20 08:00

> 唯一进度台账。每轮循环先读本文件 + `git status` + PR/CI，再从「下一步」继续。
> 恢复锚点：本文件 + 最新已验证提交。

## 0. 基线与工作树

- 开发主线：`origin/ui` = `361be4be`（PR #119 RC 集成）。
- 发布目标：`origin/master` = `a0efaf46`；`master` 是 `ui` 的**严格祖先**（可 fast-forward）。
- 本台账所在工作树：`.worktrees/ui-latest`，分支 `release/v1.1.0-rc.2`（从 `361be4be` 切出）。
- 其它工作树：主检出 `feat/r3-agent-correctness`（含 Docker 资源 WIP，**不动**）；
  `.worktrees/verify-levels`（#120 验证分级 WIP，**不动**）。
- 本地栈：后端 8081（ui-latest，profile 含 local，真实 DashScope `DASHSCOPE_API_KEY` 存在）、
  vite 5173、Chroma 8000、Redis 6380、MySQL 3306（`diagnosis`，已到 V29）。
- 种子账号：`acceptance-patient-8til3oiuo` id `9223372036854775801`；cookie `/tmp/eye-cookie.txt`。
- 证据目录（不入库）：`C:/Users/yuwen/AppData/Local/Temp/eye-overnight-2026-11-19/`。
- 当前后端启动开关（仅本进程，重启回默认关）：`EYE_DIAGNOSIS_RAG_CORPUS_SEED_ENABLED=true`
  （真实播种 24 分块）、`AGENT_TOOL_AUDIT_ENABLED=true`（t_agent_tool_audit 写审计）。

## 1. 当前任务

**P0 · 视觉分析 imageId 归属误报「无权分析他人图片」** — 复现 + 根因 + 修复 + 定向测试。

### 已确认事实

- 真实链路已跑通一次（22:38，threadId `10f5f8ef…`）：`TOOL_REQUEST` 参数
  `{"imageId":"agent-chat/9223372036854775801/11018f8c-…jpg"}` → 视觉模型返回合法结构化 JSON →
  tool-result `succeeded` → SSE 流式回答 → 干净结束。证据 `sse-run1.txt`。
- 失败为**间歇性**：22:09 session `d7233829…` 同一 seed 用户，
  `EyeImageAnalyzerTool.resolveOwnedObjectKey:158` 抛 `无权分析他人图片`（NO_AUTH = 前缀不匹配），
  `ToolExecutionException` 被 `DefaultToolExecutionExceptionProcessor(true)` 转成工具错误。
- 根因：**依赖模型逐字复述长对象键**。模型有时把 `agent-chat/{uid}/{file}.jpg` 截断成文件名
  或改成视图 URL，前缀校验即失败。上传返回值是视图 URL `/api/agent/image/view/{file}.jpg`，
  与注入给模型的内部对象键**形状不一致**。

### 修复方案（安全不减弱）

在 `EyeImageAnalyzerTool.resolveOwnedObjectKey` 归一化**服务端签发过的三种形状**到本用户命名空间：
1. 完整对象键 `agent-chat/{uid}/{file}`（显式越权前缀仍拒绝）；
2. 视图 URL `/api/agent/image/view/{file}`；
3. 裸文件名 `{file}`。
归一化后**仍执行**原有 `agent-chat/{uid}/` 前缀 + `t_upload_task` 归属 + 活跃状态校验。外部 URL、
跨用户、路径穿越、非法字符一律拒绝。

## 2. 待办（按优先级）

- [x] P0 视觉 imageId 归一化修复 + 单测 — 提交 `c964fe8a`，本类 10/10 通过
- [x] P0 真实模型复跑（修复后）成功 + 历史回放通过（thread `ae475ae3…`，`sse-run2-fixed.txt`）
- [x] G3-5 附件信任边界负例 5/5 拒绝且 0 条外部地址入库（`neg_*.json`）
- [x] G3-6 真实视觉成功（`qwen3-vl-plus`，结构化 JSON，`status:succeeded`，回放保留）
- [x] G3-1 真实流式文本 + done + 历史入库回放
- [x] G3-2 真实 RAG（`text-embedding-v3`→Chroma 24 分块→结构化来源→历史证据引用）。
      仅验证内置语料路径；上传文档 indexVersion 准入未试（D5 无重处理入口）→ G3-2 PARTIAL
- [x] G3-3 真实工具失败：SSE/history/审计/模型可见一致（成功 `succeeded`；Chroma 停机 →
      `failed/TOOL_EXCEPTION`；审计仅存 key 名，无原文）。PASS
- [x] G3-4 SSE 中断取消：客户端 5s 断流→在途工具终态 `cancelled/CANCELLED` 已持久化，无假成功。PASS
- [ ] P1 观察项：SSE 端点 BusinessException → 500 空体（`GlobalExceptionHandler` 内容协商失败，非本次引入；请求仍被正确拒绝、无入库）
- [x] G-3 汇总：G3-1/G3-3/G3-4/G3-5/G3-6/G3-7 PASS；G3-2 PARTIAL（内建语料，上传文档 indexVersion 未试）
- [x] G-5 浏览器视觉验收：复用并增强 `web/scripts/evidence/rc-final-visual.mjs`（生产构建 + 合成 API，
      浅/深 × 390/768/1440/1920，覆盖首页/管理端溯源/Agent 资源/新闻 loading·error·empty/登录错误/空会话）。
      HEAD `6774829f`：**40 张截图**；断言 theme 正确、无 dev client、无 page error、服务资源哈希一致——全过。
      **发现 1 处真实响应式缺陷：login-error 在 390px 横向溢出 31px（浅/深一致）**，已登记 Issue #122；属冻结 UI，未擅改。
- [x] G3-7 真实 COS 上传/读取/越权/删除（合成图）PASS；**P1 安全发现：COS 桶公有读，视图 40100 可被直链绕过**（建议私有桶+签名 URL，属 infra，未擅改）
- [x] V17→V29 隔离库迁移 + 备份恢复演练（3307 MySQL8；12→26 表、旧数据/归属/中文完好；备份 2s 恢复；注：用 SQL 直跑非 Flyway 引擎，旧二进制回退仍非安全路径）
- [x] ui→master 发布候选 **PR #121（Draft）**；完整 GitHub CI **22/22 绿**（见 §5）
- [ ] 版本号建议（v1.1.0 vs v2.0.0）+ Release Notes 草案（需 owner 确认）

## 3. 失败 / 阻塞

- **缺陷（P3，冻结 UI，已登记 Issue #122）**：登录错误态（`login-error`）在 390px 两侧均横向溢出 31px
  （`documentElement.scrollWidth - innerWidth`）。非阻断；属 Iris 2.1 冻结范围，按冻结规矩只登记不擅改。

## 4. 最近一次命令与结果

- 修复后重建 + 重启后端（`mvn spring-boot:run`，`local,dev`）→ `Started`。
- `POST /api/agent/chat/stream`（threadId `ae475ae3…` 修复版）→ 退出码 0，`tool-result status=succeeded`，结构化 JSON。PASS。
- `GET /api/agent/history/ae475ae3…` → 4 条（user-attachments-v1 / tool-call / tool-result{succeeded} / text）。PASS。
- G3-5 五个负例 → 全部拒绝，`t_agent_message` 恶意地址计数 = 0。PASS。
- 后端以 `EYE_DIAGNOSIS_RAG_CORPUS_SEED_ENABLED=true` 重启；Chroma 由 0 → 24 分块（真实 `text-embedding-v3`）。
- G3-2：`searchDocuments` 真实检索返回 `builtin:03-cataract`，历史回放保留 `resources`。PASS(内建语料)。
- 证据索引：`C:/Users/yuwen/AppData/Local/Temp/eye-overnight-2026-11-19/EVIDENCE.md`。

## 5. PR / CI

- **PR #121**（Draft）：`release/v1.1.0-rc.2` → `master`，https://github.com/yuwen773/eyes-diagnosis/pull/121
  - head = `origin/ui`(`361be4be`) + 7 提交（P0 修复 + 6 docs）。
  - 触发 verify：run `44554702845`（pull_request，22 个 job）——**22/22 全部通过，run completed success**。
    含 backend-compile/unit、flyway 正反序、issue17–24、graph-execution、collaboration-mysql、
    product-contract、web、web-e2e-system-states、python、watchdog 等。
  - 这是 `ui` 树**首次完整 CI**（master 为严格祖先，fast-forward 可合）。✅ 门禁通过。
  - **不自行合并**：合并/打 tag/Release/部署需 owner 批准。

## 6. 发版裁决（早间 Report）

**裁决：CONDITIONAL — 技术门禁全绿，可进入合并决策；合并/发布/部署/启用临床仍需 owner 拍板。**

### 6.1 已关闭的阻塞性门禁
| 门禁 | 结论 | 证据 |
|---|---|---|
| P0 视觉 imageId 误报「无权分析他人图片」 | **修复 + 真实复跑**（安全不减弱） | `c964fe8a`；单测 10/10；真实 `qwen3-vl-plus` + 历史回放 |
| G3-1 真实流式文本 | PASS | DashScope + `event: done` + 历史入库 |
| G3-2 RAG | PARTIAL | 内建语料真实 embedding→Chroma→来源；上传文档路径未试（D5） |
| G3-3 工具失败一致性 | PASS | SSE/history/审计/模型可见一致 |
| G3-4 SSE 中断取消 | PASS | 终态 `cancelled` 已持久化 |
| G3-5 附件信任边界 | PASS | 5/5 拒绝，0 入库 |
| G3-6 真实视觉成功 | PASS | 结构化 JSON + `succeeded` |
| G3-7 真实 COS | PASS | 上传/授权读/越权拒/删除 |
| G-5 浏览器视觉验收 | PASS（1 处非阻断缺陷） | 40 张截图，浅/深 × 390/768/1440/1920；Issue #122 |
| V17→V29 迁移 + 备份恢复 | PASS（直跑 SQL，caveat） | 12→26 表、旧数据完好、备份 2s 恢复 |
| **PR #121 完整 CI** | **22/22 绿** | run `44554702845`（及加固后 HEAD 复跑） |

### 6.2 需 owner 批准（本循环一律未做）
1. **合并 `ui`→`master`**（PR #121，fast-forward）。
2. **版本号**：建议 **`v1.1.0`**（依据见 PR #121 Release Notes：向后兼容功能新增 + 12 条迁移，无对外契约破坏；真正的 2.0 语义留给多 Agent 正式启用）。当前 `pom.xml` 仍 `0.0.1-SNAPSHOT`，**未改**。
3. **打正式 Tag / 发布 GitHub Release**（未做）。
4. **部署 / 生产开关变更 / 启用临床复核与多 Agent 协作**（默认全关，未做）。

### 6.3 已知限制与风险（不阻断合并；阻断「生产启用临床/安全达标」）
- **D5**：知识库上传文档无重处理入口（无法置 READY+indexVersion）→ G3-2 上传路径未验；非本 RC 引入。
- **COS 桶公有读（P1 安全/infra）**：`/api/agent/image/view` 的 40100 归属门可被直链 COS 对象 URL 绕过。建议私有桶 + 短时签名 URL；属生产存储方案决策，**未擅改**。
- **迁移不可直退**：V18–V29 单向；旧二进制回退撞 Flyway validate，非安全路径；备份恢复仅数据层。
- **SSE 端点 BusinessException → 500 空体**（P1 既存 UX 缺陷，非本次引入）。
- **登录错误态 390px 横向溢出 31px**（Issue #122，冻结 UI，非阻断）。

### 6.4 Release Notes 草案
完整草案见 **PR #121 描述**（概述 / 增量提交 / 核心修复 / 门禁表 / 已知限制 / 迁移 / 版本建议）。

### 6.5 早间建议动作
1. 审 PR #121 并确认版本号（建议 `v1.1.0`）。
2. 决定是否接受 6.3 的已知限制后再合并；生产启用临床/协作另开专项。
3. 合并前如需，先在**生产快照**上演练 V17→V29（本循环仅隔离库演练）。
