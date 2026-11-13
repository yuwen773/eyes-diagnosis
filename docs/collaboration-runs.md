# Coordinator 持久事件与 SSE：契约 v1

2026-11-11，TASK-03。该文档冻结现有 Coordinator 的事件边界，供 TASK-02 Graph 适配和 TASK-04 React 共用。Graph 未切换，角色仍通过同步模型调用产生结构化结果。验收见 [测试报告](testing/2026-11-11-realtime-coordinator-events.md)。

TASK-02 后续扩展见 [Graph 执行契约](graph-execution.md)：同一 DTO v1，增加默认关闭的新受理运行时选择和应用事务检查点。下文 TASK-03 的固定运行时与“不支持执行续跑”描述保留为该卡历史边界；Graph 的租约、接管和节点复用以新契约为准，Coordinator 行为不变。

TASK-07 后续扩展见 [权限、监控与回退手册](collaboration-release-runbook.md)：新增默认关闭的新受理/患者进度/医生详情开关，新增管理员聚合监控接口。订阅鉴权后的首批会立即发送真实心跳，避免无新事实时等待15秒才打开响应；后续心跳间隔不变。总开关应在活动run排空后才关闭；当前生产配置在启动时注入，不支持在线刷新。下文原启用说明应结合该手册执行。

## 启用与运行绑定

默认关闭。只有显式配置 `eye-diagnosis.collaboration.enabled=true` 时才注册本卡的 API、worker、事件存储和 SSE。启用前必须配置 `eye-diagnosis.collaboration.cursor-key`：部署方生成的 64 位十六进制密钥，跨实例/重启保持一致，不能入库；缺失或格式错误启动失败。该开关允许模型调用，独立于旧的 `eye-diagnosis.draft.enabled`。关闭新开关后旧 API/worker 原状保留；已有新 run 应先排空或持久取消再回退。

`t_agent_collab_run` 是现有 `t_diagnosis_task` / `t_patient_draft_run` 的受理与事件绑定，执行事实继续由原 Coordinator 写入。taskId 唯一绑定一个 runId；run 固化 ownerUserId、已有聊天 sessionId（threadId）、推理快照摘要、`COORDINATOR` 和 `AUTONOMOUS_V2`。本卡仅受理已有图像任务，不新增文字问答工作流，不收客户端 owner、runtime、推理摘要或医学输出。

创建必须拥有任务及未删除、有效的聊天会话。尚未完成推理返回 409 `INFERENCE_NOT_READY`。已有受限推理可创建安全终态，原因 `INPUT_RESTRICTED`，不启动角色。WAITING_REVIEW 任务仍经原推理绑定/拒识/OOD 门禁；不合格时进入 RESTRICTED。禁止把旧的、没有事件的草稿运行事后拼接为实时 run，返回 `LEGACY_RUN_NOT_ADOPTABLE`。

同 owner 的 idempotencyKey + 相同 taskId/threadId/推理摘要重放同一 run；不同输入返回 `IDEMPOTENCY_CONFLICT`。任务已被其他键绑定返回 `TASK_ALREADY_BOUND`。每个 owner 最多 2 个活动 run。请求在数据库提交受理后进入独立单线程、有界 16 项队列；队列满时保留 ACCEPTED，250ms 扫描补领。重连、查询和订阅从不派发任务。

## HTTP

均复查服务端 Spring Session 和数据库用户/授权；用户 ID 来自 session。查询与订阅：owner 只得患者投影，管理员得元数据详情，医生仅凭既有 `t_doctor_review` 明确分配读取非本人材料。取消仅限 owner 或管理员。无权和不存在均 403 `ACCESS_DENIED`。所有响应 `Cache-Control: no-store`。

| 方法与路径（含 context-path） | 请求 / 响应 data |
| --- | --- |
| POST `/api/agent/collaboration-runs` | `{taskId, threadId, idempotencyKey}` → Snapshot |
| GET `/api/agent/collaboration-runs/{runId}` | Snapshot |
| GET `/api/agent/collaboration-runs/{runId}/events` | SSE；`Last-Event-ID` 或 `cursor` 参数，须从快照/上次已处理事件取得 |
| POST `/api/agent/collaboration-runs/{runId}/cancel` | `{status, outcome}` |

JSON 成功沿用 `BaseResponse{code:0,data,msg}`。协议错误使用真实 HTTP 状态，body 沿用 BaseResponse，msg 为分类码。没有单独 `/history`：本卡历史读取由快照 + 同一有界 SSE 重放提供；终态续读仍不会重跑。

Snapshot 字段：runId、taskId、threadId、runtimeKind、workflowVersion、executionStatus、reviewStatus、reason、roles（角色→状态）、snapshotSequence、resumeCursor、projectionVersion。没有草稿正文、推理、证据内容或对象地址。医生批准后的正文继续走既有发布/来源复验/患者保存授权接口，本卡不提供另一条正文出口。

## DTO 与字段白名单

事实 DTO：`{eventId, schemaVersion:1, runId, threadId, sequence, occurredAt, type, actor, visibility, payload}`。eventId=`runId:sequence`；occurredAt 为数据库事实时间对应的 ISO Instant。sequence 按本 run 提交顺序递增，与原 message.sequence（调用登记顺序）独立。actor 仅 COORDINATOR/VISION/EVIDENCE/EXPLANATION/CRITIC，visibility 仅由后端生成。不存在 delta/token 事件，不把同步模型结果拆字发送。

每个载荷白名单固定如下；存储拒绝额外/缺失键，JSON UTF-8 上限 16KiB。本卡不发模型正文、prompt、上下文、隐藏推理、quote、影像地址、身份数据、原始异常或完整 Graph state；医生元数据也不包含这些字段。

| type | actor | visibility | payload 的完整键集合 |
| --- | --- | --- | --- |
| run.accepted / run.started | COORDINATOR | PATIENT | status |
| run.review_ready | COORDINATOR | PATIENT | draftVersion, reviewStatus |
| run.completed | COORDINATOR | PATIENT | status, reviewStatus |
| run.restricted / run.failed | COORDINATOR | PATIENT | status, reason |
| run.cancel_requested / run.cancelled | COORDINATOR | PATIENT | status |
| agent.started / agent.completed | 对应角色 | PATIENT | call |
| agent.summary | 对应角色 | PATIENT | call, summary, limitationCount |
| agent.feedback.requested | CRITIC | PATIENT | action（REWRITE/SUPPLEMENT）, call |
| agent.readable | 发件角色 | CLINICIAN | call, messageId, to, kind, content |
| agent.handoff | 发件角色 | CLINICIAN | messageId, to, kind, call |
| evidence.verified | EVIDENCE | CLINICIAN | evidenceVersion |
| agent.revision.completed | EXPLANATION | CLINICIAN | draftVersion, evidenceVersion |

`agent.summary` 与 `agent.readable` 是从**已通过校验的结构化角色输出**派生的可读投影（2026-11-13 起）：
- `agent.summary`（患者投影）：`summary` 只能是**结构化事实标记**（`VISION_REVIEW_QUALITY:<reanalysisSuggestion>`、`EVIDENCE_FROZEN`、`DRAFT_PENDING_REVIEW`、`CRITIC_<action>`），不是模型文本——绝不携带临床正文、摘要原文、引用原文或 prompt；`limitationCount` 是结构化计数（Vision limitations 条数、冻结证据引用条数、draft claim 条数、objection 条数）。患者看到的仍是阶段语义（与 snapshot `roles` 状态一致），只是更细粒度。
- `agent.readable`（医生投影，仅 `clinician-detail-enabled`）：`content` 是该角色已校验输出记录的 JSON 序列化（Vision 结构、冻结证据引用列表、Draft claims、Critique），与 `agent.handoff` 同一信封对齐。这不是隐藏思考链——它们本来就是医生复核可见的结构化结果；原始临床正文的发布仍走既有医生批准/患者保存授权接口。

SSE 的 `event` 等于 DTO.type，`data` 为 DTO，`id` 是下述不透明游标。患者被过滤的事件不产生占位消息；sequence 跳号合法。客户端按 (runId,sequence) 幂等且不得倒退；未知 schemaVersion、未知关键类型或无法解释的状态迁移时停止应用并重新取快照。v1 不允许静默忽略关键事件；增加类型/改变语义需要新协议/投影版本。

## 一致性与重放

领域状态、角色摘要、水位递增和事实事件使用同一数据源事务；没有写入前分发。旧 Coordinator 的真实派发、已验证结果、受控证据冻结、草稿落库、真实定向信封与终态是写入点。被拒绝的输出保留原内部审计路径，不生成成功角色事件。

应用事务使用 READ_COMMITTED，并锁定 run 行读取状态、roles 和水位 H；快照三者来自同一提交边界。创建依 owner 行锁串行化幂等与并发限额；领域提交/取消依任务行锁串行，随后锁 draft/run。旧 Coordinator 的事务配置不变。运行中的角色状态包括 RUNNING/COMPLETED，终止时未完成角色变 STOPPED。

SSE 扫描 seq > H 的已提交事实，每批最多 32 条，过滤后按递增顺序输出。数据库是唯一追赶来源，250ms 轮询不依赖进程内通知，因此断线、丢通知或跨实例重启不会漏已提交事实。不能先取得旧状态再签发新水位游标。

游标使用 AES-256-GCM（随机 nonce），加密并绑定 runId、扫描水位、用户、授权投影版本与签发时间。cursor 与 Last-Event-ID 同时出现必须逐字相同。DTO 的 eventId 不能充当 SSE id。游标不能代替每次鉴权。医生授权绑定 reviewId，角色/投影变化要求重新取快照。

| HTTP | msg | 客户端行为 |
| --- | --- | --- |
| 400 | INVALID_REQUEST / INVALID_CURSOR | 修正请求；不能用事实 ID 当游标 |
| 400 | SNAPSHOT_REQUIRED | 未传游标，先取快照 |
| 403 | ACCESS_DENIED | 清除受保护协作态 |
| 409 | SNAPSHOT_REQUIRED | 投影变化，替换为新快照后续读 |
| 410 | CURSOR_EXPIRED | 游标签发已满 7 天，重新取快照，不创建 run |
| 429 | RUN_LIMIT / SUBSCRIPTION_LIMIT | 减少活动任务/连接 |
| 503 | SESSION_REVALIDATION_UNAVAILABLE / STREAM_UNAVAILABLE | 服务依赖不可用，稍后重连 |

这些错误在开启 SSE 前判定。活动订阅每批读取前及每次发送前，重新读取 SessionRepository 与当前数据库授权；会话失效、退出或授权撤回关闭连接，丢弃尚未发送的队列。已在网络传输中的字节无法撤回。

传输默认每进程 8 个连接、每用户 2 个；每连接最多缓存 64 帧，超限关闭（内部 SLOW_CONSUMER），已持久事件保留并按旧游标重连。心跳每 15s 一次，`event:run.heartbeat`，data=`{schemaVersion:1}`，id 是此前可见事件按序发送后的扫描游标。心跳不是持久事实；客户端串行处理完可见事件后才保存其游标。连接最大 180s，终态发送完后以最终心跳游标结束。取消/超时会清理订阅，不改变执行任务。

游标有效期 7 天；当前没有事件删除任务，保留窗口内的事实均存在。生产数据删除/归档策略尚未上线，不能外部先删事件再宣称支持重放；后续清理需持久 replay floor 并返回 410。此默认值是开发防护值，未宣称达到生产容量或延迟目标。

## 执行、取消和审核

执行：ACCEPTED → RUNNING → SUCCEEDED / RESTRICTED / FAILED；ACCEPTED/RUNNING → CANCEL_REQUESTED → CANCELLED。成功与 run.review_ready、run.completed 同事务，按该顺序写事件；reviewStatus 仍 PENDING。受限/失败/取消不提交复核。已有医生复核结果由既有表查询，APPROVED/REJECTED/INVALIDATED 不会改写成功执行历史，本卡不新增复核决策事件。

取消先提交 CANCEL_REQUESTED 并封住草稿运行，再用第二事务确认 CANCELLED；若中间崩溃，250ms worker 补确认。前者持久提交后所有派发/结果/草稿/最终提交受同一任务锁和状态门禁阻止；已提交终态优先则返回 ALREADY_TERMINAL，重复取消返回 ALREADY_CANCELLED。既有诊断任务映射为 RESTRICTED（不是新医学结论），草稿内部状态 CANCELLED。

事件循环约每 20ms 复查取消，尽力中断在途 future。CANCELLED 表示应用逻辑拒绝后续写入，不承诺提供方停止、退款或不计费。取消前已提交的内部草稿仍保留审计，永不因此公开。SSE 关闭与主动取消完全独立。

原调用预算不变：最多 8 次模型调用、总 90s、单次 20s。原 Coordinator 崩溃后的运行到期仍收敛为 INTERRUPTED_OR_TIMEOUT，映射 FAILED；本卡没有声明从已提交角色结果继续执行。租约接管、递增 fencingToken、恢复时复用已完成节点及预算内重试仍属于 TASK-02；SSE 事件恢复与执行恢复分开验收。

来源失效/无效引用/非法输出分别保留原门禁分类，映射 RESTRICTED；PROVIDER_AUTH、PROVIDER_RATE_LIMIT、PROVIDER_UNAVAILABLE、MODEL_BUSY 和超时/中断映射 FAILED。所有失败保持 NOT_SUBMITTED，不生成伪正常完成。

## 迁移和回滚

本卡只追加 Java 线 V18，不编辑历史迁移，不补造缺失 V15，不修 master/Java 的 V15–17 历史冲突。应用前核对实际 Flyway history；整分支/生产迁移仍受此前数据库专项约束。测试在隔离 schema 使用真实 V10–13、V16–18 DDL 和最小用户/会话夹具，不能当成全部历史环境升级通过。

回退先停止新受理，待已有 run 排空或持久取消，再停新 API/worker；关闭开关即可恢复旧执行路径。保留新增表供审计/重放，不回删表或 Flyway 历史。Graph 开关及模型/OOD/医生发布门禁没有改变。
