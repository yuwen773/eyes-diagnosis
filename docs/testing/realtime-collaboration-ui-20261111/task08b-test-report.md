# TASK-08B · 正式 React 多 Agent 工作台 — 测试报告

日期：2026-11-13 · 基线：`68d422ce0bcafad166b6bf922edebabd94d6f4ef`（PR #68 head，执行前已复核 HEAD 一致）
关联：ADR `docs/architecture/studio-reuse-decision.md`（§8 最小集成方案）· 契约 `docs/collaboration-runs.md`

## 1. 交付范围

按 ADR §8 把候选前端的协作客户端移植进正式 `web/`（React 19 产品前端），后端**零新增端点**：

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 协议 | `web/src/lib/collaborationProtocol.ts` | 16 类事件白名单严格解码；**新增 `agent.summary` / `agent.readable`**（2026-11-13 P0-03 后端首片）；`summary` 只接受受控结构化事实标记（`EVIDENCE_FROZEN` / `DRAFT_PENDING_REVIEW` / `VISION_REVIEW_QUALITY:*` / `CRITIC_*`），自由文本 fail-closed；`eventId ≠ cursor`；sequence 跳号合法（服务端投影过滤） |
| 传输 | `web/src/lib/collaborationApi.ts` | create/get/cancel + SSE（Cookie 身份、`Last-Event-ID` 续读）；400/401/403/409/410/429/503 分类 |
| 状态机 | `web/src/lib/collaborationReducer.ts` | snapshot→事件状态机；(runId, sequence) 幂等；终态不可重开；未知类型 fail-closed |
| Hook | `web/src/hooks/useCollaborationRun.ts` | 单连接 + resumeCursor 续读；409/410 换快照自愈；账号/run 切换清理；**断连永不发送取消** |
| 组件 | `web/src/components/agent/collaboration/`（Workspace / Timeline / TaskForm / AuthorizedRunImage / PatientResultPanel / ClinicalContent / DoctorReviewImage / labels） | 患者面只见安全摘要与结构化标记；医生投影（`v1:admin` / `v1:doctor:<id>`）才展开交接元数据；无原始 Prompt、无隐藏推理、无完整 Graph State |
| 页面 | `web/src/pages/AgentPage.tsx` | **普通聊天与影像协作显式分离**：协作仅在 `VITE_COLLABORATION_ENABLED=true` 且（点「影像协作」或 URL 带 `runId`）时呈现；默认态与原 `/agent` 聊天完全一致（`agent-chat-region` 隐藏但 ChatInput 常驻可焦点） |
| 路由 | `web/src/App.tsx`、`web/src/components/AccountMenu.tsx` | `/doctor-reviews` 医生复核页（仅 doctor/admin 角色且开关开启时可见入口） |
| API | `web/src/lib/api.ts` | `createAgentSession` + Long→字符串日期归一（JsonConfig 序列化事实） |
| 任务链 | `web/src/lib/diagnosisTaskApi.ts` + `reviewApi.ts` | Task→Run 单动作链（P1-01 前端部分）：幂等上传 → `SafeStatus` 轮询 → `collaboration-runs` 受理（409 INFERENCE_NOT_READY 重试） |

## 2. 模式分离（约束 3）

- `collaboration-default-off.spec.ts`（生产构建口径）：开关关闭时无「影像协作」按钮、无协作 API 调用（计数 0）、`runId` 深链不建连、普通聊天 SSE 正常收发。
- `AgentPage.collaboration.test.tsx`：普通访问与默认关态不发 snapshot/create；新会话只断流不取消；登出清保护视图。

## 3. 医学安全投影（约束 4）

- 患者投影只渲染 `agent.summary` 的受控标记（计数 + 阶段语义）；`agent.readable`/`agent.handoff`/`evidence.verified`/`agent.revision.completed` 在患者面由服务端过滤 + 前端再次校验（`visibility === CLINICIAN` 才接受），双层防线。
- 终态边界：RESTRICTED/FAILED/CANCELLED 永不伪造「完成」与「待医生复核」文案（e2e 三连断言）。
- 未复核内容不出现（`body` 不含临床正文字符串断言，`collaboration-safety.spec.ts`）。

## 4. SSE 断开与重连（约束 5）

- 断开只停止订阅，`disconnect()`/epoch 失效路径**从不调用 cancel**（useCollaborationRun.test.tsx 断言）。
- 重连走 `Last-Event-ID`/resumeCursor 服务端重放，**不重新触发模型调用**：`collaboration-backend.spec.ts`（真实 Java HTTP/MySQL loopback :18085）验证 upload→事件增量→复核→刷新→取消→来源撤回全链，服务端重放不产生新领域写入。
- 幂等受理：`createAgentSession` + `idempotencyKey` 重放不重复建 run（CollaborationRunTest 32/32）。

## 5. Origin 校验与 Vite 代理（约束 6，未关闭任何过滤器）

- 生产 `SameOriginFilter` 全量生效；`SameOriginFilterTest` 8/8，含**新增两例**：
  - `viteDevProxyRequestIsAcceptedWithoutDisablingTheFilter`：代理把 Origin 改写为 target（`vite.config.ts` 显式 `Origin: http://localhost:8081`），后端按同源放行——不需要也不允许关过滤器；
  - `proxiedPortMismatchIsStillRejected`：dev 换端口而代理头未跟随（Origin 8081 vs Host 5199）→ 403，端口混淆不放行。
- 权限负例：越权 403（患者/医生/管理员三投影）、`doctor` 不能取消、`other` 读不到 taskId、未授权读复核 40101（`collaboration-safety.spec.ts` 4/4，真实 HTTP/SSE/MySQL，无路由伪造）。

## 6. 测试结果汇总

| 门禁 | 结果 |
| --- | --- |
| Vitest（37 文件 / 340 用例，含新增协作协议负例 5 个） | **全部通过** |
| `tsc -b` typecheck | 0 错误 |
| ESLint | 0 错误 0 警告 |
| `vite build`（生产构建） | 成功 |
| Playwright `collaboration.spec.ts`（12 项：双主题×双端截图、投影隔离、终态边界、授权清除、刷新/切会话零受理、长记录折叠、键盘/对比度/reduced-motion） | **12/12 通过**（截图先 `--update-snapshots` 生成后人工核对，再无更新参数复跑通过） |
| Playwright `collaboration-default-off.spec.ts` | **1/1 通过** |
| Playwright `collaboration-backend.spec.ts`（真实后端 loopback） | **1/1 通过** |
| Playwright `collaboration-safety.spec.ts`（权限与审核链，真实 Graph/Coordinator） | **4/4 通过** |
| 后端 `CollaborationRunTest`（隔离库 collaboration_test @ MySQL 8.0.26 :3307） | **32/32 通过** |
| 后端 `SameOriginFilterTest` / `AgentChatPrivacyTest` / `UserBoundEyeImageAnalyzerToolTest` | **8+3+7 全通过** |

环境说明：本机 Chromium 用 `E2E_CHROMIUM_EXECUTABLE_PATH` 指向既有安装（headless-shell 1234 / Chromium 151.0.7922.34），未假定 Playwright 下载版本；截图基线为 Windows Chromium，其他平台应单独建立。

## 7. 证据产物

`docs/testing/realtime-collaboration-ui-20261111/`（未入库的哈希锁定验收树之外，本目录此前已存在且未被锁定）：

- `task08b-workbench-light-desktop.png` / `task08b-workbench-dark-desktop.png` / `task08b-workbench-dark-mobile.png` — 双主题三视口工作台实拍（合成夹具，无真实医疗数据）
- `task08b-workbench-clinician-desktop.png` — 医生投影（v1:admin）：交接元数据入口 + 「进入医生复核」
- `task08b-event-trace.txt` — 两条 SSE 流的事件追踪（v1:patient 16 事件 / v1:admin 19 事件）
- e2e 快照基线：`web/e2e/collaboration.spec.ts-snapshots/*.png`（4 张，随 PR 入库）

## 8. 约束遵守核对

| 约束 | 落实 |
| --- | --- |
| 不升级 BOM / 不引入 Vue / 不部署生产 / 不产生真实模型费用 | `pom.xml` 未动（studio 仍仅 test scope）；全部模型输出为合成夹具；仅 loopback 测试服务 |
| 保留 Graph、医学门禁、事务、SSE 重放 | 后端零改动；前端按现有契约消费 |
| 不删 347MB 临时副本 | `../pr68-web-hold` 原样保留；盘点确认其为比 `codex/realtime-collaboration-ui` 更进一步的候选（含 DoctorReviewsPage/PatientResultPanel/reviewApi），本 PR 即其「移植+修订」落地，删除决策留给用户 |
| 禁止展示原始 Prompt / 隐藏推理 / 完整 Graph State | 协议层 fail-closed + 组件层不渲染未知字段；e2e 断言临床正文不可见 |

## 9. 未解决风险 / 遗留

- **候选前端合拢（P0-01）**：本 PR 解决协作客户端部分；`api.ts` 的 `chatDate` 归一与 `createAgentSession` 已并入，其余（AccountMenu 等）按最小 diff 处理。`../pr68-web-hold` 与 git 各分支的差异已全部盘点并被本 PR 覆盖或显式放弃（`test-results/`、`node_modules/`、`dist/` 为可再生产物）。
- **真实验收重跑**：`scripts/collect_product_acceptance.py` 的旧断言（FAIL_BASELINE_MISMATCH、硬编码 15_VS_7、backend 414 PASS 计数）需先修才能重新封存哈希证据（属 P0-04/R5，需真实模型授权）。
- **Mermaid 图示**：ADR §5 决定不引 Mermaid 运行时；`GraphStatus` 五节点拓扑由角色卡片网格表达（本轮以 CollaborationWorkspace 角色区承载），如需独立图示组件在 PR-08C 评估。
- **Playwright Chromium 版本**：CI 需自带浏览器下载或设置 `E2E_CHROMIUM_EXECUTABLE_PATH`；协作 e2e 不进默认 `npm test`（Vitest）与 `verify.yml` web job（保持 typecheck/test/build/lint 口径）。
