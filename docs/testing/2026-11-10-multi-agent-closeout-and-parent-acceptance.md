# 多智能体子工单证据核验与 #15 总体验收

日期：2026-11-10。范围为 Java 架构分支 `worktree-java-multi-agent-arch`，核验基线 `f9d66660cc8ec3ac6b9438f408f7ed2e5ddf500a`。本轮只补验收文档及 issue 短评论；用户确认保留 issue 正文、勾选和状态，不合并面向 master 的设计草稿 PR #14，不部署或使用患者数据。

## 结论

**#16–#19、#22–#24 的分项工程证据可按下述范围收尾；#15 总体验收为 PARTIAL，不能无保留地宣布整个规格验收完成。**

患者任务、受控资料、四角色内部草稿、医生复核、患者解释、患者授权保存和安全追问已有分项工程验证，并已集成至上述架构分支。#24 已交付固定脚本替身对照与真实 Java/MySQL/HTTP 可靠性报告；它没有运行真实产品协调器的单 Agent 基线/消融，不能证明四 Agent 质量收益。#15 用户故事 22 的专门运维权限/审计入口，以及故事 23 的真实产品协作效果比较仍有保留；见文末逐故事映射。

“分项工程证据通过”仅表示公开 HTTP、内部受信入口、合成外部服务与隔离 MySQL 等明确边界内的结果。各套件通过不等于浏览器→真实 Python→真实模型→真实领域人员→患者授权保存的联合验收；该联合路径本轮为 NOT_RUN。

## 已核验的版本、合并与远端 CI

- [PR #39](https://github.com/yuwen773/eyes-diagnosis/pull/39) 已合入架构分支，合并提交为上述基线；候选提交为 `659ca14d5fce6089bda666d865c1a26c683ee089`。
- 候选与合并提交的 Git tree 均为 `1b3bb614ed2076e65b10e2bd93648cd72639c2b1`。本次逐份读取的是该候选的 [verify #85，run 42782994089，attempt 1](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089)，16/16 作业 success；没有把候选 CI 冒充成另一次合并后分支 CI。
- #17：[PR #25](https://github.com/yuwen773/eyes-diagnosis/pull/25)，合并 `04e5f48070d56015e7ddd6c9a1b8f434a59da806`。
- #20：[PR #33](https://github.com/yuwen773/eyes-diagnosis/pull/33)，合并 `93c2728b80157b33e125ffbf0302ae2d1f9e0046`。
- #21：[PR #34](https://github.com/yuwen773/eyes-diagnosis/pull/34)，合并 `a28114c8c90cdfc9df4da1cc38b2bec673f36298`。
- #22：[PR #35](https://github.com/yuwen773/eyes-diagnosis/pull/35)，合并 `0c6bd1964f4e51b3c03d706fb71b4ba1ac36c529`。
- #23：[PR #37](https://github.com/yuwen773/eyes-diagnosis/pull/37)，合并 `7e3410792bc431fb74dc40a35cffdba289588eb0`。
- #16 PoC、#18 和 #19 实现直接包含在架构分支历史中；不虚构独立的合并 PR。验收说明及代码分别位于 `docs/plans/2026-11-05-coordination-recovery-poc.md`、`docs/controlled-references.md`、`docs/patient-draft.md`，本轮又核对了对应测试入口与当前 CI 日志。

### CI 日志的实际例数

下表计数均从该次作业日志读取。专项列中的 PASS 表示 0 failures / 0 errors / 0 skipped，既有 opt-in 跳过单独列出。

| 作业 | 实际结果 | 日志 |
|---|---|---|
| issue17-mysql | 18/18 PASS：API 7、恢复 10、存储适配 1；健康检查反证 3 项通过 | [job 129717279339](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279339) |
| issue18-mysql | 13/13 PASS，完整例数和零跳过门禁通过 | [job 129717279330](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279330) |
| issue19-mysql | 27/27 PASS，完整例数和零跳过门禁通过 | [job 129717279642](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279642) |
| issue20-mysql | 36/36 PASS，完整例数和零跳过门禁通过 | [job 129717279566](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279566) |
| issue21-mysql | 37/37 PASS，完整例数和零跳过门禁通过 | [job 129717279428](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279428) |
| issue22-mysql | 35/35 PASS，完整例数和零跳过门禁通过 | [job 129717279394](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279394) |
| issue23-mysql | 37/37 PASS，完整例数和零跳过门禁通过 | [job 129717279565](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279565) |
| issue24-evaluation | CLI 12 项；上述 #19/#21 再跑 64/64 PASS；48 个配对单元；两个零跳过门禁通过 | [job 129717279590](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279590) |
| Flyway 两种顺序 | alphabetical、reversealphabetical 各 4/4 PASS | [正序](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279456)、[逆序](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279350) |
| backend-unit | 304 项中 84 实际通过，220 按 opt-in 契约跳过；0 failures/errors；报告门禁通过 | [job 129717279448](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279448) |
| frontend | 8 文件、60 项通过；lint 与 build 步骤 success | [job 129717279310](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279310) |
| python | 426 passed、17 skipped、35 deselected；限定 not slow 范围 | [job 129717278955](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717278955) |
| watchdog | 53 passed | [job 129717279773](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089/job/129717279773) |
| docs-contract / backend-compile | 两个作业 success | [verify](https://github.com/yuwen773/eyes-diagnosis/actions/runs/42782994089) |

专项之间复跑的 64 项不是新增的 64 个独立行为；不能将上述各行简单相加作为唯一用例数。backend-unit 中跳过的数据库专项由独立作业实跑覆盖；Chroma/RAG/PoC 跳过不因此转为通过。PoC 本轮补跑另列下节。

#24 远端产物：`issue24-evaluation`，artifact ID `13746079853`，48193 字节，ZIP digest `sha256:1cbaaf1168b5d3556f3cb751cbf75915ea84b82d5aff51932fe78d80f6d25a66`；包含生成报告、逐单元 JSON 和原始 XML。原有 [本地报告](issue24-2026-11-10/report.md) 与 [结果](issue24-2026-11-10/results.json) 保留为本地证据，没有改写成远端产物。

<a id="issue16"></a>
## #16：协调与崩溃恢复 PoC

| 验收项 | 已核验的边界和证据 |
|---|---|
| 固定框架、输入、数据库、故障场景 | Java 21、Graph 1.1.2.2、MySQL 8.0.36、READY→WAITING_REVIEW，两种方案共用受控时钟、MySQL 租约、手动领取及故障协议 |
| 业务更新/后续任务原子提交回滚，提交前后崩溃/跨进程恢复/版本不兼容 | `CoordinationMySqlTest` 中业务与后续任务回滚、首次与恢复段子 JVM `Runtime.halt`、跨进程恢复、错误引擎及 Saver 版本拒绝 |
| 双执行者竞争与过期执行者 | 两连接同时领取仅一方成功；旧令牌不能写状态、完成标记或 Saver。正式诊断表未接入，测试的完成标记不冒充正式记录 |
| Saver 写入、序列化与事务协调，不冻结正式 DDL | RecordingSaver 捕获 put，框架序列化 checkpoint，在租约栅栏后的 JDBC 事务提交；不证明内置 MysqlSaver 可加入业务事务。正式 Saver DDL 不冻结 |

工程结论仅适用于测试中的两节点图及代理 Saver。[原实验记录](../plans/2026-11-05-coordination-recovery-poc.md) 保留领域状态机优先、Graph 作为后续候选的建议；不支持据此宣称所有 Graph、并行节点、list/release、调度器或正式发布协议已验证。

本轮补跑结果见下方“PoC 补跑证据”。最近 CI 未设置 `COORDINATION_POC_URL`，其 14 项 PoC MySQL 跳过不能作为本工单通过证据。

<a id="issue17"></a>
## #17：患者任务、输入绑定与恢复

| 验收项 | 工程证据 |
|---|---|
| 登录创建及本人任务读取 | `DiagnosisTaskController` / `DiagnosisTaskApiTest`：独立上传、列表、本人读取、其他用户拒绝；只返回 taskId/status |
| 输入身份摘要绑定、重复/重启不覆盖结果 | `DiagnosisTaskService` / `DiagnosisTaskRunner`：幂等键冲突、图片摘要及对象版本绑定、MySQL 租约/令牌、预扣外部调用额度；恢复与并发由真库测试覆盖 |
| 无效图片/失败/拒识/未知状态受限 | API 与 runner 测试覆盖，不向患者暴露未审核疾病推测 |
| HTTP + 隔离数据库故障恢复；未跑真实 Python 明示 | 当前 CI 三套件 18/18 PASS，报告门禁通过；真实 Python gRPC 和真实 COS 版本读写为 NOT_RUN |

[原验收记录](2026-11-05-issue17-isolated-acceptance.md) 早期“托管 CI 待运行”描述的是当时状态；上表补充当前远端证据，不删除历史失败/跳过。不能将存储客户端替身或字节读取断言写成真实 COS 验收。租约测试在历史本地全量曾失败，见下文风险记录。

<a id="issue18"></a>
## #18：受控参考资料

| 验收项 | 工程证据 |
|---|---|
| 上传、待审、批准、撤回及角色约束 | `ControlledReferenceController`、管理页与 `ControlledReferenceApiTest`，上传者/审核者/其他账号的 HTTP 权限与治理冲突测试 |
| 不合格来源不能进入受控证据 | 检索资格过滤及参数化测试：私有、未审、停用、删除、测试资料、疾病/主题不匹配不进入候选 |
| 结构化冻结引用、撤回后禁用 | 文档/治理版本和片段摘要，精确来源持锁复验，撤回竞争与篡改片段反证 |
| 测试标识、真实资料须领域审核 | 测试文本及身份为合成；`isTest` 排除与领域审核确认校验已测。没有真实资料/领域人员被本次验证认定为已获准 |

当前 CI 13/13 PASS，零跳过门禁通过。[原验收记录](2026-11-06-issue18-controlled-reference-acceptance.md) 中的后续接入和远端待运行是历史状态；当前 #19–#23 已接入持锁资格复验，不提升为真实医学资料领域验收。

<a id="issue19"></a>
## #19：四 Agent 内部草稿协作

| 验收项 | 工程证据 |
|---|---|
| 四角色独立职责/上下文/工具/输出/协作消息 | `DraftAgents` 四个角色、独立结构化上下文与输出；`PatientDraftTest` 及持久化消息验证 |
| Vision 只建议；Evidence 只受控检索 | 不执行重推理；传输层禁止工具调用，服务端绑定疾病/主题；工具越权反例拒绝 |
| 引用映射及 Critic 可定位异议、无发布权 | 精确引文/证据版本校验，无法定位异议拒绝；草稿就绪仍须医生和读取门禁 |
| 一次补证/一次重写，总调用与时间预算，新冻结版本 | 额度预扣、重复补证不伪造新版本、反复反馈终止、总调用/耗时测试 |
| 超时、无效输出、证据不足、来源撤回/超预算停止 | 受限原因、迟到结果丢弃、跨 JVM 崩溃恢复不重置额度、最终来源锁内复验 |

当前 CI 27/27 PASS；#24 作业又复跑同套件。引用结构校验不证明医学语义支持，Critic 通过不构成医生批准。患者 HTTP 只显示允许状态/固定摘要。[原验收记录](2026-11-06-issue19-patient-draft-acceptance.md)。

<a id="issue22"></a>
## #22：患者授权保存

| 验收项 | 工程证据 |
|---|---|
| 明确批准后才建正式记录，拒绝越权 | `PatientAuthorizationController` / `PatientAuthorizationApiTest`，OFFERED 不写正式记录，患者独立同意及跨账号拒绝 |
| 批准前复验冻结版本/摘要/有效期/来源，失效受限 | 来源→任务→复核材料→授权锁顺序，过期、变更、撤回及持久化受限反例 |
| 授权、正式记录、唯一回执同事务 | 真库触发器故障注入，任一写失败全部回滚；测试环境独立配置，不修改业务库 |
| 重复/并发只产生一份记录回执，医生决定不等于授权 | 并发批准、相同请求回放、历史回执查询；医生批准后仍需患者批准 |

已合并 PR #35；当前 CI 35/35 PASS，零跳过门禁通过。[原验收记录](2026-11-10-issue22-patient-authorization-acceptance.md) 的“未推送/合并”保留为实施结束时记录，本节补充其后的远端交付。

<a id="issue23"></a>
## #23：已发布结果安全追问

| 验收项 | 工程证据 |
|---|---|
| 当前本人、已发布内容与有效来源绑定 | `PatientFollowUpController` / `PatientFollowUpApiTest`，每次读取复用当前来源与材料门禁，仅返匹配声明及其原引用 |
| 无合格依据如实提示，不冒充受控证据 | 中英文确定性原文匹配，INSUFFICIENT_EVIDENCE；不调用模型/私人知识库；一般咨询有独立入口且不携带本次材料 |
| 不修改原快照、医生决定、发布和授权 | 只读门禁覆盖授权前/后状态，比较冻结及授权材料，已保存回执保持一致 |
| 未发布、撤回、越权拒绝 | HTTP 负向与来源撤回锁竞争；页面丢弃账号/任务切换后的迟到响应 |

已合并 PR #37；当前 CI 37/37 PASS，零跳过门禁通过。[原验收记录](2026-11-10-issue23-patient-follow-up-acceptance.md)。这是一种受限原文追问能力，不宣称开放生成式问答或临床完整回答。

<a id="issue24"></a>
## #24：协作评估与可观察可靠性

| 验收项 | 已交付证据及限制 |
|---|---|
| 固定样例、单 Agent/逐角色消融，引用/无依据/遗漏/耗时/成本 | 8 例 × 6 条件 = 48 个配对单元；同一角色响应脚本与独立 gold，记录实际参考阶段；分母/空输出/N/A/错误就绪齐全；提供方调用为零，真实模型耗时/token/费用 NOT_RUN |
| 证据不足、越权、崩溃恢复、受限，分母和失败例 | 实际 Java/MySQL/HTTP 64/64 PASS；组别及逐例结果、停止原因、全部脚本反例均保留 |
| 离线、真实服务、浏览器、领域/临床分列 | 本地与远端替身及真库工程证据分列；真实服务联合、该票浏览器、领域、临床及生产 NOT_RUN |
| 不作临床/生产结论 | 报告明确脚本行为不估计实际 Agent 贡献或医学有效性 |

已合并 PR #39；当前评估 CI 作业 success，产物已上传。结论为**约定离线替身及工程可靠性范围通过**；真实产品单 Agent 与逐角色消融效果尚未执行，不能将这四项表述为真实模型效果验收通过。[原验收记录](2026-11-10-issue24-agent-collaboration-acceptance.md)。

<a id="parent15"></a>
## #15：28 项用户故事总体验收映射

| 故事编号 | 能力与证据 | 结论 |
|---|---|---|
| 1、2、5、14 | 上传、质量/失败提示、本人任务；#17/#21 HTTP、真库测试 | 分项工程证据具备；真实推理服务联合 NOT_RUN |
| 3、4、6 | 安全进度、固定角色摘要、等待医生；#19–#21 | 分项工程证据具备，不显示原始推理和未审草稿 |
| 7、8、9 | 分层结果、来源/不确定性、“模型非确诊”；#21 | 分项工程证据具备 |
| 10、11 | 已发布材料追问与独立一般咨询；#23 | 分项工程证据具备，能力限确定性原文匹配 |
| 12、13 | 患者明确同意、幂等保存；#22 | 分项工程证据具备 |
| 15、16、17、18 | 医生获分配材料、冻结决定、自审禁止、分歧材料；#19/#20 | 分项工程证据具备；#20 已关闭，不另改状态 |
| 19、20、21 | 资料上传、范围审批和撤回；#18 | 分项工程证据具备；真实领域人员及资料审核 NOT_RUN |
| 22 | 受权限限制的运维任务/审计入口 | PARTIAL：有内部可信 `inspect` 和持久化审计材料；`docs/patient-draft.md` 明确不是 HTTP 接口。未找到专门运维角色/入口及其公开权限验收，不能以医生接口代替 |
| 23 | 研究人员比较单 Agent/多 Agent 解释质量 | PARTIAL：参考脚本对照工具和报告已交付；真实产品协调器基线/逐角色消融、真实模型质量与成本 NOT_RUN，不能据替身报告断言协作收益 |
| 24 | 推理/证据/草稿版本及实验追溯 | #19 冻结快照与受限材料、#24 逐单元轨迹及哈希具备；对真实服务实验的重现仍 NOT_RUN |
| 25、26 | 崩溃恢复、过期执行者隔离 | #16 两引擎 PoC、#17 任务租约、#19 保守中断恢复的分项证据；模型调用 exactly-once 未承诺 |
| 27 | 证据不足限制及提示 | #18/#19/#21/#23 负向测试具备 |
| 28 | 撤回后阻止新批准/发布/保存 | #18/#20/#21/#22 行锁/当前资格复验及竞争反例具备 |

这些映射支持工程阶段进度核验，不能将 26 项“有分项工程证据”计为 26 个真实端到端用户故事已通过。父规格包含的运维与研究能力尚有上述保留，因此本轮不回写“#15 全部完成”。后续工程验收应补齐故事 22 的权限化运维边界及证据，单独设计真实产品基线/消融，并在授权与受控资料条件具备后执行联合流程验证。

## 失败、未运行和风险保留

- [#23 原记录](2026-11-10-issue23-patient-follow-up-acceptance.md) 保留本地 #17 租约锁测试的时钟回退采样及首轮失败；[#24 原记录](2026-11-10-issue24-agent-collaboration-acceptance.md) 保留 304 项全量首轮 1 failure、2 errors、17 skipped，补齐隔离触发器环境后的原样全量 0 failures/errors、17 skipped。当前远端 #17 为 18/18 PASS，但不据此宣布历史时钟/租约风险已修复。
- 历史浏览器验证使用各票的合成 HTTP API；有桌面/移动截图并不证明浏览器连接了真实后端与真实模型。本轮没有重新运行浏览器。
- 真实 Python gRPC、真实 COS 对象版本行为、真实模型服务与协作收益、真实医学资料领域审核、真实医生资格、浏览器到真实后端联合、临床与生产验收均 NOT_RUN。
- 原图上传与业务登记不在同一事务，孤儿对象生命周期仍按 `docs/diagnosis-task.md` 的明确边界处理。本轮未验证或实现新存储治理。
- 受限授权候选不能同任务重新冻结/续期，使用现有人工处理或新任务边界；不扩张为完整长期业务运营能力。
- 专利原文与权利要求映射未核验；Graph 内置 MysqlSaver、其他图拓扑、动态预处理/重推理、向量对齐不因本次文档收尾获得验收。

## issue 回填方式

#16–#19、#22–#24 各一条短评论链接至本文件对应小节；#15 一条短评论明确 PARTIAL 和缺口。#20/#21 保持已有关闭状态，不重复回填。所有 issue 原正文与状态保持不变；不把未勾选框机械改成勾选。本文是当前证据补充，旧记录保留其各自的提交、日期、失败和验证边界。

## PoC 补跑证据

在核验基线 `f9d66660cc8ec3ac6b9438f408f7ed2e5ddf500a` 上，使用规定的 Corretto JDK 21 和本轮新建的一次性 MySQL 8.0.36，实际执行 `mvn -B -Dtest=CoordinationPocTest,CoordinationMySqlTest test`：**18 项，0 failures / errors / skipped，BUILD SUCCESS**。其中真库与跨进程 14 项、纯 PoC 4 项。

[逐例结果与 XML/日志 SHA-256](issue15-2026-11-10/poc-results.json)已归档，未把此次 18 项推广为整个产品全量通过。原始日志与两份 XML 保存在本地忽略目录 `tmp/issue15-closeout/`；本轮容器已移除，原有服务保留。

第一次启动本地就绪探针时，PowerShell 对未加引号的 `-h127.0.0.1` 参数拆分导致 MySQL 客户端显示帮助并使探针退出；尚未进入 Maven。修正临时启动脚本的原生参数引号后才获得上述实际测试结果。该准备失败不记作通过，不改产品或测试代码。

远端各作业的状态及日志摘要另见 [CI 证据索引](issue15-2026-11-10/ci-summary.json)。本轮只新增文档与证据 JSON；既有测试已经完成对应验证，不为文档修改重跑无关全量套件。
