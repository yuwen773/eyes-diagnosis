# 冲突解决记录

> 记录每一个冲突文件的**语义**裁定，而不只是「选了哪一侧」。
> 起点 `origin/ui@1ff9c71c`，集成分支 `integration/iris-release-candidate`。

## 1. #112（`eaa8f409`）

| 文件 | 冲突 | 裁定 |
|---|---|---|
| `DiagnosisAgent.java` | `buildAgent` 签名与工具注册方式 | 保留 ui 的三参签名（`sink` + `ToolAuditService` + `UserBoundEyeImageAnalyzerTool`），只追加 #112 的预算拦截器与 `guardedCompileConfig`。**不采用** #112 分支旧两参签名——那会退回按用户绑定的工具，等于把 #117 的修复撤掉 |
| `AgentConstants.java` | 字段尾部 | 保留 ui 的 `exposeReasoning`，与 #112 的 `maxIterations` / `modelCallLimit` 共存（语义不重叠） |
| `AgentGuardrailWiringTest.java` | 测试适配合并实现 | 注入 `ToolAuditService` mock、传 `ToolStepSink`；原断言「事件流不得出现 TOOL_RESULT」改为「成功/终态数 == 真实执行数」，因为合并后工具状态本来就经 sink 下发 |

## 2. #111（`995097fc`）

### 2.1 需要语义裁定的文件

| 文件 | 冲突 | 裁定 |
|---|---|---|
| `DiagnosisAgent.java` | 两套工具观察器、两种事件映射 | 保留 ui 的 sink 结构；删除 #111 的 `ToolExecutionObserver` 与 `toEventDtos`；把资源、正文、时间戳并入既有拦截器与 MapNotNull 分支 |
| `MessageDTO.java` | `status` vs `toolStatus` 字段族 | 只保留 `toolStatus` + `finishReason` + `errorCategory` + `stepLabel`；新增 `timestamp`、`resources`、`toolName`。`status` 字段不引入 |
| `ToolExecutionInterceptor.java` | — | 重写：开跑前/结束前 drain `ToolResourceContext`；成功时补 `toolCallId` 并带脱敏截断正文；异常时记录失败后**原样抛出**（不吞） |
| `ToolStepSink.java` | — | `finished()` 增加 `resources` / `content`；`emit()` 补 `toolName` 与 `timestamp` |
| `ToolStepContract.java` | — | `categorize()` 改为沿 cause 链判定，超时/取消不再一律记成 TOOL_EXCEPTION |
| `AgentController.java` | 日志字段 | 保留 ui 的匿名化口径（`requestId` + `userIdHash`），追加 `imageCount` |
| `application.yml` | 相邻段 | 保留 `max-request-size: 11MB`，追加 jackson 时间序列化配置 |
| `DocumentProcessingService.java` | import | 两侧各一个 import，都保留（`EmbeddingBatchWriter` + `SourceTypePolicy`） |
| `DocumentSearchTool.java` | import | 都保留（`SourceTypePolicy` + `ResourceRef`） |
| `DocumentSearchToolOwnershipTest.java` | import | 保留 #111 新增的 `assertNull` / `assertThrows` |

### 2.2 前端

| 文件 | 裁定 |
|---|---|
| `web/src/lib/api.ts` | **保留 ui 版本**（#111 分支基于旧基线，直接取 theirs 会丢掉 `DiagnosisSource`、`createAgentSession`、`chatDate` 等 #117 能力）；只追加 `ResourceRefDTO` / `timestamp` / `resources` |
| `web/src/lib/agentStream.ts` | 以 #111 实现为准，字段名统一到 `toolStatus`；`evidenceResources` 同时认 `success` 与 `succeeded`；`tool-confirm` 把对应请求步标成 `awaiting-confirm` |
| `web/src/lib/agentSteps.ts` | 以 #111 实现为准；`stateFromToolStatus` 增加 `succeeded` / `running` / `awaiting-confirm`；`tool-request` 分支尊重帧上携带的状态回执 |
| `web/src/components/agent/ThoughtLine.tsx` | 状态图标与说明取 #111，**保留 ui 的 `RunningElapsed` 计时器**（#111 分支没有这个能力，直接取 theirs 属于功能回退） |
| `web/src/styles/agent.css` | 取 #111（新增状态样式）；与 #102 的样式改动无交叉 |
| `web/vite.config.ts` | 取 #111（仅 3 行） |

### 2.3 测试调整（不是放水）

| 调整 | 原因 |
|---|---|
| `AgentGuardrailWiringTest` 终态数断言 | 观察者现包在预算外层，被拒绝的调用也有 failed 终态；成功数仍严格等于预算 |
| `DiagnosisAgentToolEventTest` 重写为 sink 驱动 | 原文件测的是已删除的 `toEventDtos`；新文件覆盖同样的行为（正文、脱敏、截断、资源、失败、超时分类） |
| `agentSteps.test.ts` 期望 `failed` → `error` | 状态词表统一到 #111 的 `AgentStepState`；这是命名统一，不是放宽 |
| `agentStream.test.ts` 期望 `success`→`succeeded`、`error`→`failed` | 前端 `toolStatus` 现原样承载服务端词表，不再二次改名 |
| `AgentPage.collaboration.test.tsx` 资源桩补 `documents` | 桩数据缺字段导致 `countResources` 抛错；补齐桩，不改断言 |

## 3. P0 修复的技术细节

见 `integration-ledger.md` §3。补充两条：

1. **为什么不用框架自带的 `ToolErrorInterceptor`**：它的实现是
   `catch (Exception e) → ToolCallResponse.of(id, name, msg)`，`of` 不设 `status`，
   `isError()` 仍为 false。用它等于把「异常被吞」换了个地方，问题不变。
2. **为什么不让异常直接冒到图**：`alwaysThrow=true` 后异常会逃出 `executeSyncTool`。
   没有最外层兜底就会让整个 ReAct 回合失败、SSE 断流，把一次可解释的工具失败
   伪装成系统故障。边界拦截器把异常转成 `error` 响应，模型据此收尾。

## 4. 未采用的 #111 能力（登记为后续）

- 落库键名：最终用 `status`，历史侧解析同时兼容 `toolStatus`。
- #111 的 `tool-response` 独立通道：为保持「一条通道」而未采用，
  正文改由终态帧承载。
