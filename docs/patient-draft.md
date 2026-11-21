# 四 Agent 患者解释草稿

对应 [#19](https://github.com/yuwen773/eyes-diagnosis/issues/19)，父规格为 [#15](https://github.com/yuwen773/eyes-diagnosis/issues/15)。本阶段只生成可供后续医生复核的内部草稿，不批准、发布或创建正式诊断记录。

## 接入与权限

`PatientDraftCoordinator.run(taskId)` / `runPendingOnce()` 是可信后端调用边界，不是 HTTP 接口。`inspect(taskId)` 用于后续复核流程接入及受限运维检查，包含敏感草稿和结构化协作消息，不能直接返回给患者；后续医生入口仍须独立实现角色、任务授权和自我复核限制。现有患者任务 HTTP 接口只返回 `taskId`、安全状态；生成期间为 `PROCESSING`，草稿就绪后为 `WAITING_REVIEW`，失败为 `RESTRICTED`。

调度器默认关闭。为经授权的演示环境配置 `eye-diagnosis.draft.enabled=true` 后，它会读取 #17 的有效推理快照并调用当前模型提供方。该开关控制外部数据发送，不改变四 Agent 的必经协作流程。模型上下文只含分析必需的预测、质量、校准状态和模型/预处理版本及快照摘要；不发送患者身份、原图、对象地址或聊天历史。未评估 OOD、拒识、未知标签和输入身份不匹配均不启动生成。已有聊天及同步诊断入口不接入此流程。

## 自治协作正式契约（AUTONOMOUS_V2）

2026-11-10 用户确认 [B 规格变更](plans/2026-11-10-autonomous-four-agent-spec-proposal.md)。新领取任务采用以下正式流程；历史记录保留 `SEQUENTIAL_V1` 和原始冻结材料，不重跑或回填消息。

四个角色各持有任务内独立收件箱与状态。Vision 与 Evidence 同时基于同一获准推理摘要开始，Evidence 首轮没有 Vision 结果。角色完成后经服务端校验，签发带任务、发送者/收件人、原因消息、推理摘要及证据/草稿版本的结构化消息。Explanation 同时收到 Vision 摘要和冻结证据后生成；Critic 收到匹配版本的草稿后独立复核。Critic 的补证/重写请求送入对应收件箱，驱动一轮反馈，不能任意转发、选工具或扩大权限。

同一任务最多两个模型请求在途，执行器及队列有界。消息序号是预扣额度的登记顺序，不表示并行完成先后。每个角色、材料版本只推进一次，重复触发不重置预算。任一角色失败即受限并取消其他在途请求；忽略取消的提供方可继续计费，但其迟到输出没有写入或发送消息的能力。

## 独立角色

四个独立 Agent 使用不同系统约束、上下文类型和输出模式；共享无隐式历史的模型传输层，角色收件箱与已处理状态按任务隔离。每次模型请求显式构造获准上下文，不共享跨角色或跨任务聊天历史。

| Agent | 上下文及输出 | 工具权限 |
|---|---|---|
| Vision | 现有推理摘要、质量限制、再分析建议 | 无；建议仅为枚举记录，不能动态预处理或重推理 |
| Evidence | 首轮只读推理；补证时读 Vision 摘要及可定位反馈；输出检索查询 | 唯一能力是 `ControlledEvidenceRetriever`；服务端将推理标签映射为大写疾病码，主题固定为 `PATIENT_EXPLANATION`，模型不能更改范围 |
| Explanation | 同一推理、Vision、冻结证据的索引与原文片段；不向模型提供标题/来源；重写时附原稿与异议 | 无；输出六个分层区段和逐声明引用映射 |
| Critic | 同一推理、Vision、冻结证据和当前草稿；不传先前 Critic 意见 | 无；只能提出指向具体 claim、证据索引或 Vision 摘要的异议 |

传输层禁用自动工具执行，拒绝工具调用输出，拒绝未知字段、重复键、缺失字段、尾随文本或无效 JSON。OpenAI / DashScope 的草稿专用模型副本禁用 Spring AI 自动重试，保留原聊天模型配置。其他 `ChatModel` 适配器须保证一次 `call` 只发送一次请求，接入前需验证。

## 冻结、反馈和停止

每个任务绑定不可变推理快照的 SHA-256。初始证据包冻结文档版本、治理版本、片段原文与摘要；Explanation 的每条声明映射到本版本的引用索引及精确原文子串，并包含 `MAIN_FINDING`、`RISK`、`NEXT_STEP`、`UNCERTAINTY`、`DETAIL`、`LIMITATION` 六个区段。校验只证明引用可追溯，不证明医学语义受支持；医生及领域评估仍是后续门禁。

默认每任务最多 8 次模型调用、总耗时 90 秒、每次至多 20 秒。程序预先持久化调用额度，再调用模型；失败、取消、结果不确定均不退还。最多补证一次、重写一次，合计只允许一轮反馈；两条初始并行请求可能均已扣额，失败场景不再保证只调用一个角色。Critic 请求补证时，重新通过受控检索形成版本 2，保留原引用，并重新冻结；随后使用新证据重写并再次独立检查。再次提出任何补证/重写请求都会停止，不能循环。直接重写不产生虚假的新证据版本。

`V12` 新增内部运行、冻结证据版本、草稿版本和协作消息表；V16 增加实际调用计时，V17 增加 `workflowVersion`（旧记录默认 `SEQUENTIAL_V1`，新记录显式 `AUTONOMOUS_V2`）。消息记录角色、序号、开始/完成/停止状态及 `{context,result,collaboration}` 结构化业务材料，不记录原始思维链；调用预扣时存最小上下文和实际收件信封，开始请求时写起始时间，完成后补入结果与已校验的发件信封。`collaboration` 包含流程版本、`inbox` 和 `outgoing`，进入原有医生冻结消息与材料摘要；终态后不再追加。Critic 上下文包含它实际检查的草稿和冻结证据版本，直接重写复用证据版本时也能精确回查。证据与草稿只追加新版本。默认调用超时取消不能保证提供方停止计算，但迟到输出没有写库或放行能力，执行器队列有界。所有写入使用数据库保存的规范任务 ID，大小写别名不会创建独立预算。

完成前在 #18 的持锁复验事务内检查全部冻结来源，再原子提交 `REVIEW_READY` 和任务等待复核状态。来源资格/版本变化、证据不足、无效输出、引用不符、不可定位异议、超时、过期执行者或预算耗尽均记录停止原因并进入受限。提供方故障与模型输出故障分开记录：`PROVIDER_AUTH`（401/403）、`PROVIDER_RATE_LIMIT`（429）、`PROVIDER_UNAVAILABLE`（其他 HTTP 状态、连接/读取失败）来自传输层，`INVALID_OUTPUT` 只表示输出无法解析或不满足契约，`AGENT_TIMEOUT` 表示超出本次调用时限。两者都进入受限且不自动重试，但运维排查只看停止原因即可区分凭据、配额和网络问题与模型输出问题。`REVIEW_READY` 表示草稿具备结构化复核材料，不代表 Critic 或程序给出了临床发布授权。#20 及以后仍须在医生确认、发布和保存时重新持锁验证来源。

进程崩溃后不自动重跑模型；运行记录和预扣额度保留，截止时间到达后由轮询标为 `INTERRUPTED_OR_TIMEOUT`，不以重启重置额度。这是保守的中断恢复，不提供 Agent 调用 exactly-once 或跨进程续写。

## 运维试验台（可选）

默认不注册。只有显式设置 `eye-diagnosis.draft.test-entry.enabled=true` 时才加载 `PatientDraftTestService` / `PatientDraftTestController`，并且 `@AuthCheck(mustRole="admin")` 只对管理员开放；生产部署不设置该属性即完全没有这个入口。它不新增能力：触发走的是同一个 `PatientDraftCoordinator.run()`，与后台轮询的执行路径一致，重复触发不会绕过既有预算或幂等限制。

| 接口 | 用途 |
|---|---|
| `GET /api/patient-draft-test/tasks` | 最近 20 个任务及其运行状态、停止原因、已用调用数 |
| `GET /api/patient-draft-test/tasks/{taskId}` | 逐角色状态与耗时、冻结证据、每次 Explanation 输出的引用校验结果、停止原因与预算 |
| `POST /api/patient-draft-test/tasks/{taskId}/run` | 异步触发一次；同一时间只允许一个手动任务 |
| `POST /api/patient-draft-test/seed?label=glaucoma` | 写入一个合成任务与一份合成资料（标题 `SYNTHETIC-<label>`、来源 `synthetic.invalid`）；仅当再开启 `eye-diagnosis.draft.test-entry.allow-seed=true` 时注册 |

返回给页面的是角色状态、耗时、**逐角色实际收到的上下文与产出**、冻结片段与解释声明，**不含**推理快照、对象地址或患者身份。上下文、产出和消息来自协作消息已持久化的 `{context,result,collaboration}`（推理侧只有摘要摘要、标签、质量与版本字段），页面用中文字段名渲染成键值树，并保留原始 JSON 供排查。被引用校验拒绝的解释输出仍保留在协作消息里，因此页面能看到是哪条引文没有逐字出现在冻结片段中。前端页面为 `/admin/draft-test`（`DraftTestPage.vue`），仅在管理员侧边栏可见。逐角色耗时来自 `V16` 为 `t_patient_draft_message` 增加的 `startedAt` / `completedAt` 两列。

## 验证

使用 JDK 21，设置隔离的 `ISSUE19_TEST_URL=jdbc:mysql://127.0.0.1:<port>/issue19_test`（用户和密码均为测试专用 `issue19`），执行 `mvn -Dtest=PatientDraftTest test`，随后执行 `python scripts/check_surefire_skips.py target/surefire-reports issue19`。该数据库仅允许用于本套件的合成数据，会清空其本任务表。

自治化前的 37 个测试包含真实隔离 MySQL、受控模型/时钟、患者 HTTP 投影、补证与重写上限、重复补证不产生相同证据版本、无效推理不启动生成、严格输出/引用校验、来源撤回、迟到输出、并发领取、独立 JVM 崩溃和提供方重试替身；其中真实 Spring AI 传输替身覆盖 401、429、502 与传输层 IOException 的停止原因归类，运维入口覆盖默认不注册、仅管理员可达、逐角色计时、引用复核、轨迹不含原始推理，以及重放不新增调用。没有数据库时显式跳过；专用 CI 门禁要求全部运行。工程测试不等同真实提供方、真实 Python、领域或临床验收。

2026-11-10 还通过运维试验台对真实 `qwen3.5-plus` 跑了 6 个合成任务（关闭 thinking）：1 个四角色走完进入 `REVIEW_READY`（4 次调用、约 12.6 秒，引用逐字命中），5 个因 `INVALID_CITATION` 受限，其中 4 个是模型把 citation 的标题/来源当原文引用。记录见 [运维入口交付说明](testing/2026-11-10-draft-test-entry.md)。

2026-11-10 补充执行了 [真实提供方四角色协作验证](testing/2026-11-10-four-agent-real-provider-validation.md)：合成上游和资料资格夹具、真实隔离 MySQL、真实 `qwen3.5-plus`，显式关闭模型 thinking 后，两个场景中一个完成四角色并进入 `REVIEW_READY`，另一个因无效引用受限。工程专项同时重跑 27/27、零跳过。该结果只验证所述四角色边界，不等同真实图像/OOD 到四角色、医生及患者保存的联合验收。


## 自治流程验收范围

新增同步屏障验证 Vision/Evidence 真实重叠、角色消息及版本绑定、Explanation 元数据隔离、并发额度和兄弟请求失败/迟到结果保护。专用套件与报告计数按本次实际用例同步，必须实际运行且零跳过。#20–#22 回归包含自治材料经医生复核、患者读取及授权保存的实际 HTTP/数据库链路；篡改协作信封仍须使原冻结材料失效。

管理员 `/admin/agent-collab` 三个视图共用真实轨迹。②显示真实时间和定向消息，重播不调用模型；历史顺序记录不补造自治事件。①、③保留每次调用，不丢弃同角色的补证、修订或再次复核。患者只看到固定业务进度，不看到这些内部消息。

本轮真实提供方验证授权上限为两个合成任务、合计最多 16 次模型调用。实际成功、失败与未完成部分见 [2026-11-11 自治验收记录](testing/2026-11-11-autonomous-four-agent-acceptance.md)；此前顺序流程的真实模型结果不能替代本轮证据。上线前应停止旧流程接单并等待运行结束或到期受限；不允许旧二进制接管 `AUTONOMOUS_V2`，不通过删除迁移或重写历史材料回滚。
