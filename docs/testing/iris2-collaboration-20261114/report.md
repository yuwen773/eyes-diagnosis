# Iris 2.0 独立多 Agent 协作工作台：本地验收

日期：2026-11-14。范围：前端实现、模拟接口浏览器验收、静态协议核对和独立增量审查。结论：本地前端验收通过；真实 Java 后端联调未运行，生产协作保持 **BLOCKED**。未提交、未推送、未创建 PR、未合并或部署。

## 分支与隔离

工作树：`D:/Work/code/eye-diagnosis/.worktrees/iris2-collaboration`。分支：`feat/iris2-collaboration-workspace`。当前 HEAD 与视觉基线均为 `a1758c86add936d81690b0802fee26e2f20fe1d6`；本次新增 commit 为 0，交付内容均为工作区修改/新增文件，完整清单见 [files.md](files.md)。

开始前已运行 status、branch -vv、fetch origin --prune，并核对远端 PR 信息与本地祖先关系：

| PR | HEAD | base |
| --- | --- | --- |
| [#68](https://github.com/yuwen773/eyes-diagnosis/pull/68) | `10173ae9ced22f29f18a238fdd4e2ec22b2668de` | master (`a0efaf46d6f8b53bea4a35d613fc806e2f6e9d47`) |
| [#75](https://github.com/yuwen773/eyes-diagnosis/pull/75) | `a1758c86add936d81690b0802fee26e2f20fe1d6` | ui (`7642dda02b724cb2a83e8d5689de2dc73dbb574e`) |
| [#76](https://github.com/yuwen773/eyes-diagnosis/pull/76) | `88b06d52928bda53fe8b844cbe83d1a8b708f984` | feat/admin-visual-redesign |
| [#77](https://github.com/yuwen773/eyes-diagnosis/pull/77) | `f7664e75a10b4309eaf2c16dac4bf5a10f4cbced` | feat/admin-visual-redesign |

#75 是 #76/#77 的祖先；#68 与 #75 的共同祖先为 `a0efaf46`，双方均有独有提交。原工作树属于 #68，且有两份未跟踪审查报告，因此使用新分支/工作树，保留原工作区。未在 master、ui 或这四个 PR 的分支上写入修改。没有引入 #76/#77 的预览实现。

## 实现与冲突处理

新路由 `/agent/collaboration` 使用独立 `CollaborationPage.tsx`，复用 Iris 产品顶栏、认证、主题和设计 Tokens。任务表单、四角色状态、实时记录、授权影像、医生复核及患者获准结果均复用 #68 领域模块。没有复制普通聊天页面、创建第二套 SSE 客户端或修改 Graph 状态协议。

| 文件/领域 | 处理方式 |
| --- | --- |
| #68 尚未进入 #75 的 collaboration 组件、hook、API、协议/reducer及其测试 | 仅引入缺失文件，再针对页面组合、授权失效和 Iris 样式做局部调整 |
| `App.tsx` | 新增两个 lazy 路由：协作页与医生复核页；保留其他路由 |
| `ProductHeader.tsx` / `navLinks.ts` | 按原 feature flag 增加“影像协作”；普通 `/agent` 精确匹配，避免两个入口同时激活；保留 #75 导航/主题 |
| `lib/api.ts` | 保留 #75 请求封装，仅补 `createAgentSession(sessionId, signal)`；请求字段沿用 #68 的 `sessionId` |
| `collaborationApi` / `diagnosisTaskApi` / `reviewApi` | 复用现有传输与协议，接入 #75 的授权过期通知；HTTP 与业务码40100/40101均安全失败 |
| `DoctorReviewsPage.tsx` / `collaboration.css` | 复用授权复核流程，接入产品顶栏；仅使用现有颜色/字体/间距 Tokens；影像使用两主题一致的中性深色画布 |
| `package.json` | 仅增加本地协作浏览器验证脚本；无新增依赖，lockfile不变 |
| `AgentPage.tsx`、普通聊天 stream/history/session、Tokens、管理端、后端、迁移和算法 | 无修改；未整文件覆盖已有共享实现 |

根目录设计文档中“协议未来实现/扩展 agentStream”的历史描述不用于重建客户端；本次遵循任务要求和 #68 当前16事件协议。视觉与字体策略继续遵循根目录及 web 设计真源：品牌 Latin 使用 Manrope，中文与正文使用既有字体策略，页面标题保留原设计层级。

页面独立创建会话身份；受理复用 Session → Task → Run 链和幂等键。只有 runId 的深链先读取服务端授权快照获得 threadId，再交给同一 hook；刷新、断线重连和返回不重复受理任务。身份或角色切换会重新挂载受保护子树，取消请求、清理 Blob 和受保护内容。离开页面/断线只关闭连接；取消请求仍等待服务器终态。

患者/医生投影沿用服务端角色授权和客户端白名单：不展示未知事件自由文本、原始 Prompt、隐藏推理或 Graph State。协作完成、医生批准、患者查看许可与保存同意分别展示。患者保存仍需独立显式授权。

## 验证结果

以下均为本次工作区最终版本的实际执行结果，跳过数为0；不是 Hosted CI 或生产验收。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run test` | 53文件、512通过、0跳过 | `target/iris2-vitest-final.log` |
| `npm run typecheck` | PASS | 终端退出码0 |
| `npm run lint` | PASS，0警告 | 终端退出码0 |
| `VITE_COLLABORATION_ENABLED=false npm run build` | PASS | `target/iris2-build.log` |
| `npm run test:collaboration`（本地测试进程启用前端入口，模拟接口） | 29通过、0跳过 | `target/iris2-e2e-final.log` |
| `npm run test:collaboration -- --default-off`（已构建 dist 的 vite preview） | 1通过、0跳过 | `target/iris2-default-off.log` |
| Python协议脚本，对照 #68 真实 Java 源码及冻结 wire fixtures | 16事件、12快照字段，PASS | `target/iris2-collaboration-contract.json` |
| `git diff --check` | PASS | 终端退出码0 |

Windows 复现：在 web 下设置 `E2E_CHROMIUM_PATH` 为已安装的 Chromium 可执行文件，再运行浏览器脚本。默认关闭用例先以 `VITE_COLLABORATION_ENABLED=false` 构建。协议命令在仓库根目录运行：`python scripts/check_collaboration_fixture.py --backend-root <PR68工作树> --output target/iris2-collaboration-contract.json`。该脚本只核对源代码/冻结数据，本轮没有执行 Java/Jackson 运行时；证据类型已明确为 `SOURCE_CONTRACT_AND_FROZEN_WIRE_FIXTURES`。

覆盖：新建影像与已有任务两条受理链；runId深链；实际 SSE 消费器的流中断/游标续读/心跳/去重；取消确认前后；成功/失败/取消终态；长事件列表；授权失效、身份与角色切换；患者/医生内容隔离；授权 Blob 影像预览；医生冻结材料；批准结果和独立保存同意；返回普通聊天及普通聊天消息发送。

构建存在 Vite 大于500kB的 chunk提示（最大为已有 `AdminNewsEditPage`）；本次没有扩大到管理端打包重构。Playwright输出的 NO_COLOR/FORCE_COLOR 环境提示不影响断言。

明确未运行项：

- **真实 Java 后端联调 / Java全量测试：NOT_RUN。** #75 当前后端尚无 #68 的 Session创建、诊断任务、协作与复核整套接口；本次没有将后端跨分支搬入。模拟接口浏览器验收不能替代这项集成前置条件。
- **Hosted CI：NOT_RUN。** 本任务禁止提交和推送。
- 真实模型、真实患者、医疗生产、审计启用、B2启用：未运行/未启用；医疗生产仍为 **BLOCKED**。V1–V28、R5封存材料和所有生产开关默认值无修改。

早期失败保留在本地 target 日志中：首轮 Python with_server 辅助器没有消费 Vite输出管道，导致服务阻塞（1通过、3失败、16未运行）；改为直接持有 Vite服务器并 finally关闭的本地 runner。另有严格SSE fixture缺少关联字段、鼠标焦点与键盘 focus-visible 测试前置条件问题，已修正测试。授权撤销、无效替换文件、模型版本遗漏、医生影像画布问题均先复现失败再修复，最终计数以上表为准。最终5195端口无遗留监听。

## UI 实际截图验收

以下为真实浏览器渲染截图；接口、影像和医疗文字均为合成测试材料。影像由本地确定性几何脚本生成并标注 SYNTHETIC / NOT CLINICAL，无真实患者或模型调用。

| 宽度 | Light | Dark |
| --- | --- | --- |
| 390 | [协作](screenshots/collaboration-light-390.png) | [协作](screenshots/collaboration-dark-390.png) |
| 768 | [协作](screenshots/collaboration-light-768.png) | [协作](screenshots/collaboration-dark-768.png) |
| 820 | [协作](screenshots/collaboration-light-820.png) | [协作](screenshots/collaboration-dark-820.png) |
| 900 | [协作](screenshots/collaboration-light-900.png) | [协作](screenshots/collaboration-dark-900.png) |
| 1440 | [协作](screenshots/collaboration-light-1440.png) | [协作](screenshots/collaboration-dark-1440.png) |
| 1920 | [协作](screenshots/collaboration-light-1920.png) | [协作](screenshots/collaboration-dark-1920.png) |
| 新任务390 | [表单](screenshots/collaboration-new-light-390.png) | [表单](screenshots/collaboration-new-dark-390.png) |
| 新任务1440 | [表单](screenshots/collaboration-new-light-1440.png) | [表单](screenshots/collaboration-new-dark-1440.png) |
| 医生1440 | [复核](screenshots/doctor-review-light-1440.png) | [复核](screenshots/doctor-review-dark-1440.png) |

已逐组查看上述18张实际渲染结果（检查时也使用由原始截图缩放拼接的本地对照图，原图保留）。390/768采用两列角色、上下工作区；820/900采用四列角色、上下工作区；1440/1920采用四列角色、主时间线与影像侧栏。未见页面横向溢出、角色卡裁切、按钮文字截断、影像拉伸或主题切换引起的影像底色改变。长记录在独立区域滚动，页面仍可滚至底部。

浏览器断言同时核对44px触控目标、键盘focus-visible、reduced-motion和影像比例/预览。12份 `screenshots/ui-{theme}-{width}.json` 记录实际DOM结果：horizontalOverflow=false、roles=4、imageObjectFit=contain、contrastFailures=[]。对比度计算覆盖可见启用文字与控件，文字阈值4.5:1，控件边界对相邻背景3:1；禁用控件不计入该断言。数值和截图共同支持本次验收，不声称与设计图像素一致，也不代替完整无障碍审计。

## 独立审查与剩余风险

已按 code-review 工作流分别执行 Standards 与 Spec 的独立只读审查，覆盖已跟踪和未跟踪新增文件。最终复核为 **STANDARDS_PASS / SPEC_PASS**；没有尚未修复的已确认代码发现。

| 级别 | 已确认问题 | 修复及证据 |
| --- | --- | --- |
| P2，已修复 | 先选有效影像，再选无效文件时可能保留旧受理对象 | `CollaborationTaskForm.tsx:84` resetAdmission；组件测试先红后绿，原生文件控件也清空 |
| P2，已修复 | 获准查看/保存确认视图缺少可用modelVersion | `ClinicalContent.tsx:63` 共享ClinicalProvenance；`PatientResultPanel.tsx:137` 调用，查看与保存路径组件测试覆盖 |
| P2，已修复 | 医生复核影像没有两主题稳定的中性画布 | `collaboration.css:113`；真实浏览器先复现透明背景，再验证不透明且两主题相同，见医生截图 |
| 集成前置条件 | #75后端缺少#68运行时，真实连通性尚未验证 | **BLOCKED_ENV / NOT_RUN**；后续在含#68后端的集成候选执行真实接口与Java安全回归，再考虑启用；本次默认关闭 |
| P3，已有工程提示 | 管理端已有大chunk提示 | 记录为性能后续项，不扩展本次共享代码修改 |

## 推荐 PR base 与合并顺序

未来 PR 优先以 `feat/admin-visual-redesign` 为 base，只提交本地清单中的本任务变更。#75先合并到ui后，再将本任务PR调整到ui并重新检查语义冲突；#76/#77是独立兄弟任务，不作为本任务依赖，谁先合并均需复核共享路由/导航。

#68后端的正常审查/合并是协作实际运行的独立前置条件。最终集成候选必须同时包含Iris视觉基线、本次前端与#68后端，完成真实接口联调和CI，再另行审批生产启用。此建议不授权现在合并任何分支或打开开关。

停止点：本地实现、测试、截图和报告已交付；所有修改保留未提交状态，等待用户后续指令。

## 2026-11-15 Java 合成 Harness 联调补验

本章是 2026-11-14 本地验收之后的**独立补验**：只做真实 Java 连通性核验与证据归档，不新增功能、不启动完整 Spring Boot 应用。它与上文「模拟接口浏览器验收」是两件事，**不得互相替代**。

### 范围与运行环境（明确边界）

- **前端**：本工作树 `feat/iris2-collaboration-workspace` @ `a1758c86`，实际 Vite + React 页面（:5180），经同源代理接入；**没有覆写 `window.fetch`，没有模拟 API**。
- **后端**：PR #68 工作树 @ `10173ae9` 的 `CollaborationBrowserServer`（测试 classpath，回环 :18085）。注册的是**真实** `CollaborationRunController` / `DiagnosisTaskController` / `DoctorReviewController` / `PatientExplanationController` / `PatientAuthorizationController`，使用**真实** Spring MVC、事务、Spring Session、`SseEmitter` SSE 与 `JdbcTemplate`。
- **数据库**：本机 **MySQL 8.0.26 @ 3307** 的隔离库 `collaboration_test`；run / event / task 真实落库。仅合成账号 42–45 与 `thread-42/43`。
- **合成部分**：模型（固定应答 `ChatModel`）、影像（确定性几何 PNG，标注 SYNTHETIC / NOT CLINICAL）、对象存储（内存 Map）。**未调用 DashScope / 真实模型，未使用真实患者数据**。
- **只读事实**：只启用 harness 自己的测试 flag（admission / patient / clinician）；**未修改** `application.yml` 的五项协作开关（仍全为 `false`）、未改 V1–V28 迁移、未动 R5 封存材料、未开工具审计 / B2。
- **明确不是**：完整 Spring Boot 应用（`main` 启动、全套 bean、Flyway 迁移链、Redis、COS、真实 gRPC）端到端验收 **NOT_RUN**。Harness 用测试 DDL（`CREATE TABLE IF NOT EXISTS`）建表，不校验生产 Flyway 历史，也不覆盖 `mvn test` / Hosted CI。

### 静态契约对照（对照真实 Java 源码，PASS）

端点路径、`Create/Snapshot/Cancellation/Operations/Event/Frame` record、`SafeStatus(taskId,status)`、`SessionCreate(sessionId)`、SSE 帧（`id`=游标、`event`=type 或 `run.heartbeat`、`data`=Event JSON）、`40100/40101` 业务码、Java `long`→十进制字符串归一化，全部与 #68 源码一致。**16 事件类型**与 `CollaborationEvents.FIELDS` 白名单完全相同（含 `agent.summary` / `agent.readable`），**12 快照字段**与 `Snapshot` record 相同。证据 `target/iris2-collaboration-contract.json`（`SOURCE_CONTRACT_AND_FROZEN_WIRE_FIXTURES`，含 4 个后端源文件 SHA-256，status PASS）。

### 真实 HTTP / SSE 浏览器用例（数量以实际执行为准）

**6 个 Playwright 用例，6 通过、0 跳过、0 失败**（`target/integration*.spec.mjs`，3 个文件，执行后已删除）。用例内部的 `STEP1…STEP9` 是**子断言 / 场景标签，不是 9 个独立测试**，不得记作「9 通过」。

| # | 用例 | 真实链路与结果 |
| --- | --- | --- |
| 1 | 上传 → 受理 → 真实 SSE → 终态 | `POST /test/session` 登录（`/user/get/login` 返回 id 42）；真实 multipart 上传经 `DiagnosisTaskService` 校验并落 `WAITING_REVIEW`；`POST /collaboration-runs` 受理出 `runId`；`GET /{runId}` 返回 12 字段 `RUNNING`；放开合成模型闸门后真实 SSE 推进到 `SUCCEEDED` / `reviewStatus=PENDING`；`/test/counts` 证实 4 次合成模型调用与真实 MySQL 事件 |
| 2 | runId-only 深链 | 只带 `runId` 打开，前端经服务端授权快照补回 `threadId` 并重建同一 hook，未重复受理 |
| 3 | 取消落到终态 | `POST /{runId}/cancel` 回执 `CANCELLED/CANCELLED`，DB `CANCELLED`、reason `USER_CANCELLED`，无 `CANCELLATION_UNCONFIRMED` |
| 4 | 授权撤销 | `/test/revoke` 作废会话后刷新，页面 fail-closed 回登录门，未残留受保护内容 |
| 5 | 刷新 / 断线恢复 | `reload` 后 `/test/counts` 的 run 数不变（不重复受理），同一 run 仍可读授权快照 |
| 6 | 活动流中取消 | SSE 在跑时点取消，回执 `CANCELLED/CANCELLED`、DB `CANCELLED`（审查所列「取消请求竞态」在本场景**未复现**） |

首轮曾以 4 个用例运行并出现 2 个失败，经查均为**测试脚本自身错误**：其一在取消 POST 完成前读取了中间态 `CANCEL_REQUESTED`；其二从 Node 侧发 `/test/revoke` 未携带浏览器 cookie 而成为空操作。修正后以 6 个用例重跑全绿，**两处失败不是产品缺陷**。

### 角色隔离、授权撤销、取消与恢复证据

- 角色边界（真实 HTTP）：患者 42 访问 `/doctor-reviews` → `40101`；医生 44 → `200`；管理员 45 → `40101`（后端设计，非缺陷）。
- 取消语义：`cancel()` 在同一事务写 `CANCEL_REQUESTED` → `finishCancellation` 落 `CANCELLED` 与 `run.cancelled` 事件；断线只停订阅，不发送持久取消；取消回执不被前端合成为事件。
- 恢复语义：`Last-Event-ID` / 不透明游标重放，刷新不重建任务、不重复 `create`。
- Harness 日志中的异常均为浏览器导航 / 取消关闭流引发的 `ClientAbortException` 及其次级 `HttpMessageNotWritableException`（全局异常处理器试图向已关闭的 SSE / 图片响应写 JSON），另有 1 条无害的 `NoProviderFoundException`；**无领域错误**。

### dev-only Vite 代理改动

`web/vite.config.ts` 新增单行（本地联调必需）：

```ts
target: process.env.COLLABORATION_TEST_BACKEND ?? "http://localhost:8081",
```

未设置该环境变量时**默认代理仍是 `:8081`**，只影响 dev 代理、不进生产构建（`VITE_COLLABORATION_ENABLED=false npm run build` PASS）。#68 前端原有同样机制，#75 视觉基线漏掉了。这是本轮**唯一新增的源码改动**，交付文件因此由 73 → **74**（6 改 + 68 新，0 删除）；`files.md` 已同步。

### 已通过 / 未执行 / 环境限制 / 剩余问题

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 静态契约（16 事件 / 12 字段 / 端点 / DTO / 错误码） | PASS | `target/iris2-collaboration-contract.json` |
| Vitest | 53 文件 / **512 通过** / 0 跳过 | `target/iris2-vitest-final.log`；代理改动后复跑仍 512 |
| Playwright 协作（模拟接口，11-14 基线） | **29 通过** / 0 跳过 | `target/iris2-e2e-final.log` |
| Playwright 生产默认关闭 | **1 通过** / 0 跳过 | `target/iris2-default-off.log`（29+1 常被合称「30/30」，实为两个套件） |
| Playwright 协作（代理改动后回归） | 29 通过 / 0 跳过 | 本轮复跑 |
| 真实 Java 合成 Harness 浏览器联调 | **6 用例 / 6 通过** | `target/iris2-real-java-integration-2026-11-15.json` |
| `npm run typecheck` | PASS | 本轮复跑 |
| `VITE_COLLABORATION_ENABLED=false npm run build` | PASS | 仅有既存 `AdminNewsEditPage` 大 chunk 提示 |
| `npm run lint` | 11-14 PASS；本轮**未重跑**（无影响 lint 的代码改动） | 上文 §验证结果 |
| `code-review high` 独立增量审查 | STANDARDS_PASS / SPEC_PASS（仅前端 + 模拟接口范围） | 见下「剩余问题」 |
| 完整 Spring Boot 应用级端到端 | **NOT_RUN** | 本轮环境限制：只有测试 classpath harness，未起全套应用 |
| Java 全量测试 `scripts/verify.sh` / `mvn test` | **NOT_RUN** | 本轮未执行 Java 测试运行 |
| Hosted CI | **NOT_RUN** | 本任务不提交 / 不推送 |
| 真实模型、真实患者、医疗生产、工具审计、B2 | **未运行 / 未启用** | 红线 |

**refs 已漂移（本轮重查，原 §推荐 PR base 已失效）**：PR #75 已 **CLOSED**，被 **#78（已 MERGED 进 `ui`，`aa9764e4`）** 取代；`origin/feat/admin-visual-redesign` 已删除；`a1758c86` 确认为 `origin/ui`（`86332427`）的祖先。后续 PR 目标应改看 `ui` / master，不再以 `feat/admin-visual-redesign` 为 base。PR #68 仍 OPEN / Draft / CLEAN @ `10173ae9`。另：本机 :8081 是普通开发后端（`POST /collaboration-runs` 返回 `50000`），**不是** #68 协作运行时，不可直接指向联调。

**剩余问题（3 个 P2，明确记录，不在本轮修复）**：

1. `web/src/hooks/useCollaborationRun.ts:240` — `cancel()` 把可中止的流 `AbortSignal` 传给 `POST /cancel`；若重连 / 流中止与取消并发，取消请求可能被 abort，UI 显示 `CANCELLATION_UNCONFIRMED` 而任务仍在跑。真实 Harness 的单次取消与活动流中取消**均未复现**，但仍是防御性缺口。
2. `web/src/lib/collaborationApi.ts:129-144` — SSE `onopen` 对 `application/json` 响应先 `envelope()` 消费 body；`code:0` 的 JSON 成功响应会在 body 读空后报协议错误而非干净拒绝。
3. `web/src/components/agent/collaboration/CollaborationTaskForm.tsx:117` / `web/src/lib/diagnosisTaskApi.ts:35` — `status` 为封闭三值白名单；后端新增枚举会抛 `INVALID_TASK_RESPONSE`，使「受限 / 安全停止」引导丢失并残留旧选择。

其余审查条目（深链首帧、Blob URL 小泄漏、`--default-off` 不校验 dist、fixture 脚本只比字段名不比类型、导航 code 随开关重编号等）为 nit 或已 fail-closed，不列为交付阻塞。

### 交接前最终 Git 状态

- 分支 `feat/iris2-collaboration-workspace`，HEAD 仍为视觉基线 **`a1758c86add936d81690b0802fee26e2f20fe1d6`**，**新增 commit 为 0**。
- 交付内容 **74 个文件全部未暂存、未提交**：6 个已跟踪文件修改 + 68 个新增；0 删除。清单见 `files.md`。
- 本会话的 worktree guard **禁止对另一工作树执行 git 写操作**（`git -C`、`cd … && git`、`--git-dir/--work-tree`、`GIT_DIR/GIT_WORK_TREE`、`git add <跨树绝对路径>`、`EnterWorktree` 均被拒绝），因此**未能创建本地交接提交**。上述 Git 状态由「分支 tree blob 哈希 vs 工作树文件」只读比对（CRLF 归一化）得出，未在目标工作树执行 `git status`。
- 未提交 / 未推送 / 未合并 / 未部署；**不得把该工作树当作可直接 merge 或 cherry-pick 的提交**。交接信号 `agent-ready.json` 因此为 `ready=false`，详见 `D:/Work/code/iris-integration-handoff/`。
- 工作树内无临时数据、凭据、合成数据库或构建产物混入：本次生成的 `web/dist`、`web/node_modules/.vite`、`web/test-results`、临时 `integration*.spec.mjs` / `integration.config.mjs` / `.write-probe` 均已删除；忽略目录 `target/` 仅保留 11-14 的日志与本轮联调证据；:18085 与 :5180 均已停止、无遗留监听；隔离库仅合成账号 42–45。

### 生产医疗协作仍 BLOCKED

合成 Harness 联调只证明「真实 Java Controller / MySQL / SSE 与前端契约连通」，**不等于**完整 Spring Boot 应用验收，更不等于临床或生产放行。PR #68 终审裁定不变：医学有效性 `NOT_EVALUATED`、R5 正常可复核候选 0/2、缺持久 256-bit `cursor-key`、生产动态配置 / 多实例滚动 / 入口阻断 / 旧二进制回退 / 容量 SLO 未演练。**合并代码 ≠ 启用功能**；本轮亦未合并任何分支或打开任何生产开关。
