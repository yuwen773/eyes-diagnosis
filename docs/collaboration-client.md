# React 协作事件层与工作台（TASK-04 / TASK-05）

正式 `web/` 的事件消费与工作台作用域由 TASK-04 提供，TASK-05 增加时间线及图像任务受理。产品验收候选补齐空会话受理、医生复核、授权影像和患者显式保存；当前证据与局限见 [产品验收报告](testing/2026-11-12-realtime-product-acceptance.md)。事件层验收见 [TASK-04 报告](testing/2026-11-11-realtime-react-events.md)，工作台验收见 [TASK-05 报告](testing/2026-11-11-realtime-collaboration-ui.md)。

## 完整产品闭环

用户显式上传前，`POST /api/agent/sessions` 以当前登录账号创建或确认所属空会话，不调用模型。会话列表与历史消息兼容 Java 数字时间戳和 ISO 时间字符串，刷新不会重建任务。

`/doctor-reviews` 只在前端协作开关开启且账号为医生/管理员时提供入口；后端独立校验真实身份。管理员只输入任务与医生标识进行分配。明确分配的医生读取冻结版本、可定位条目、来源、结构化交接与异议，填写非空意见后批准或驳回。原图通过 `GET /api/doctor-reviews/{reviewId}/image`，工作台通过 `GET /api/agent/collaboration-runs/{runId}/image` 读取；后端核对对象版本、摘要与即时权限，不公开对象地址。管理员元数据权限不含原图或临床正文。

患者工作台只在本人任务获批后读取现有患者解释和引用接口。保存前展示版本绑定的完整拟存内容（包括模型预测和原始概率），复选框默认未勾选；患者明确同意后才提交授权。同一批准回放同一回执。读取/保存冲突会清除旧正文和勾选状态，失焦或退出清除受保护内容，重新聚焦需重新授权读取。保存请求不会自动重试。

执行事件协议仍为 v1，临床正文和内部推理不进入 SSE。上述界面不替代来源复验、医生资格或 OOD 门禁。

## 启用及选择运行

默认关闭。开发/构建时显式设置 `VITE_COLLABORATION_ENABLED=true` 后，`/agent` 出现影像协作入口；已有 `/agent?runId=<运行>&threadId=<会话>` 可恢复协作读取。生产构建需要重新构建才能更改该值。普通访问不会自动创建任务；未登录或开关关闭不发协作请求。

运行必须属于当前登录身份可访问的、当前选定的会话；后端快照的 runId/threadId 必须同时匹配。会话 ID 沿用现有按用户恢复的会话选择。新建或切换会话会移除 runId 查询参数；身份切换立即换用新的内存作用域。URL 中的 runId 是选择标识，不是授权凭证；没有在 localStorage 保存游标、事件或协作正文。

TASK-04 原候选仅含 React 前端与契约夹具；TASK-05 的独立整合候选已引入 TASK-03 后端，并保留两卡输入哈希。真实环境仍须准备后端独立开关、会话、数据库和游标密钥；前端开关不会自动启用后端或迁移生产数据库。

## 接口与状态

- `collaborationApi`：显式 create、snapshot、cancel 和单连接 stream；请求携带 Spring Session cookie，禁用缓存。create 必须传入已有 taskId、threadId 和用户动作对应的 idempotencyKey；恢复流程绝不调用 create。
- `collaborationProtocol`：验证 schema、事件类型、角色、投影与载荷白名单。Java `long` 的十进制字符串在安全整数范围内归一化，拒绝精度丢失。没有模型正文、推理、影像 URL 或未经复核草稿的入口。
- `collaborationReducer`：快照替换并设水位；按 runId/sequence 消重、忽略已消费的旧事件；允许授权过滤跳号。心跳只更新不透明游标。执行终态不能退回，`SUCCEEDED` 的 reviewStatus 仍是 `PENDING`。
- `useCollaborationRun`：以 identityKey/threadId/runId/enabled 创建独立实例；隔离旧请求、旧帧和旧取消回执。返回 run、connection、cancelling、error、cancel、retry。
- `CollaborationRunContext`：已有 AgentPage 为其工作台子树提供上述值，供 TASK-05 面板消费。普通聊天仍使用独立的 useAgentStream。

角色及运行状态以服务端快照/事实为准；取消 HTTP 回执不被合成为事件。取消成功或 `ALREADY_TERMINAL` 后重新读快照。取消失败显示 `CANCELLATION_UNCONFIRMED`，不假定已取消。关闭普通聊天流、换会话或卸载页面都不发送持久取消。

## 重连与错误边界

SSE 使用同一个 `@microsoft/fetch-event-source` 库；传入 `Last-Event-ID` 的是已应用事实或心跳的不透明游标，不是 eventId。传输库的自动重试被关闭，由当前作用域控制重连。

断流和 429/5xx 按 1、2、4、8、15 秒上限退避，取消选择会清理计时器。重连授权通过前隐藏旧投影；重连不重建任务。403/401 清空受保护态并停止；409/410 或不可解释的协议/迁移重新读快照并替换旧投影。连续两次修复仍无法解释时停止并返回 `PROTOCOL_MISMATCH`，由显式 retry 重试，避免无限协议修复。

事件时间线只保留最近 200 项；这不是完整历史查询接口。快照给出当前角色摘要，刷新不补造过去的实时进度。医生复核结果只从新快照读取，不根据执行完成推定批准；完整发布仍走既有审核/授权链路。

## 契约与回归

`web/src/lib/__fixtures__/collaboration.v1.json` 是人工定义的合成样本，`collaboration.wire.v1.json` 由 `scripts/fixtures/CollaborationWireFixture.java` 使用 TASK-03 的真实 DTO 和 JsonConfig 序列化生成；均不包含真实患者或提供方响应。

`python scripts/check_collaboration_fixture.py --backend-root <TASK-03工作树>` 将两套夹具与实际 Java record/载荷白名单对照并记录源文件哈希。该检查要求真实候选源码，缺失即失败，不静默跳过；本卡独立分支的 CI 运行 React 全套检查，后端源码对照结果保存在验收证据中。

回退时不设置前端开关并重新构建即可；卸载客户端只断开订阅，活动后端运行继续按原语义执行。需取消任务时显式调用已授权的取消接口。不要删除后端事实或更改审核状态。

## TASK-05 工作台

已有 `/agent` 的“影像协作”提供显式提交入口；普通聊天、附件、MCP/RAG 资源仍走原模块。新会话须先发送一条文字消息建立服务端会话；当前契约没有独立创建空会话接口，不以隐式模型请求代替用户操作。

影像提交只接受单张 JPEG/PNG、最大 10 MB；最终文件校验由已有 DiagnosisTaskService 执行。选择文件不请求后端。显式提交创建本人图像任务，最多轮询 60 次、间隔 2 秒等待推理，再以稳定 taskId/threadId 幂等键受理协作。处理超时后的继续操作沿用原任务；换会话/登出卸载表单会中止等待，已经受理的任务不因此取消。已有影像任务可以从服务端本人列表选择。

角色条只使用快照/已提交事件；未执行角色保持等待或未执行。时间线默认折叠为最近 30 项，可展开到 reducer 保留的 200 项；读者上滑时停止自动跟随。患者只见安全进度，医生/管理员必须取得后端授权投影才可展开交接/修订元数据。未知原因不直接打印；临床正文、隐藏推理、claim 质疑文本均不由当前 v1 DTO 提供。

执行与复核分别显示；成功仍待医生复核，不生成可公开结论。复核状态刷新来自新快照。取消只在显式点击后 POST；ACK 不被合成为终态。活动授权撤回、重连等待时清除或隐藏角色、时间线与影像面板。

本次上传的本地影像预览绑定身份/runId，仅使用短期 Blob URL；更换或卸载后回收。刷新/既有任务选择不拿聊天附件代替本任务影像。当前接口没有授权影像下载、引用正文或具体 claim 级因果引用，这些区域如实显示缺失，不能以元数据版面冒充完整审查材料。医生详细审查和批准后发布沿用原流程，继续交 TASK-07 验收。

两主题沿用 tokens.css；手机收起会话后主舞台保持可见，影像/证据为可折叠区域。新增角色状态尊重 reduced-motion，状态文字与 live region 不依赖颜色。验收见 [TASK-05 报告](testing/2026-11-11-realtime-collaboration-ui.md)。
