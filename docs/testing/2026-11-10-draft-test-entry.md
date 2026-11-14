# 四 Agent 运维入口与停止原因细分

日期：2026-11-10。对应 [四 Agent 工作汇报](2026-11-10-four-agent-work-report.md) §7 的第 1、2 项。

## 结论

工作汇报里"后续优先工作"的两条已落地：**（a）停止原因不再把提供方故障算成模型输出故障；（b）新增仅管理员可用、默认不注册的四 Agent 手动测试入口，含前端页面。**

工程证据来自专项测试与前端单元测试。之后用一次性 MySQL 8 容器把完整应用真起了一次：先用**故意错误**的提供方密钥把入口走到 `PROVIDER_AUTH`（零 token），换成本机环境变量里的真实密钥后跑了 6 个合成任务，其中 1 个完整走完四角色进入 `REVIEW_READY`，5 个因引用不符被拒。浏览器里对真实后端逐页点击仍未做。

## 改动

| 层 | 文件 | 内容 |
|---|---|---|
| 停止原因 | `PatientDraftCoordinator.java` | `ExecutionException` 不再一律记 `INVALID_OUTPUT`：按异常链区分 `PROVIDER_AUTH`（401/403）、`PROVIDER_RATE_LIMIT`（429）、`PROVIDER_UNAVAILABLE`（其他状态码、连接/读取失败）；Jackson 解析失败仍是 `INVALID_OUTPUT`；action 内部抛出的 `Stop` / `EvidenceUnavailable` 原样上抛，不再被覆盖 |
| 计时 | `V16__patient_draft_message_timing.sql` | `t_patient_draft_message` 增加 `startedAt` / `completedAt`，由协调器的注入时钟写入；旧行为 NULL |
| 后端入口 | `PatientDraftTestService.java`、`controller/PatientDraftTestController.java` | `GET /api/patient-draft-test/tasks`、`GET /api/patient-draft-test/tasks/{taskId}`、`POST .../run`；`@ConditionalOnProperty(eye-diagnosis.draft.test-entry.enabled=true)` + `@AuthCheck(mustRole="admin")`；同一时间只允许一个手动任务；`RoleRow` 额外返回该角色已落库的 `context` / `result`（脱敏，解析自协作消息的 `{context,result}`） |
| 前端 | `frontend/src/pages/admin/DraftTestPage.vue`、`components/TraceValue.vue`、`api/patientDraftTest.ts`、`router/modules/adminRoutes.ts`、`AdminSidebar.vue` | `/admin/draft-test`：任务列表、触发、逐角色「协作轨迹」卡片（收到/产出、状态、耗时）、停止原因解释、冻结证据、每次 Explanation 输出的引用逐条校验；`TraceValue` 把 `{context,result}` 渲染成中文字段键值树，长数组默认折叠，原始 JSON 可展开 |
| 生成约束 | `DraftAgents.java` | Explanation 提示补一句：引用必须逐字来自该 citation 的 `excerpt`，标题与来源是元数据、不可引用（校验本就只认 `excerpt`，这里只是把契约说清楚） |
| 合成资料 | `PatientDraftTestService.java` | 标题/来源缩为 `SYNTHETIC-<label>` / `synthetic.invalid`，并注明原因是长元数据会被模型当原文引用 |
| 文档 | `docs/patient-draft.md` | 停止原因清单、运维试验台的启用方式与接口 |

关键判定：Spring AI 把 HTTP 错误包成 `NonTransientAiException` / `TransientAiException`，状态码只在消息里，所以归类既看异常类型也解析这段文本；直接抛 `RestClientResponseException` 的客户端保留状态对象。测试用真实 Spring AI OpenAI 传输 + `MockRestServiceServer` 覆盖 401/429/502。真机启动暴露了单元替身看不到的差异：自动配置的错误处理器把消息写成 `HTTP 401 - No response body available`（带 `HTTP ` 前缀），而测试里手工构造的客户端抛的是 `401 - {body}` 这种裸状态文本；归类同时接受两种，两种格式都有断言。

## 验证

| 项 | 结果 |
|---|---|
| `PatientDraftTest`（真实隔离 MySQL + 确定性替身） | 37/37，0 失败 / 0 错误 / 0 跳过（原 27 项 + 10 项新增） |
| 新增用例 | 401→`PROVIDER_AUTH`、429→`PROVIDER_RATE_LIMIT`、502→`PROVIDER_UNAVAILABLE`、传输 IOException→`PROVIDER_UNAVAILABLE`、Jackson 异常仍为 `INVALID_OUTPUT`、`HTTP nnn` 与 `nnn` 两种状态文本、逐角色计时、逐角色输入/输出可序列化（Vision 摘要、Evidence 查询与引用数、Critic 结论）且仍不含推理快照/对象地址/患者身份、被拒草稿仍可读且指出不符引用、入口默认不注册且三个 handler 均为 admin、重放不加调用 |
| 跳过门禁 | `python scripts/check_surefire_skips.py target/surefire-reports issue19` → 37 cases / 0 skipped 通过 |
| 前端 | `vitest run` 64/64（新增 4 项页面用例）；`npm run type-check` 通过；eslint 对改动文件无告警 |
| 应用上下文 | 一次性 MySQL 8 容器 + 本机 Redis/Chroma 起全量上下文成功（11.1s），`/api/patient-draft-test/*` 实测通过 |

本地复跑：

```text
# 一次性测试库（本机 MySQL 8.0.26 @3307）
mysql -h127.0.0.1 -P3307 -uroot -p \
  -e "CREATE DATABASE IF NOT EXISTS issue19_test; CREATE USER IF NOT EXISTS 'issue19'@'%' IDENTIFIED BY 'issue19'; GRANT ALL ON issue19_test.* TO 'issue19'@'%';"
ISSUE19_TEST_URL=jdbc:mysql://127.0.0.1:3307/issue19_test mvn -Dtest=PatientDraftTest test
```

启用试验台：启动参数加 `--eye-diagnosis.draft.test-entry.enabled=true`，用管理员账号访问 `/admin/draft-test`。**生产不设置该属性即没有这个入口。** 若同时开启 `eye-diagnosis.draft.enabled=true`，后台轮询与手动触发共用同一协调器，重复触发不会增加调用。

### 真机联调（错误密钥，零 token）

环境：一次性 `mysql:8.0.36` 容器（`-p 13307:3306`，库 `diagnosis`，Flyway 自动迁到 V16）、本机 Redis 6380、Chroma 8000；启动参数 `--spring.ai.openai.api-key=invalid-test-key --spring.ai.dashscope.api-key=invalid-test-key --eye-diagnosis.draft.test-entry.enabled=true --eye-diagnosis.draft.test-entry.allow-seed=true`。

| 步骤 | 实测 |
|---|---|
| 未登录 `GET /api/patient-draft-test/tasks` | `40100 未登录` |
| 普通用户（`user` 角色）访问三个接口 | `40101 无权限` |
| 管理员 `POST /seed?label=glaucoma` | 返回 `taskId`，任务 `WAITING_REVIEW`，未运行前 `predictedLabel=glaucoma`、`roles=[]` |
| `POST /tasks/{id}/run` | 异步执行；~6s 后 `RESTRICTED` / `PROVIDER_AUTH` / `calls=1`，`VISION` 一条 `STOPPED`、耗时 325ms |
| 对已受限任务再次 `run` | 不新增调用（`calls` 仍为 1），与现有运行记录一致 |
| 关闭开关重启后访问入口 | 路由不存在；Spring 对未知路径统一返回 `50000 系统错误`（全应用同一行为，非本入口特有） |

第一轮实测返回的是 `PROVIDER_UNAVAILABLE`——即上面记录的 `HTTP nnn` 前缀差异，修正后同一流程返回 `PROVIDER_AUTH`。

### 真实提供方（本机用户级 `DASHSCOPE_API_KEY`）

在同一套实例上改为继承环境变量里的真实密钥（未打印、未写库、未改用户环境变量），模型 `qwen3.5-plus`。`application-local.yml` 是工作树内的本地副本（已 gitignore）：三处 `api-key` 改为 `${DASHSCOPE_API_KEY}`，并在 `spring.ai.openai.chat.options` 加 `extra-body.enable_thinking: false`——默认思考模式会吃光单次 20 秒预算，与[上一轮真实验证](2026-11-10-four-agent-real-provider-validation.md)的结论一致。

| # | 标签 | 结果 | 角色耗时（V/E/X/C，ms） | 备注 |
|---|---|---|---|---|
| 1 | cataract | `RESTRICTED` / `INVALID_CITATION`，3 次调用，10.9s | 3589 / 933 / 6277 / — | 两条声明引用了资料标题/来源 |
| 2 | normal | `RESTRICTED` / `INVALID_CITATION`，3 次调用，10.2s | 2889 / 1296 / 5940 / — | `LIMITATION` 引用来源 |
| 3 | myopia | `RESTRICTED` / `INVALID_CITATION`，3 次调用，9.0s | 2283 / 852 / 5787 / — | `DETAIL`、`LIMITATION` 引用标题 |
| 4 | hypertension | `RESTRICTED` / `INVALID_CITATION`，3 次调用，14.5s | 2959 / 1243 / 10205 / — | 引用标题；已加"标题/来源不可引用"提示 |
| 5 | amd | `RESTRICTED` / `INVALID_CITATION`，3 次调用，10.3s | 3132 / 1089 / 5754 / — | 只剩 `LIMITATION` 引用标题 |
| 6 | other | **`REVIEW_READY`**，4 次调用，12.6s | 3110 / 1571 / 6755 / 1022 | 六个区段、六条引用全部逐字命中，Critic `NONE` |

轨迹原文存档在 [draft-test-entry-live-20261110](draft-test-entry-live-20261110/)，文件名按上表序号。

两次真机运行各暴露一个工程问题，均已修：

1. **提供方状态前缀**：见上节 `HTTP nnn`。
2. **合成资料元数据在诱导错误引用**：Explanation 的上下文含 citation 的 `title` / `source`，模型会把其中的说明性文字当成 `excerpt` 引用，校验按契约拒绝。处理：合成资料标题与来源缩成 `SYNTHETIC-<label>` / `synthetic.invalid`；Explanation 提示词补一句"引用必须逐字来自 `excerpt`，标题和来源不可引用"。第 4、5 次仍失败说明**提示词澄清不足以消除该行为**，第 6 次才因元数据变短而通过。
3. **一个既有测试的潜在不稳**：`seededSyntheticTaskIsRunnableAndLabelledAsSynthetic` 依赖"检索结果第 0 条是夹具片段"，而夹具与合成资料的分数相同、排序按随机 UUID；本轮 rng 恰好把它排到第 1 条才失败。改为引两种片段都含的 `glaucoma` 字面量。

**不能据此认为引用稳定性达标**：同一套合成夹具 6 次只有 1 次全绿，与前一轮 1/2 一致——真实模型仍会拼接或引用元数据，安全校验继续正确拒绝。

## 三种协作效果视图（2026-11-10 追加）

同一页 `/admin/agent-collab`（管理员可见，侧栏「四 Agent 协作效果」）提供三个可切换视角，回答"能不能看到几个 Agent 真在协作"：

| 视图 | 数据 | 形态 |
|---|---|---|
| ① 运行时协作 `LiveCollabView.vue` | 真实落库轨迹，RUNNING 时 1 秒轮询 | 四个节点按调用顺序点亮，连线上的数据卡是上一角色交给下一角色的产物（图像摘要→冻结证据→分层草稿→复核结论），附接力记录；可「重播协作过程」逐节点演示 |
| ② 自治多 Agent `AutonomyCollabView.vue` | **概念模拟**，无模型调用 | 四条泳道并行推进、互发消息、Critic 提出异议、Explanation 修订、最终共识；约 6 秒播放完 12 个事件 |
| ③ 多角色对话 `AgentCollabChat.vue` | 真实落库轨迹 | 四个角色各有头像与气泡依次发言，交接流标明"引用 #N 某角色的某份产物"，可展开查看收到/产出 |

三者共用 `agentCollab.ts` 从 `DraftTestTrace.roles[].context/result` 推导接力关系与发言稿。

**必须说清楚的边界**：② 不是当前生产行为。生产里四角色由 `PatientDraftCoordinator` **顺序**调用、共享无历史传输层、不能并行/互发消息/自主修订；改成自治多 Agent 会动到 #19 冻结的角色契约、证据冻结与预算门禁，需重新批准规格。③ 只是把已落库轨迹投影成对话形式，**正式 `/agent` 聊天页仍未接入四 Agent 流程**。①② 的动画是展示层，不改变后端任何一步。

验证：`AgentCollabPage.test.ts` 5 项（接力推导、缺失角色保持 PENDING、三视图切换、模拟含异议/修订/共识、非管理员不可见）；全前端 69/69、type-check 通过、eslint 新文件无告警；无头 Chrome 对三个视图分别截图确认渲染。

## 边界与后续

- 页面里的"耗时"来自 `V16` 的两列，是协调器注入时钟的起止时间，不含模型提供方排队与网络抖动之外的观测。
- 被拒的解释输出能被看到，是因为协作消息在调用完成时就已落库；它不进入 `t_patient_draft_version`，也不能被医生复核或发布。
- 仍待完成：浏览器里逐页点击（本次只从 HTTP 侧验证页面所用接口）、默认配置（thinking 开启）下的超时策略、以及围绕真实引用拼接失败改进生成约束。
- 真实引用失败的下一步是产品选择：要么继续收紧生成约束，要么不再把 `title` / `source` 传给 Explanation 模型（只给索引和 `excerpt`）。后者会改变角色上下文的形状，未在本轮擅自改动。
