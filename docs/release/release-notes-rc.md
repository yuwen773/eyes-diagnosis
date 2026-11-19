# Iris Release Candidate · 发布说明（草案）

> 本文件随候选分支 `integration/iris-release-candidate` 维护。
> **不是正式 Release Notes**：正式发版、合并 `ui`/`master`、打 tag、创建 GitHub Release、
> 部署与生产开关变更，均需 owner 批准后另行执行。

## 1. 候选标识

| 项 | 值 |
|---|---|
| 分支 | `integration/iris-release-candidate` |
| 基线 | `origin/ui@1ff9c71c`（PR #118 合并后的 ui tip） |
| 建议版本号 | `v1.1.0-rc.1`（在 `release/v1.0.0@5ac742f0` 之后，不复用旧分支、不重写旧 tag） |
| 数据库迁移 | V29（**相对基线新增 1 条**：`V29__knowledge_index_version.sql`，只加一列可空 `indexVersion`） |
| UI 冻结 tag | `iris-ui-v2.1-freeze-20261115` = `80f53f7f`（本地与远端均未移动） |

## 2. 本版本包含什么

### 2.1 诊断 Agent 正确性（PR #111，R3）

- **工具状态族收口**：服务端唯一词表 `running / succeeded / failed / cancelled / awaiting-confirm`，
  由 `ToolStepContract` 定义并同时驱动 SSE、前端状态与落库。
- **工具结果闭环**：工具成功时正文（脱敏 + 32k 截断）与结构化资源随终态帧下发，
  并持久化到会话历史，刷新后可恢复。
- **时间契约**：所有消息时间戳统一为带时区偏移的 ISO-8601（`TimeFormats`），
  历史与实时消息不再出现时区错位。
- **脱敏**：推理正文、工具参数、工具输出、确认文案四个出口统一过 `SensitiveDataRedactor`。
- **外域图片保护**：前端只加载受控来源的影像，防止会话内的远程图片绕过授权。
- **结构化知识来源**：知识库检索结果与模型片段的分数语义分开呈现。

### 2.2 Agent 运行时护栏（PR #112）

- **工具调用预算**：`ToolCallBudgetInterceptor` 按单次运行隔离，超预算时不再执行工具，
  且记录为**失败**终态（不是假成功），模型据此收尾。
- **图递归上限**：`CompileConfig.modelCallLimit` 接线到配置项，默认值可控。
- 框架默认的无限循环不再被当作「已有保护」。

### 2.3 工具失败语义修复（本轮新修，P0）

Spring AI Alibaba 1.1.2.2 的 `AgentToolNode#executeSyncTool` 对 `ToolExecutionException`
走 `processor.process()` 分支，默认 `alwaysThrow=false` → 返回字符串 →
`ToolCallResponse.of(...)`，`status` 为空 ⇒ `isError()==false`。结果是**真实工具失败被记成成功**。

修法（两层，缺一不可）：

1. `toolExecutionExceptionProcessor(new DefaultToolExecutionExceptionProcessor(true))`
   让异常先逃出框架的工具执行节点；
2. 最外层 `ToolFailureBoundaryInterceptor` 把逃逸异常转成 `ToolCallResponse.error(...)`。

效果：失败不再被记成 success，会话也不会因异常中断而断流。

### 2.4 前端状态恢复（本轮新修，P1）

`agentSteps.ts` 的 `streaming` 是页面级状态，新回合开始时会把**旧回合**里未完成的工具步骤
重新显示成「执行中」。修复后只有「排在最后、且后面再没有消息」的过程块才可能保留 running。

### 2.5 系统状态与错误恢复（PR #101，R2）

- 安全重定向、死代码清理；
- 系统状态页与错误恢复体验精修；
- 新增 CI 门禁 `web-e2e-system-states`：14 条 Playwright 浏览器契约
  （认证表单 + 资讯错误恢复，全部用 `page.route` 注入合成故障，不需要后端）。

### 2.6 工程清理

| 项 | 内容 |
|---|---|
| 依赖 | 移除未使用的 `caffeine` |
| 配置 | 移除三组无消费者的配置键（`inference.hash-algorithm`、`rag.evaluation.enabled`、chroma `tenant-name`/`database-name`） |
| 注释 | 删除 16 处从未填写的 `@Description TODO` 占位 |
| 脚本 | 删除一次性 GitHub 门面脚本与截图；停止跟踪 `skills-lock.json` |
| 新增脚本 | `scripts/worktree-hygiene.sh`（`report`/`reap`/`branches`，默认只读）、`scripts/dev-servers.sh`（`list`/`stop`） |
| 文档 | 安全遗留治理计划、考古清理台账、UI 冻结例外登记、本组发版文档 |

### 2.7 第二轮独立审查整改（`6ff5a889` → 本候选）

第二轮独立复验对上一版候选判 NO_GO（6 条仍开放；P0-01 保持 CLOSED）。本候选的改动：

| 阻断 | 改了什么（用户可感知的部分） |
|---|---|
| P1-01 取消/终态一致性 | 工具终态**先提交再发送**：写不进去就不发终态帧，客户端看到的是流错误而不是「看起来成功」；用户中断不再被记成「超时」，MCP 传输 Future 会被真正取消 |
| P1-02 RAG 代际 | 每次处理生成服务端索引版本；检索只认「已就绪 + 当前版本」的片段。失败代、旧代、清理失败的残留都不再作为来源，较短的重试也不会把上一代片段带回来 |
| P1-03 附件可信性 | 附件身份从「正文里的公开字符串」移到客户端不能写的 `subType` 列；历史读取按**当前用户**重新复核每个上传；上传接口只返回受保护的取图路径，第三方同形地址一律拒绝 |
| P1-05 预算终止 | 模型先铺垫文字再请求工具、随后被预算截断时，也会追加并持久化明确的终止说明（不再只剩铺垫） |
| P1-04 回滚产物 | 文档明确：旧 master 产物**能启动但不安全**，禁止切流；回滚只能恢复到新库并按停写源库逐表对账 |
| P0-02 归档安全 | 归档「可恢复」改为可证实的判定：真实导入 bundle、逐文件字节对账、删除前比对内容清单，任一步不确认就保留工作树并失败 |

## 3. 默认关闭的能力（本版本未改变）

| 能力 | 配置键 | 默认值 |
|---|---|---|
| 多 Agent 协作 | `eye-diagnosis.collaboration.*` | 全部 `false` |
| 协作前端入口 | `VITE_COLLABORATION_ENABLED` | 未设置（入口不出现） |
| 医生正式复核写入 | 复核门禁 | 保持关闭策略 |
| 患者草稿校验 | `patient-draft-test` | 仅管理员 + 显式开启 |
| 知识库来源筛选 | `eye-diagnosis.rag.source-type.enabled` | `false`（开启只会**收窄**可见集合） |
| 内置语料播种 | `eye-diagnosis.rag.corpus.seed-enabled` | `false` |

## 4. 已知限制

1. **真实临床能力未验证**：本轮只做工程验证。工具失败、超时、取消的语义已按真实执行路径修复，
   但未在真实临床数据上做疗效或安全性评估。
2. **跨功能真实链路**：真实外部集成（DashScope → SSE 全链路）曾用真实凭据跑完 5 个场景
   （流式问答 / 真工具成功且真 RAG 命中 / 真工具失败且四出口一致 / SSE 断流后终态仍落库 /
   用户文本伪装信封不被当作附件），**但原始链路证据（SSE 帧、历史、审计行、提供方调用记录）
   在验证后即被删除，独立审查无法交叉核验**，因此该结论只作自述记录，不据此宣称外部集成通过；
   视觉工具成功路径与真实对象存储上传从未被真实执行过（占位对象存储凭据）。
   SSE 断流、跨用户隔离等链路的验证状态以 `verification-matrix.md` 与
   `release-candidate-readiness.md` 为准，不在此处重复声明。
   外部集成通过**不等于**真实临床能力通过。
3. **`frontend/`（Vue）已弃用**：本版本不含 Vue 前端任何变更，也不作为设计参考。
4. **冻结范围内不做视觉迭代**：首页/品牌层、管理端、知识库、新闻工作台保持冻结基线外观。
5. **旧会话的图片附件不再自动渲染**：附件身份现在存在服务端 `subType` 列（客户端不可写），
   历史读取按当前用户重新复核归属。修复前写入、没有该列的旧消息按原文（JSON 信封）显示，
   正文不丢、图片不自动加载；不做「凭形状推断」的回填。见 `codex-no-go-remediation.md` §5。
6. **已有知识库文档需要重新处理**：`indexVersion` 是本次新增的服务端索引版本，历史文档该列为
   NULL，在按版本准入的检索里视为「不能证明处理完整」，不会作为来源。升级后必须重新处理需要
   保留的文档，并验收检索结果。

## 5. 升级注意

见 `upgrade-rollback-manual.md`。相对基线**新增 1 条 Flyway 迁移**（V29，只加一列可空
`t_knowledge_document.indexVersion`），升级动作取决于目标库的历史：

- **已在 V28 的库**（ui 线）：执行 V29 一条 ALTER；随后需要重新处理要保留的知识库文档，
  否则它们的片段不会通过版本准入。
- **master 线 V17 的库**：升级会实际执行 V18–V29（对既有表只有 V22 给 `t_diagnosis` 加一列可空
  `patientTaskId`、V29 给 `t_knowledge_document` 加一列可空 `indexVersion`）。
  **旧 master 产物能启动，但不安全**（会恢复正式复核写入与推理输出），不得切流；
  若要回到 V17 的 schema 形态，只能恢复到升级前备份的新库并按 §4 对账后再切流。
- **history 含 V10–V14 的旧 Java 线 / 旧 release 库**：本候选不认这些版本，Flyway 会判 missing
  拒绝启动，只能按迁移矩阵重建。

逐路径步骤与数据差异核对见 `upgrade-rollback-manual.md` §2–§4；实测依据见
`docs/architecture/migration-matrix.md` §2.1。
