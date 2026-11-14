# Iris Eye Diagnosis 实时多智能体协作升级实施计划

版本：v1.1（实施基线 / 待编码验证）  
修订日期：2026-11-11  
适用范围：Java 后端 eyes-diagnosis + 正式 React 前端 web/  
主要目标：升级已有 /agent 实时协作工作台；先建立现有执行器的真实事件基线，再验证和迁移 Graph。  
实施方式：分阶段 PR、独立验收、默认关闭的新功能开关；保留既有医学安全门禁。

**一句话需求**：用户在正式 React /agent 页面上传眼底图片或提出眼科问题，真实的多个专业 Agent 在 Spring AI Alibaba 编排下执行、交接、质疑和修订；前端通过真实事件流优美地展示其工作进度和允许公开的内容，最终形成需要医生复核的辅助信息，而非即时临床诊断。

## 0. 执行摘要与冻结决策

### 0.1 六项必须统一的决定

1. **唯一正式前端是 React**：采用主仓库 web/（React 19 + TypeScript + Vite + React Router + Tailwind CSS v4）。frontend/ 中的 Vue 实现是历史代码，不再作为用户端升级对象。

1. **升级现有 /agent，而非另建“多 Agent 演示站”**：保留会话、附件、历史、资源面板、MCP/RAG 等已有能力，以同一个工作台承载文字问答与图像协作。

1. 编排优先复用 Spring AI Alibaba Agent Framework / Graph：先验证锁定版本 1.1.2.2 的实际能力，再通过等价性门禁迁移；实时事件建设与运行时替换分别验收。现有 Coordinator 先接统一事件接口，领域守卫继续复用。

1. **Studio 作为开发/调试参考，不直接作为患者端 UI**：官方 Studio 已有 React GraphWorkspace、NodeTimeline、GraphDiagram、StateInspector 及 API/流式模式；选择性借鉴，不整体引入其 Next.js 应用。

1. **真实事件才允许上屏**：不伪造 Agent 的争论、不用事后轨迹冒充实时流、不显示未经核验的模型推理或模型内部隐藏思维链。

1. **医学权限边界先行**：医生/管理员可在授权下查看详细协作轨迹；普通用户可见任务状态、安全摘要及经复核允许展示的最终信息。REVIEW\_READY 不等于医生批准发布。

### 0.2 当前范围的“完成”定义

一次完整演示必须做到：/agent 上传眼底图 → 获得 runId → 运行时持续收到带 ID 的 SSE 事件 → Vision/Evidence 等角色真实产生输出与交接 → Critic 审查并按需发出真实反馈 → 协作结束、草稿进入医生复核 → 页面可刷新、断线重连、跨会话隔离、不得泄露未授权临床草稿。

**特别说明**：首期不承诺“大模型每个角色均逐 token 输出”。首期最低门槛是**按真实节点/交接/结构化消息完成的增量流**；如所用 Spring AI Alibaba 节点与模型支持真实 token 流，再开放允许展示的文本增量。同步 ChatModel.call() 的结果不得拆字模拟为 token stream。

### 0.3 v1.1 修订决策

本次修订保留 v1.0 的产品范围与医学权限边界，补齐执行顺序、实时协议、取消恢复和验收分支。实时可观测性先在现有执行器上建立，Graph 替换须经过独立等价性验证。

真实提供方的小规模验证前移至 M0/M1，M5 继续承担扩大样本与对照评估。SSE 明确授权过滤后的序号、快照边界和游标失效；执行状态与医生复核状态分开维护。

文中的文件、提交、版本、开关和接口应按其标注区分历史快照、待验证能力和拟议契约。v1.1 修订本身不构成源码核验、框架兼容性证明或运行验收。

## 1. 现状与证据基线

### 1.1 已核对的代码与版本

| **位置** | **已见实现（2026-11-11 核对）** | **对本计划的意义** |
| --- | --- | --- |
| eyes-diagnosis/pom.xml（多 Agent 分支） | Java 21、Spring Boot 3.5.6、Spring AI 1.1.2、Spring AI Alibaba 1.1.2.2；已有 spring-ai-alibaba-agent-framework 依赖 | 不必另引入新 Agent 框架；先做版本兼容 SPIKE |
| agent/DiagnosisAgent.java | 现有 Spring AI Alibaba ReactAgent，支持图像分析工具、用户绑定 RAG、MCP 及 Flux<NodeOutput> | 继续保留文字聊天能力及复用已可用工具 |
| controller/AgentController.java | /agent/chat/stream 已有 SSE | 当前 SSE 属单 Agent 聊天，不等于四 Agent 的事件流 |
| patientdraft/PatientDraftCoordinator.java | 自建 ThreadPoolExecutor、BlockingQueue、DraftMailbox、自治事件循环及预算/停机逻辑 | 可迁移通用编排；不得删除已验证的领域守卫 |
| patientdraft/DraftAgents.java | Vision、Evidence、Explanation、Critic 四角色；采用同步 ChatModel.call() 和结构化 JSON | 当前不支持角色模型文本的真实 token 级流 |
| patientdraft/PatientDraftRunner.java | 后台定时轮询；以 eye-diagnosis.draft.enabled=true 显式启用 | 需要把用户入口与“可信任务触发”接通 |
| web/src/pages/AgentPage.tsx | 正式 React 页面；聊天、图片上传、会话与资源面板 | 原地演进；保留现有交互逻辑 |
| web/src/lib/agentStream.ts | React 事件 reducer、SSE 调用、消息累加、取消及会话竞态处理 | 增加“协作事件 reducer”，而非推翻现有模块 |
| web/DESIGN.md、web/src/styles/tokens.css | 「白色仪器」设计系统；两套主题；信号橙，发丝线，等宽读数 | 所有新增组件必须继承设计令牌 |

历史核对快照（v1.0 记录，日期 2026-11-11）：多 Agent 提交为 6572743，分支为 worktree-java-multi-agent-arch，当时记录远端已指向该提交，React web/ 在 master 可见。该记录不代表开工时的当前状态；M0 必须重新记录工作树、HEAD、远端引用和 web/ 所在分支。

### 1.2 重要事实与盲区

- 现有四角色是 **Vision、Evidence、Explanation、Critic**；PatientDraftCoordinator 是协调服务，而非第五个模型 Agent。

- 当前 Vision 只解释**已有推理快照与质量限制**，并非直接调用视觉大模型“看眼底原图”。UI 禁止宣称它进行了未发生的像素级视觉判断。

- 当前四 Agent 是结构化信封、异议与修订流，不是自然语言群聊；“谁对谁发出什么要求”可以可视化，不能合成不存在的对话。

- 报告提到真实模型引用准确性未达标，真实运行缺少 SUPPLEMENT/REWRITE 充分证据。迁移不能将这些问题掩盖为 UI 成功。

- Studio 官网快速开始给出 spring-ai-alibaba-studio:1.1.2.0 示例；Studio 仓库 README 另有 1.1.2.1 示例，均不能直接推定与我们的 1.1.2.2 完全兼容。应在 M0 做 Maven 编译与运行验证。

- 现有前端与后端两个开发分支存在代码时序差异。本文对文件和契约的列举为**经过核对的候选改造点**，不是声称所有接口已经实现。

### 1.3 交付原则

**复用优先级**：已有眼科 Java 领域服务 > 已有 React UI/通信模块 > Spring AI Alibaba Graph/ReactAgent/Studio 官方代码模式 > 必要的薄适配层 > 新建通用基础设施。不得因“看起来先进”引入第二套运行时、第二套消息系统或额外 Next.js 前端。

### 1.4 开工证据与变更隔离

M0 形成带采集时间的基线清单：实际工作目录、目标与对照完整 SHA、远端引用、工作区状态、web/ 及设计文件位置、依赖锁定值。远端读取失败应如实标注，不能沿用历史记录宣称已核验。

v1.0 所称“23 项 OOD 改动”是历史工作区快照。开工按当前 diff 逐项分类并限定修改与暂存范围，不将无关改动混入协作 PR，不重置或覆盖他人的工作。

## 2. 目标用户、核心故事和范围边界

### 2.1 用户故事

**US-01｜普通用户提交分析**：登录用户在 /agent 上传一张眼底图，立即获得任务受理反馈；看到真实任务阶段、参与角色及经安全过滤的进度摘要；刷新页面后可恢复该任务；草稿未经医生复核时不直接看到疾病结论或内部争议全文。

**US-02｜普通用户延续问答**：用户可在同一会话中追问“这张图的分析进度如何”“结果何时可用”“什么检查信息需要补充”；对事实性临床追问仅依赖获准资料与已发布结果。

**US-03｜医生审查**：有权限的医生能够进入详细协作轨迹，查看每个角色的结构化输出、有效证据、版本、异议与修订链，对最终草稿独立复核；未批准时不可生成面向患者的正式结论。

**US-04｜管理员调试**：管理员可通过独立管理入口/Studio 开发工具查看 Node/Graph 运行、出错、时长、超时及审计；内部状态不能未经权限过滤复制给普通用户。

### 2.2 首期做与不做

| **首期做（必须）** | **首期不做（刻意排除）** |
| --- | --- |
| React /agent 原地升级，保留会话与附件 | 新增独立 Next.js/Studio 患者应用 |
| 图像关联任务、后台执行、真实增量事件 | 展示虚构“Agent 吵架”或伪 token 输出 |
| 四 Agent 协作路径、权限分级展示 | 任意 LLM 直接批准诊断、处方、对外发布 |
| 持久事件、重连补偿、取消与失败反馈 | 不受控的多模型自发无限对话 |
| 医生详版、普通用户安全版 | 直接暴露 raw Graph State / 系统提示词 |
| 明暗主题、移动适配、无障碍与回归 | 首期整合 WebSocket、AG-UI、重做 RAG 存储 |

### 2.3 非功能目标（验收阈值属于项目目标，非已测事实）

- **实时性**：Agent 任务在开始执行后，首个受理/角色状态事件目标 ≤2 秒；正常工作时真实事件产生后推送到浏览器 p95 ≤1 秒（需压测后调整）。

- **一致性**：服务端事件有稳定单调序号；重连后无丢失、无重复渲染；角色最终状态与服务端一致。

- **可靠性**：用户关闭标签页不自动取消后端任务；主动点击“取消任务”才触发服务端取消；中途重连在权限范围内可恢复。

- **隔离性**：严格禁止读取、订阅或取消非本人任务；医生/管理员按既有 RBAC 判断。

- **安全性**：原始隐私图、未复核草稿、隐藏推理内容不得作为患者端事件载荷；无效引用、证据失效、OOD 与模型故障遵守现有门禁。

- **可维护性**：业务事实事件与 React 渲染解耦；能以受控事件夹具覆盖绝大多数前端状态。

## 3. 技术选型与复用矩阵（ADR-001）

| **需求** | **优先复用** | **我们额外负责** | **明确不做** |
| --- | --- | --- | --- |
| 并行、条件路由、循环、图状态 | Spring AI Alibaba StateGraph/CompiledGraph 或该版本对应 Agent Framework Graph 能力 | 医学任务状态/校验与节点包装 | 长期维护第二套通用 DAG 引擎 |
| 专业 Agent/工具使用 | 已有 ReactAgent、ChatModel、MCP/RAG 工具 | 专业角色提示词、输入输出校验、最小权限 | 让四 Agent 都无条件拥有全部工具 |
| 调试 Graph | Spring AI Alibaba Studio 的 GraphWorkspace / NodeTimeline / StateInspector | 工具接入、脱敏、开发环境隔离 | 将 Studio 原样公开给患者 |
| 前端聊天和附件 | web/AgentPage、已有 upload/stream/消息组件 | React 协作面板、事件 reducer、交互状态 | 复制 Vue 页面或迁入 Next.js |
| 前端事件读取 | 现有 @microsoft/fetch-event-source | 带游标的业务协议、身份校验、重放 | 先引入第二套 SSE 客户端 |
| 医学安全 | t\_diagnosis\_task、patientdraft、受控引用、医生复核链 | 统一任务绑定与事件公开口径 | 允许模型文本绕过确定性门禁 |

Graph 迁移条件：M0 验证 1.1.2.2 的并行汇合、条件循环、节点事件、停止与检查点能力；M1 在现有执行器建立持久事件和对照证据；M2 才接入 Graph。缺失能力可用必要的薄应用层补齐，可靠恢复仍须由领域事务和运行归属验证。等价性未通过时保留现有执行器，新 UI/事件功能可单独验收。

### 3.1 Studio 的正确使用方式

1. 单独启动或以已验证的版本嵌入开发后端，仅面向受信开发者；正式患者路由不暴露 Studio API。

1. 参考 GraphDiagram.tsx 展示流程拓扑、NodeTimeline.tsx 展示节点事件、StateInspector.tsx 作为管理员调试概念。

1. 源码中 GraphRunResponse 包含 node/agent/message/chunk/state；我们应通过后端进行业务映射与脱敏，而不是把原始 state 序列化给浏览器。

1. 不直接复制 Studio 的 Next.js 路由、GraphWorkspace 页面壳或其模型提供方密钥管理逻辑。

1. 对 Studio 图渲染引入的 Mermaid HTML/SVG 内容执行严格可信来源与 XSS 限制；不从患者请求直接加载可执行绘图文本。

### 3.2 关键源代码参考

- [Spring AI Alibaba Studio 快速开始](<https://java2ai.com/docs/frameworks/studio/quick-start/>)

- [Spring AI Alibaba Studio / React UI 源码](<https://github.com/alibaba/spring-ai-alibaba/tree/main/spring-ai-alibaba-studio>)

- [Studio GraphWorkspace](<https://github.com/alibaba/spring-ai-alibaba/blob/main/spring-ai-alibaba-studio/agent-chat-ui/src/components/graph/GraphWorkspace.tsx>)

- [Studio NodeTimeline](<https://github.com/alibaba/spring-ai-alibaba/blob/main/spring-ai-alibaba-studio/agent-chat-ui/src/components/graph/NodeTimeline.tsx>)

- [DeepResearch Graph/SSE](<https://github.com/spring-ai-alibaba/deepresearch>)

- [官方 Multi-Agent Patterns](<https://github.com/alibaba/spring-ai-alibaba/tree/main/examples/multiagent-patterns>)

- [项目 Java 分支提交 6572743](<https://github.com/yuwen773/eyes-diagnosis/commit/6572743169027bb1e7c27d7d969a26ed89d99cd1>)

- [项目正式 React 实现 web/](<https://github.com/yuwen773/eyes-diagnosis/tree/master/web>)

### 3.3 执行器等价性与迁移门禁

统一执行接口仅暴露创建/领取、取消请求、运行查询和领域事件出口；不新增第二套通用 DAG 引擎。现有 Coordinator 与 Graph 适配器共用角色契约、来源校验、预算、证据验证及医生复核边界。

等价性不要求逐字相同的模型回答。使用相同冻结输入和确定性角色夹具，逐项比对任务/影像绑定、合法路由、并行汇合条件、异议定位、补证与重写版本、调用预算、停止原因、终态和对外可见字段。

必须对照 NONE、REWRITE、SUPPLEMENT、非法输出、失效证据、提供方故障、超时、取消和恢复路径。保留现有有价值的自治交接与领域语义；固定示例图若无法表达这些语义，不得仅凭正常路径通过替换运行时。

对照运行使用隔离测试记录和无发布权限的环境，不在正式任务上并行执行两套会写业务数据的执行器。Graph 切换以独立开关控制，仅对新建 run 生效。

## 4. 目标架构与协作流程

### 4.1 单一产品入口，分层执行

```text
React /agent（会话、图像、文字、多 Agent 协作工作台）
  ├─ 附件上传 / 医学图像绑定 / 会话恢复
  ├─ 已有普通问答能力（必要时仍可走 DiagnosisAgent）
  └─ 协作任务创建、订阅、重连、取消、历史回看
                 │ 登录身份 + taskId/runId
                 ▼
Spring Boot Collaboration API / 权限校验 / 安全事件投影
  ├─ App-level RunService（任务领取、幂等、持久化、取消）
  ├─ Spring AI Alibaba Graph（并行、条件路由、循环、节点可观察）
  │    ├─ 图像分析事实来源：现有安全推理服务 / gRPC
  │    ├─ Vision Agent（解释已验证推理与质量限制）
  │    ├─ Evidence Agent（受控来源检索与冻结）
  │    ├─ Explanation Agent（草稿生成、绑定引用）
  │    └─ Critic Agent（异议、重写或补证建议）
  ├─ Domain Gates（Task / Evidence / Draft / Review / Release）
  └─ Event Store + SSE（存储后发布、重放、权限过滤）
                 │
                 ▼
Doctor Review（人工复核、来源复验、批准后才可发布）
```

### 4.2 Graph 候选主路径与等价性验证

```text
START → task.validate → image.inference_snapshot
  ├─ Vision ───┐
  └─ Evidence ─┤ 并行，等待两者合法输出
               ↓
          Explanation vN → Critic
               ↑          ├─ NONE → review_gate → REVIEW_READY
               ├─ REWRITE ┘
               └─ SUPPLEMENT → Evidence → Explanation → Critic
所有反馈均受版本、证据、调用预算与循环上限约束。医生批准及发布在执行结束后独立进行。
```

**务必保留的领域语义**：

- 任务/图像/模型推理快照具有稳定绑定；异步事件不能把 A 图结果写到 B 图会话。

- Vision、Evidence 可以并行，Explanation 等两者合法完成；Critic 对确切 claimId、citationIndex 或 vision:summary 定位异议。

- REWRITE 只针对已定位草稿问题；SUPPLEMENT 需要找到新增、合规的医学证据；二者均遵循现有版本、预算和循环上限。

- 失败必须保留有意义的停止原因（如 PROVIDER\_AUTH / PROVIDER\_RATE\_LIMIT / INVALID\_OUTPUT / SOURCE\_INVALIDATED / TOTAL\_TIMEOUT），不能统一吞成“AI 分析失败”。

- REVIEW\_READY 是“可交医生复核”，不是患者可见的结论许可。

### 4.3 Graph State 建议字段（内部，严禁原样输出）

```text
runId, taskId, threadId, ownerUserId, workflowVersion
inferenceDigest, inferenceSnapshotRef, modelVersion, imageAssetRef
visionResult, visionLimitations
frozenEvidenceRef, evidenceVersion, retrievalStatus
draftRef, draftVersion, claimRefs, objections, feedbackAction
iterationCount, modelCallCount, elapsedBudgetMs, stopReason
nodeStates, runStatus, startedAt, updatedAt
```

统一的状态更新约束：使用已验证的 Graph state reducer/合并策略，避免并行覆盖；持久化快照与诊断任务事务归属清楚；所有对象在 DTO 转换后才可进入 UI。日志/事件不得直接复制完整 Graph State。

### 4.4 接入现有任务模型

- **复用**既有 t\_diagnosis\_task 和 t\_patient\_draft\_run 等任务/草稿数据，禁止再做一套互不相认的诊断任务生命周期。

- 对每次协作执行引入稳定 runId（必要时对应多轮版本），明确 taskId ↔ runId ↔ threadId ↔ ownerId 关系。

- 用户上传图像后：仅在推理事实满足既有安全门禁、任务进入可协作态时启动；“上传成功”不等于“推理成功”，也不保证所有 Agent 都可执行。

- 按需扩展已有任务 service，避免直接从浏览器调用 Coordinator 的 run(taskId) 内部方法。

- 本阶段**不强制**合并 t\_agent\_session / t\_patient\_draft\_message；建立索引/引用关系，避免不受控数据库重构。

### 4.5 运行归属 取消与重启恢复

创建 run 时固化 runtimeKind（COORDINATOR 或 GRAPH）、workflowVersion、ownerUserId、taskId、threadId 和 inferenceDigest；后续开关变化不得把活动 run 迁给另一执行器。使用唯一任务绑定和请求幂等键防止重复创建；同一键带不同输入应返回幂等冲突。

领取依赖数据库原子条件更新、租约与递增 fencingToken。角色结果、检查点和状态写入均校验当前持有者、token 与预期版本；过期执行器即使稍后返回也无权提交。具体复用现有任务机制，缺项才追加实现。

取消是服务端持久意图：取消事务先把可取消运行置为 CANCEL\_REQUESTED 并阻止新节点派发。节点结果提交与取消必须通过同一 run 的锁或版本条件串行判定；取消先提交则拒绝后续节点结果，终态先提交则返回 ALREADY\_TERMINAL，不宣称取消成功。重复取消返回已有状态。

尽力中断正在进行的模型/工具调用，但不保证提供方立即停止或不计费。取消确认提交后，执行器逻辑终止、写入 CANCELLED 终态事件；迟到输出不得进入新草稿或发布流程。关闭网页、断开 SSE 和停止普通聊天流均不等于取消协作任务。

恢复以已提交的领域状态和结果为准。执行器崩溃后，待租约失效由新 token 接管：已提交节点结果直接复用；调用已开始但结果未提交则标记不确定，只对允许重试的无副作用调用按剩余预算重试，并记录可能重复调用及成本。

草稿版本、运行终态、审核衔接和相应事实事件应在同一领域事务提交，或以既有幂等机制保证效果唯一。外部模型请求不承诺 exactly-once；诊断保存、医生批准和发布不得通过重跑 Graph 节点自动执行。

Graph 检查点只作为执行辅助，不能替代领域事务。若图检查点与业务提交不一致，恢复先核对已提交结果及版本，禁止覆盖更新状态。M0 验证可用 API，M2 用故障注入证明实际恢复语义。

租约、心跳、节点调用、总预算和取消确认的具体时限在 M0/M1 依据现有实现与测量冻结，必须记录默认值、边界测试和超时行为；首期不新增通用配置中心。

## 5. 实时通信设计（ADR-002）

### 5.1 REST + SSE 契约建议

| **方法与接口（拟议）** | **用途** | **权限** |
| --- | --- | --- |
| POST /api/agent/collaboration-runs | 根据已有图片任务或会话上下文创建/领取协作；返回 runId 和受理状态 | 当前用户 + task ownership |
| GET /api/agent/collaboration-runs/{runId} | 获取快照、角色最终状态及恢复入口 | 当前用户可访问的 run |
| GET /api/agent/collaboration-runs/{runId}/events | SSE；支持 Last-Event-ID 或等价游标 | 当前用户可订阅的 run |
| POST /api/agent/collaboration-runs/{runId}/cancel | 用户主动取消、权限与幂等校验 | 任务拥有者或授权管理员 |
| GET /api/agent/collaboration-runs/{runId}/history | 授权历史协作摘要（分页），可恢复 UI | 按角色过滤 |
| 现有 /api/agent/chat/stream | 继续服务普通对话及旧版兼容，后续可统一路由 | 原有权限不变 |

建议事件订阅从 GET 读取，任务创建使用 POST 幂等键；保留原有 @microsoft/fetch-event-source，无须先引入 WebSocket。浏览器断开 SSE 不应中断已领取的后台任务。

### 5.2 SSE 业务事件封装

```json
{
  "eventId": "run-8f52:104",
  "schemaVersion": 1,
  "runId": "run-8f52",
  "threadId": "thread-36c1",
  "sequence": 104,
  "occurredAt": "2026-11-11T07:00:05Z",
  "type": "agent.handoff",
  "actor": "CRITIC",
  "visibility": "CLINICIAN",
  "correlationId": "msg-019",
  "causationId": "msg-012",
  "payload": {
    "target": "claim:c2",
    "action": "REWRITE",
    "summary": "已要求修订证据不足的表述"
  }
}
```

此 JSON 是**设计示例，不是已上线接口或真实用户数据**。生产实施时 visibility 必须由后端授权策略生成，不接受客户端声称的 CLINICIAN 权限。sequence 在同一 run 中单调递增；eventId 可被可靠恢复；对每个消费者使用相同原始事实事件的授权投影。

### 5.3 事件类型建议

| **类别** | **类型** | **患者侧默认公开策略** |
| --- | --- | --- |
| 运行 | run.accepted / run.started / run.completed / run.restricted / run.failed / run.cancel\_requested / run.cancelled | 可见安全状态 |
| 角色 | agent.started / agent.completed / agent.failed | 可见角色与阶段，不含内部 prompt |
| 协作 | agent.handoff / agent.feedback.requested / agent.revision.completed | 默认仅泛化摘要；详细链医生可见 |
| 工具 | tool.started / tool.completed / tool.failed | 仅显示安全工具名称与进度 |
| 文本 | agent.output.delta / agent.output.final | 仅来自允许展示的内容，严格脱敏 |
| 证据 | evidence.search.completed / evidence.verified / evidence.invalidated | 公开经过批准的来源元数据，未批准只显示状态 |
| 审核 | run.review\_ready / review.approved / review.rejected | 可见复核状态；正文按发布策略 |
| 心跳 | run.heartbeat | 连接健康与断线恢复 |

**实现前需冻结**：事件 schema、合法枚举、状态转移、字段长度、敏感字段白名单、版本升级兼容策略、错误码映射。每个事件最多携带足够呈现的增量，不搬运完整医学记录。

### 5.4 事件持久化与重放

- 在现有表基础上按需增设 t\_agent\_collab\_event。列名采用项目小驼峰约定：runId、seq、type、actor、visibility、payloadJson、occurredAt、schemaVersion；同一 run 唯一约束 (runId, seq)。具体主键、索引和关联约束在迁移评审时冻结，Flyway 仅追加脚本。

- **先提交事件和状态，再分发 SSE**。可使用事务 outbox/commit 后通知模式，确保“收到过的事件”可重放。

- 启动订阅：鉴权并捕获一致性快照水位 H，返回授权快照和恢复游标；后续仅重放 seq > H 的已提交事件，再进入实时追赶。订阅尾部以持久事件仓库为事实源，通知仅用于唤醒；即使通知丢失也能按游标补扫。

- 重连：使用最后一个已处理的服务端游标续读；reducer 按 (runId, seq) 去重。权限过滤后的 seq 允许跳号，客户端不能按连续序号推断漏包；游标过期或投影变化时按 5.6 重新获取授权快照，重连不得创建或重跑任务。

- 活跃订阅需有限 buffer、超时/心跳、慢消费者处理与背压策略；不可无限在内存堆积 token。

- 无权订阅时直接 HTTP 403/等价拒绝，不从事件流泄露“该 run 是否存在”的敏感详情。

### 5.5 真实 token 流与可观测事件的区别

1. **事件级真实增量（首期必须）**：node started、tool result、handoff、review 等一发生就发送。

1. **模型文本真实增量（条件支持）**：若对应 ChatModel/ReactAgent 在结构化校验模式下有真实流能力，发送脱敏后的增量；最后一帧才作结构化/证据合法性承诺。

1. **不得直接可视化内部 chain-of-thought**：可显示任务级“检索中 / 正在核对引用 / 正在修订”，而不是模型隐藏推理原文。

1. **结构化 JSON 不完整时不发布临床内容**：可以显示工作状态，但正式 claim 必须通过完整校验后才进入医生审查视图。

### 5.6 游标 授权投影与订阅边界

序号规则：seq 是 run 内已提交事实事件的递增序号，允许不连续；eventId 是稳定事件标识。患者只收到允许公开的 DTO，不发送被过滤事件的占位消息、类型或临床内容。前端以单调性和合法状态迁移校验，不把跳号视为数据缺口。

恢复游标：SSE 的 id 使用服务端签发的不透明游标，绑定 runId、已扫描水位、当前主体和授权投影版本；DTO 的 eventId/sequence 用于幂等，二者不混用。游标只提供定位与完整性校验，每次订阅仍独立鉴权。Last-Event-ID 与备用游标参数同时出现且不一致时拒绝请求。

授权快照在同一一致性读取边界包含 run 状态、角色状态及经过过滤的内容，附 snapshotSequence、resumeCursor、projectionVersion。服务端保证快照反映截至 H 的已提交结果，SSE 从 H 之后读取；不得先取旧快照再跳到最新游标。

客户端串行处理可见事件并更新本地游标。心跳可附带已扫描水位游标，但只能在此前可见事件均已按序发送后推进；客户端处理完成才保存游标。断线可能导致重复投递，由 reducer 消重，不承诺网络层恰好一次。

保留窗口内支持续读。游标已早于可重放范围时，在开启 SSE 前返回 410 CURSOR\_EXPIRED；游标格式或签名错误返回 400 INVALID\_CURSOR；授权投影版本变化返回 409 SNAPSHOT\_REQUIRED。客户端重新取快照替换本地协作态，再续读，不重新创建 run。具体保留期限在上线前冻结。

查询、订阅和取消对不存在及无权访问采用一致的拒绝策略。会话过期或授权撤回时关闭已有订阅，禁止继续发送细节；浏览器清除受保护协作态。服务端在批次发送前复查授权，活动连接也必须响应权限变更，不能仅在连接建立时鉴权。

单个 SSE 连接内按 seq 递增发送。客户端接到重复或迟到事件不回退状态；未知 schemaVersion、无法解析的状态事件或协议乱序应停止应用该流并获取快照。可忽略的扩展事件采用显式兼容规则，不静默跳过关键状态更新。

慢消费者超过有限缓冲时关闭连接并要求按游标重连，持久事件不得为照顾连接而丢弃。终态的最后事件发出后允许关闭流；医生复核后续变化可在同一授权历史中追赶，重新进入页面以快照为准。

### 5.7 执行状态与医生复核状态

执行状态建议为 ACCEPTED → RUNNING → SUCCEEDED / RESTRICTED / FAILED，或 ACCEPTED / RUNNING → CANCEL\_REQUESTED → CANCELLED。四个执行终态不可回退；运行需要重试时经显式操作创建新的 run，不重用旧终态。

审核状态独立维护 NOT\_SUBMITTED、PENDING、APPROVED、REJECTED，绑定准确的 draftVersion。只有通过全部领域门禁的成功草稿能进入 PENDING；批准、驳回和批准后的来源失效均由既有医生复核与发布服务处理。APPROVED 仍须满足发布时来源复验和保存权限。

run.review\_ready：表示合法草稿提交复核；run.completed：仅表示协作执行成功结束，UI 展示“协作完成，待医生复核”；review.approved：表示对应版本获医生批准。执行成功与待复核状态需一致提交，事件按 review\_ready 后 completed 的顺序持久化。

新增 run.restricted、run.cancel\_requested 两类拟议事件。受限运行不生成“已完成正常分析”的提示，不进入 PENDING；失败、取消、受限均保留分类原因。审核驳回不改写已完成执行的历史；后续修订须建立明确的新版本或新 run 关系。

协议示例：患者收到 seq 100 的 agent.started，医生独享的 seq 101 不投影，患者随后收到 seq 102 的 agent.completed，均为合法顺序；若断线前只处理到 100，续读应补发可见的 102。不得为 101 制造假消息，也不得因跳号重新运行任务。

## 6. React /agent 工作台交互设计（ADR-003）

### 6.1 页面信息架构

```text
┌──────────────────────────────────────────────────────────────┐
│ 原 Agent 顶部栏：产品名 / 当前会话 / 状态 / 设置                │
├────────────┬───────────────────────────────┬─────────────────┤
│ 左侧会话   │ 中间：实时多 Agent 协作主舞台  │ 右侧：影像和证据 │
│            │                               │                 │
│ 历史记录   │ 阶段进度 + 角色状态条          │ 原图/放大       │
│ 最近任务   │ 真实消息/交接/异议/修订时间线 │ 模型推理版本    │
│ 新建会话   │ 审核结果与后续问答            │ 受控引用详情    │
│            │                               │ 权限提示        │
├────────────┴───────────────────────────────┴─────────────────┤
│ 原有输入框：文本 / 上传图像 / 发送 / 停止 / 任务取消           │
└──────────────────────────────────────────────────────────────┘
```

**移动端**：三栏收敛为主舞台 + 可抽出的会话列表 + 可抽出的影像/证据面板；任务状态固定可见，避免图像占满屏幕导致进度不可读。

### 6.2 五个关键体验场景

- **空状态**：延续原有产品的问答输入框；提示可上传眼底图进行协作分析，不假装后台已有运行。

- **上传后启动**：先显示文件校验、上传/推理受理、当前安全状态；当 run.accepted 到来，再逐个点亮真实 Agent 状态。

- **实时协作中**：按真实业务事件自然生长时间线；并行工作显示并行态；手动展开具体交接链与证据；不播放固定脚本。

- **异议与修订**：在 Critic → Explanation/Evidence 的因果链上显示“针对 claim c2 要求重写”，支持折叠；患者默认仅见“正在复核/补充证据”。

- **完成/失败/刷新恢复**：区分“待医生复核、已批准、受限终止、取消、提供方不可用”；重新进入会话仍能看到正确的状态和合法历史。

### 6.3 建议 React 组件分解

| **组件/模块（拟建或改造）** | **职责** | **基于现有文件** |
| --- | --- | --- |
| AgentPage.tsx | 统一入口，路由/会话/布局/任务模式协调 | web/src/pages/AgentPage.tsx |
| CollaborationWorkspace.tsx | 协作主视图与状态卡片 | web/src/components/agent/ 下新增 |
| AgentStatusRail.tsx | 角色状态、并行关系、运行进度 | 同上 |
| CollaborationTimeline.tsx | 时间线、交接、异议、修订、失败、可展开证据 | 参考 Studio NodeTimeline |
| EyeImageEvidencePanel.tsx | 影像预览、质量/推理元信息、引用来源 | 复用已有资源面板模式 |
| useCollaborationRun.ts | 创建 run、SSE、恢复、停止、错误分类 | 扩展现有 web/src/lib/agentStream.ts，保留旧聊天路径 |
| collaborationReducer.ts | 纯函数消重、顺序、状态转移、事件映射 | 可单独覆盖单测 |
| collaborationApi.ts | 类型化后端接口与错误处理 | 现有 web/src/lib/api.ts 体系 |

不需要一次性引入全局状态库；若现有 React 状态足够，则在 AgentPage/hook 内维护。只有经过性能分析出现跨路由共享/缓存复杂性时再考虑新增依赖。

### 6.4 视觉与动效要求

- **完全继承 web/src/styles/tokens.css** 的两主题、上下文令牌；禁止沿用旧 Vue 的 --iris-\*，也不得复制 Studio 的白底/灰底样式。

- 延续 **The White Instrument（白色仪器）**：骨白工作台、发丝线、克制布局、数字 tabular-nums，风险严重度与品牌信号橙分离。

- 用真实事件控制状态微动效，如节点从“等待→进行中→完成”的柔和过渡；遵守 prefers-reduced-motion；禁止粒子、扫描线、伪打字机动画和眩目环形进度。

- 关键事件需配文字，不仅靠颜色传达；运行、停止、异常与医生复核状态应有可访问标签。

- 协作过程较长时对列表采取虚拟化或折叠策略；滚动仅在用户停留底部时自动跟随，用户上滑阅读时不得强制抢滚动。

- 图像/引用来自不可信内容时必须净化；不得 dangerouslySetInnerHTML 直接渲染模型输出，Markdown 管线复用已有安全实现。

### 6.5 不复制 Studio UI 的原因

Studio 适合**开发者验证 Graph 是如何执行的**；我们的前端要让**普通用户理解分析在进展、医生理解证据与责任边界**。两者可以共用 UI 模式，但必须分开权限、语言、信息密度和交互方式。

## 7. 医学安全、权限与审计（不可延期）

### 7.1 数据可见性矩阵

| **信息类型** | **普通用户（本人）** | **授权医生** | **管理员/开发调试** |
| --- | --- | --- | --- |
| 任务是否受理、角色阶段进度 | 是 | 是 | 按权限 |
| 图像本体/完整上传标识 | 仅本人的受控资源 | 仅授权患者 | 仅授权范围 |
| 内部 Graph State、完整 Prompt | 否 | 否（默认） | 仅必要且脱敏的开发环境 |
| Agent 原始未校验临床文本 | 否 | 严格限制，不作为可发布诊断 | 脱敏测试环境 |
| 可追溯结构化异议、审查材料 | 安全进度摘要 | 是 | 按权限与审计 |
| 医生复核前草稿全文 | 否 | 是 | 按权限 |
| 医生批准后可发布内容 | 是 | 是 | 按权限 |

### 7.2 五个独立门禁

1. **身份与任务归属**：创建、订阅、查看、取消、历史、影像访问均独立校验；用户 ID 一律来自后端可信 session。

1. **影像与推理来源**：对 imageAssetRef / taskId / inferenceDigest 做一致性校验，防止错图串结果；无安全推理快照时不得启动宣称已完成的 Vision 分析。

1. **证据/引用合法性**：冻结受控资料、精确 excerpt 核验、失效复验；错误引用阻止进入 REVIEW\_READY。

1. **模型工具权限**：四 Agent 最小工具白名单；不接受 RAG 文档/模型文本作为系统指令；禁止自动保存诊断与处方操作。

1. **人工复核发布**：医生批准 + 来源复验 + 既有保存发布门禁；该流程与 SSE 进度展示分离。

特别注意：原来的病人解释草稿不应该因为想让“协作看起来更精彩”就直接公开；将“实时显示内部临床讨论”定义为另一个需要临床负责人批准的产品决策，首期默认关闭。

### 7.3 任务与日志隐私

- 事件载荷采用 allowlist DTO；不记录环境变量、API key、敏感全文、系统提示词、未授权影像 URL。

- 用户删除/撤销数据、凭证失效、图片所有权转移时，协作历史和附件清理要遵循现有数据保留策略；具体保存期限需与产品/合规要求确认。

- 监控汇总以 runId、节点、阶段、错误码、时长为主；敏感链路只对授权排障可见。

- 对 OOD 未评估、未经校准的置信度等状态保留原有说明，不可把模型 confidence 当诊断确定性。

### 7.4 正常协作与受限处理分别验收

正常路径：影像归属、推理快照和既有质量/OOD 门禁满足条件后，运行四角色协作、精确引用核验、草稿提交复核及医生批准发布。正常路径样例必须记录各门禁实际状态，不能靠临时关闭校验放行。

受限路径：对 OOD 未评估、影像质量不足、缺失可信快照或证据不足，复用现有门禁作出限制或拒绝。页面说明限制原因和允许的下一步，显示哪些阶段没有执行；不得模拟四角色已完成，不因受限样例跑通就宣称正常路径验收通过。

提供方认证、限流、不可用、非法 JSON、无效引用和来源失效分别保留原因与适当安全提示。正常、受限、故障、取消的证据分开记录；真实模型、确定性夹具和浏览器模拟事件也分别标识。

## 8. 分阶段实施与 PR 拆分

### M0 · 基线 协议草案与 Graph 能力验证

工作：重新核对工作树、SHA、远端与 React web/；对 1.1.2.2 做隔离 SPIKE，验证并行汇合、条件反馈、节点事件、停止及检查点；冻结角色和事件边界，并对现有执行器开展小规模真实提供方 smoke，记录引用及反馈路径能力。

输出：带时间的基线审计、docs/architecture/multi-agent-adr.md、Graph 能力矩阵、事件契约草案、早期真实提供方记录和分支整合策略。

验收：不替换正式入口；可复现编译和测试；明确 Graph 已验证/受限能力、正常与受限输入条件。真实提供方未运行须标记 NOT\_RUN；缺少真实反馈样本须列入 M1/M5 跟踪，不能包装成已验证自治。

### M1 · 现有执行器真实事件基线（后端 PR-01）

工作：先冻结 schema v1；CollaborationRunService 绑定运行归属，现有 Coordinator 接统一事件出口；实现事务事件、授权快照、SSE 重放、取消和分类错误。沿用现有医学门禁，追加必要 Flyway 迁移，形成浏览器可消费的真实事件基线。

验收：现有执行器的正常/受限/故障路径、跨账号拒绝、过滤序号跳号、快照边界、游标失效、断线重放、取消和迟到结果测试通过。早期真实模型验证单独记录准确引用及 REWRITE/SUPPLEMENT 样本或未达成原因；不得以夹具替代真实闭环证据。

### M2 · Graph 适配与领域等价性（后端 PR-02）

工作：把四角色包装为 Graph 节点，复用 M1 的 run、事件、权限与领域守卫；实现并行汇合、有界反馈和恢复适配；runtimeKind 在创建时固定；使用隔离夹具对照旧执行器，Graph 开关默认关闭。

验收：3.3 等价性矩阵通过；重启和提交边界故障注入通过；旧执行器与 Graph 不重复领取或提交。若能力未达标，继续由现有执行器承载实时工作台，Graph 迁移明确保持未验收。

### M3 · React 事件层与会话集成（前端 PR-03）

工作：基于 M1 冻结契约实现 typed API、collaborationReducer、useCollaborationRun；旧聊天保留；实现 run-scope、身份切换、快照替换、断流、游标及事件幂等处理。

验收：fixture 确定性重放；授权过滤跳号正常；旧流不污染新会话；410/409 恢复不创建新任务；取消仅作用于用户选定运行；现有执行器与 Graph 共用同一前端契约。

### M4 · 协作工作台视觉改造（前端 PR-04）

工作：原地升级 AgentPage，增加真实状态条、时间线、影像证据面板及异常/复核状态；沿用主题、导航和输入；先接现有执行器的真实事件，再回归 Graph 路径。

验收：双主题、桌面/手机、键盘/读屏及减弱动效通过；正常、受限、取消中、取消、故障、待复核、批准和驳回均有明确状态；不把 run.completed 展示为医生批准。

### M5 · 扩大真实模型评估与反馈闭环（后端 PR-05）

工作：在 M0/M1 的早期样本上扩大真实提供方评测，处理引用 excerpt 不匹配；验证可定位异议、有效补证和重写，比较现有执行器与 Graph 的合法完成率、成本和时延。

验收：真实模型结果与确定性故障夹具分别报告；至少保留经核对的真实反馈样本及来源版本。样本不足、无法稳定触发或引用失败须保留局限，不宣称完全自治；质量阈值和样本在评测前冻结。

### M6 · 医生详细协作审阅（后端与 React PR-06）

工作：授权医生视图展示经过校验的角色材料、claim/citation、因果链和版本；复用医生复核与发布服务，区分执行终态、审核状态和实际发布权限。

验收：权限矩阵负例通过；批准绑定准确草稿版本；来源失效时阻止发布；已建立的 SSE 在授权撤回后停止披露；患者不能通过历史重放获取未批准草稿。

### M7 · 分路径端到端 性能 灰度与回滚（交付 PR-07）

工作：Playwright 分别运行正常协作至医生复核/发布、受限停止、提供方故障和主动取消；验证恢复、并发、SSE 时延及切换开关；按管理员、医生、小范围用户逐步灰度。

验收：P0/P1 及新增 E2E 用例通过，CI 无新增禁用或跳过；正常路径未完成时整体保持 PARTIAL。回滚验证活动 run 按原执行器安全完成/终止，数据与审计保留；冻结 SLO 与运营参数。

### 8.1 任务依赖与合并顺序

推荐依赖：M0 → M1（现有执行器事件基线）；M1 → M2（Graph 等价性）与 M3 → M4（React）可并行推进；M5 从 M0/M1 早期验证持续扩展，M6 依赖已冻结权限与复核契约，M7 汇总验收。Graph 迁移与实时 UI 分别报告状态；各 PR 独立验证，不混入无关 OOD 工作区改动。

## 9. 可直接交给 Coding Agent 的任务卡

### TASK-01｜建立 Graph 能力 SPIKE

- **输入**：pom.xml 锁定版本、PatientDraftCoordinator.java、Studio/DeepResearch 官方示例。

- **执行**：在隔离 package/测试下构建四节点的真实 Graph；只允许测试数据；验证 node stream、parallel join、feedback loop、stop 和 checkpoint；形成通过/失败矩阵。

- **禁止**：直接重写 Coordinator、直接引入不同版本 BOM、写入密钥。

- **完成条件**：可复现单测/集成测试；API 结论有 commit/source 证据。

### TASK-02｜Graph 节点封装与执行器等价性

- **输入**：DraftAgents、DraftMailbox、任务/引用/复核守卫。

- 执行：在 TASK-01 能力验证和 TASK-03 现有执行器事件基线后，封装 Graph 角色节点；复用领域守卫与事件出口，验证 3.3 等价性和 4.5 取消/恢复；不得同时重做前端协议。

- **禁止**：取消 exact quote 校验、直接给角色写库/发布权限。

- 完成条件：NONE/REWRITE/SUPPLEMENT/故障及安全负例通过，取消与重启故障注入通过；与旧执行器对照有记录，Graph 未通过不得切换正式运行。

### TASK-03｜先接现有执行器的持久事件与 SSE

- **输入**：runId/任务归属模型，官方流式对象。

- 执行：在现有 Coordinator 输出真实领域事件，提供 DTO v1、事务落库、授权快照、序号与不透明游标、SSE 重放、取消接口；完成后供 TASK-02 与 TASK-04 共用。

- **禁止**：直接返回 OverallState、在重连时重跑任务、用 SSE 连接生命周期控制任务。

- 完成条件：断线、403、跨用户、重复、过滤跳号、快照竞态、游标过期、权限撤回及慢订阅通过；续读不触发任务重跑。

### TASK-04｜React 事件层与协作态

- **输入**：web/src/lib/agentStream.ts、正式 React AgentPage.tsx、事件 schema。

- 执行：实现 reducer、typed API、run-scope 门禁和 snapshot+SSE 恢复，处理权限过滤跳号、410/409、身份切换与终态；保留现有用户输入和会话操作。

- **禁止**：复用旧 Vue、混用一个 boolean 表示聊天和协作任务的所有状态。

- **完成条件**：组件/Hook 测试覆盖会话切换、取消、重放、身份切换。

### TASK-05｜Iris React 多 Agent 协作 UI

- **输入**：web/DESIGN.md、tokens.css、Studio NodeTimeline、已有 React 组件。

- **执行**：制作细腻但克制的状态条、时间线、引用面板、任务完成状态、移动响应式与两主题；利用真实事件展示异议/修订。

- **禁止**：伪造对话、扫描线/粒子/装饰性 AI 动效、复刻 Studio 视觉壳、暴露患者不可见字段。

- **完成条件**：截图回归 + a11y + Playwright；主流程与边界态样例均通过。

### TASK-06｜早期真实模型验证与扩大对照评估

- **输入**：既有真实模型试验记录、结构化输出契约、受控 RAG 资料。

- 执行：M0/M1 先验证现有执行器的真实引用与反馈链；M5 再对单 Agent、固定顺序和 Graph 有界反馈进行预注册对照，记录合法完成、引用、拒绝、耗时及成本，提交匿名化可追溯证据。

- **禁止**：用模拟反馈测试冒充真实模型自治效果；用自评文字替代可核验数据。

- **完成条件**：指标定义、样本、日志/证据、结论局限可复现。

### TASK-07｜权限、医疗审核与生产开关

- **输入**：角色权限、既有医生复核链、数据发布规则。

- **执行**：患者/医生双视图事件投影、鉴权负例、安全门禁、功能开关、监控与回滚手册。

- **禁止**：因产品展示需求绕开审核。

- **完成条件**：权限矩阵和故障回退经 E2E 验证。

### 9.1 任务卡执行顺序与证据要求

任务卡编号保持兼容，不代表实施先后：TASK-01 → TASK-03 → TASK-02 / TASK-04 → TASK-05；TASK-06 的早期验证随 TASK-01/03 开始，扩大评估在运行时稳定后进行；TASK-07 的权限约束贯穿各卡，最终执行端到端与回滚验收。

每张任务卡记录目标 SHA、输入来源与门禁状态、变更文件、命令、通过/失败/跳过数量、实际提供方或夹具、未验证项和回滚方式。缺失数据或凭证明确标注 BLOCKED\_ENV / NOT\_RUN，不以一次受限或模拟运行替代整体验收。

## 10. 测试、评估与验收

### 10.1 单元和契约测试

**Java**：Graph 状态转移、版本绑定、并行 join、超时/取消、结构化解析、quote 精确核验、PROVIDER\_AUTH/PROVIDER\_RATE\_LIMIT/PROVIDER\_UNAVAILABLE/INVALID\_OUTPUT 区分、重复领任务、缺失/失效证据、任务归属。

**React**：collaborationReducer 的事件重复、乱序、缺口、重播、终态不可回退、旧会话隔离、两主题渲染、下载/影像权限错误、失败恢复、长列表、用户手动滚动不被抢占。

**接口契约**：schema 版本、必填字段、角色/类型合法枚举、body 大小限制、未知事件容错；前后端共享 fixture 或 OpenAPI/JSON Schema 类型生成以避免漂移。

### 10.2 端到端必须覆盖的场景

| **ID** | **场景** | **通过标准** |
| --- | --- | --- |
| E2E-01 | 用户上传合法眼底图 | 真实任务受理，浏览器收到 run.accepted 和真实角色事件 |
| E2E-02 | Vision/Evidence 并行 | 时间线上可核验两者重叠执行，无错误汇合 |
| E2E-03 | Critic 给出具体异议 | 医生视图能定位来源、收件人、修订回执；患者无敏感原文 |
| E2E-04 | 页面刷新 / 网络中断 | 游标补偿并消重；任务不中断，不二次运行 |
| E2E-05 | 跨账号访问 runId | 查询、SSE、取消均拒绝且无数据泄露 |
| E2E-06 | 提供方 401/429/5xx 与非法 JSON | 对应正确错误类别、UI 友好反馈、审计留存 |
| E2E-07 | 无效引用或证据失效 | 拦截 REVIEW\_READY，未产生公开医学结论 |
| E2E-08 | 审核未完成 / 已通过 | 患者仅在批准后查看可发布内容，医生看到复核版本 |
| E2E-09 | 用户切换会话 / 中止流 | 旧事件不污染新会话；任务取消按用户明确操作 |
| E2E-10 | 亮暗主题、移动、键盘、减弱动效 | 信息可读、焦点正常、无横向溢出、无过度动画 |

### 10.3 协作收益实验设计

用同一批经过合法授权或合成/公开的受控输入对比：A 单 Agent；B 固定顺序四阶段；C 有限反馈的 Graph 四 Agent。至少记录 任务合法完成率、引用 excerpt 精确匹配率、无依据 claim 比例、Critic 可定位异议率、拒绝/限制正确率、平均/P95 耗时、模型调用次数、推送时延。样本量与阈值必须在试验设计中预注册；如果数据少，明确报告置信区间和局限，不用主观体验证明“多 Agent 更准确”。

### 10.4 不允许放行的 P0

- 普通用户读取未复核临床草稿、别人影像/事件或原始 Graph State。

- 前端所显示的 Agent 交接不是来自真实服务端事件。

- 当前图像与上一任务的结果混配、不同用户/会话串流。

- 断线重连导致重复创建临床草稿或重复发布。

- 引用不合法仍标记为可供医生复核。

- run.completed 误导用户以为已有正式临床结论。

### 10.5 v1.1 新增协议与恢复验收

E2E-11 授权过滤跳号：同一事实流含医生专用事件，患者可见 seq 跳号仍正确完成，无占位泄露或错误重跑；医生看到授权细节。

E2E-12 快照与订阅竞态：在获取快照期间并发提交节点事件，验证 H 之前由快照覆盖，H 之后通过重放补齐；通知丢失后仍能从事件仓库追赶。

E2E-13 游标恢复：分别验证过期、无效、另一账号游标及投影版本变化；正确返回约定错误或拒绝，客户端用快照恢复，任务创建和模型调用次数不增加。

E2E-14 取消竞态：在等待、角色调用、结果提交和终态提交边界取消；取消先提交则迟到结果不落草稿，终态先提交则返回不可取消，重复请求幂等。

E2E-15 崩溃恢复：在模型返回前、结果提交前、状态事件同事务提交后但推送前注入崩溃；验证已提交结果复用、事件可重放、必要重试有记录，旧 fencingToken 不可写入。

E2E-16 运行时开关切换：已有 Coordinator/Graph run 保持原 runtimeKind，仅新运行遵循开关；不存在双重领取、重复草稿或静默丢失。

E2E-17 活动订阅权限撤回：医生授权撤回、用户退出或会话失效后停止细节推送，清除本地受保护状态，不能用旧游标继续读取。

E2E-18 医学受限输入：OOD 未评估、质量不合格或无可信快照分别显示真实限制，不伪造角色完成，不进入复核或公开结论；与正常协作验收单独计数。

E2E-19 执行与审核分离：run.completed 后患者仍只见待复核；批准、驳回、版本变化和来源失效由审核/发布规则控制，不因 SSE 重放改变许可。

E2E-20 慢消费者与乱序：缓冲达到上限后可恢复断连，无无限堆积；重复事件不重复渲染，关键协议乱序触发快照恢复，合法过滤跳号不触发错误。

### 10.6 分项验收与整体放行

分别记录实时事件工作台、Graph 迁移、真实模型反馈质量、医生复核和正常医学输入链路的验收状态。现有执行器工作台可以先验收，Graph 或正常输入材料缺失时相关项保持未完成；整体升级仍须满足第 13 章全部门禁。性能目标是待测目标，报告实际样本、分位数和测量条件。

## 11. 发布、运营与回滚

### 11.1 Feature Flags 建议

```properties
eye-diagnosis.collaboration.enabled=false
eye-diagnosis.collaboration.graph-enabled=false
eye-diagnosis.collaboration.patient-progress-enabled=false
eye-diagnosis.collaboration.clinician-detail-enabled=false
eye-diagnosis.studio.dev-enabled=false
```

**以上均为建议配置名，不是目前已存在的项目配置。** 生产发布应采用单独默认关闭、可在受控环境灰度的开关；是否动态更新取决于现有配置系统。

### 11.2 灰度顺序

1. **开发环境**：固定事件夹具 + Graph SPIKE，验证协议与图运行。

1. **管理员内部试点**：真实模型但仅有限授权任务；完整审计，不公开患者信息。

1. **医生受控试点**：检验可解释性、引用、人工复核和中途失败处理。

1. **小范围普通用户**：只发布“安全进度 + 审核后结果”，采集性能和交互反馈。

1. **扩大覆盖**：SLO、安全和评估指标达到目标后，再按权限逐步扩展。

### 11.3 回滚策略

- 关闭 patient-progress-enabled 可立即退回普通状态展示，而不破坏正在运行的后端任务。

- 关闭 graph-enabled 仅改变新建 run 的执行器选择。已有 Graph run 保持其 runtimeKind/workflowVersion，使用兼容版本继续完成或按持久取消流程终止；不得交给旧执行器从头执行。必要时保留兼容 worker 清空活动运行，再停止旧版本。

- 旧 /agent/chat/stream 维持兼容，保留文字问答与历史会话；切换时不改变 runId/threadId 归属记录。

- 新 Flyway 迁移只追加、不可改历史脚本；必须提前验证回滚后的旧版本能安全忽略新表/新字段。

### 11.4 回滚演练与上线前冻结项

演练分别覆盖仅关闭患者进度、关闭新 Graph 运行以及回退应用二进制。二进制回退前确认活动运行已完成/取消，或仍有兼容 worker 承接；旧版本不能识别的新状态不得交给旧 worker 领取。

新事件表和索引保留，旧应用须能安全忽略；不能以删表或回退 Flyway 历史实现回滚。恢复后以原 runId、运行归属和版本继续授权查询，不重复创建诊断任务。

上线前记录责任人与具体值：事件保留窗口、租约/心跳/调用/取消时限、缓冲与载荷上限、单用户订阅和运行并发限制、模型重试预算、权限撤回传播方式、性能阈值及告警。尚未冻结时不放行生产灰度。

## 12. 风险登记与决策待办

| **风险** | **严重度** | **应对与责任建议** |
| --- | --- | --- |
| 1.1.2.2 Graph API 与最新示例不一致 | 高 | M0 先 SPIKE；锁版本，禁止混抄新旧 API；后端负责人 |
| 自建 Coordinator 迁移后丢安全门禁 | 极高 | 先契约对照、再灰度；原有验证测试不可删除；后端+安全负责人 |
| 四角色结构化输出无法 token-stream | 中 | 首期采用事件级真实流；文本增量列为条件项；产品负责人 |
| 引用不准确、真实异议链不足 | 高 | M5 单独专项评测，不因 UI 上线而豁免；算法/Agent 负责人 |
| 患者看见未审核结论或隐藏推理 | 极高 | 后端授权投影+字段白名单+负例 E2E；安全/临床负责人 |
| SSE 断线、重复、并发资源泄露 | 高 | 事件持久化、幂等重连、背压和限流；后端+前端负责人 |
| React 主干与协作分支未合拢 | 高 | M0 做工作树和变更范围审计；不在旧 frontend/ 开发；仓库维护者 |
| UI 重构损坏现有聊天/上传/会话 | 高 | 独立开关、旧链路回归和分阶段 PR；前端负责人 |
| Studio 直接引入 Next.js 与不安全 API | 中高 | Studio 限开发/内网、仅借鉴 UI；架构负责人 |

### 12.1 需明确记录而非默认假定的产品决策

- 患者端**能看到什么**：本计划默认安全进度和审核后结果；真实未复核内容禁止直接发布。若要展示“Agent 互相讨论全文”，必须先经过临床/合规负责人批准并建立独立审查/脱敏机制。

- 图像上传是否自动开始全部协作：本计划采用“上传并提交/发送后触发任务”；单纯选择文件不创建诊断任务。此处避免误触发和成本意外。

- 普通文字问答是否每次启动四 Agent：本计划建议智能路由，**普通基础问答不强制全部四 Agent**；影像/高证据要求任务优先多 Agent，以避免无意义成本。

- 任务取消与浏览器断开是否关联：本计划默认**解耦**，需后端幂等停止实现。

- 多轮 follow-up 与旧对话历史关系：维持同一用户可见会话、每次协作拥有独立 runId；需冻结“引用哪个已批准结果”的行为。

## 13. 最终交付清单与合并门禁

### 13.1 代码与文档交付

- Java：Graph 协作编排、四 Agent 节点包装、领域守卫、CollaborationRunService、事件服务、SSE/API、Flyway 迁移、错误映射、单元/集成测试。

- React：正式 /agent 页面升级、协作时间线、角色状态、图像/证据侧栏、用户/医生可见性、hook/reducer、双主题、移动端及 E2E。

- 工具：开发者 Studio 使用说明、事件调试方式、示例受控任务与脱敏日志。

- 文档：架构 ADR、SSE/JSON Schema 契约、状态机、UI 组件规范、临床权限矩阵、测试报告、上线与回滚手册。

- 评估：受控与真实模型结果分开记录，附可复现执行说明和失败样本。

### 13.2 最终“用户看到的效果”验收句

在正式 React /agent 页面，上传一张眼底图并提交后，不跳出系统，不刷新页面，就能看到真实 Agent 依次或并行启动、知识检索进展、交接和复核状态；有真实异议时，授权医生可看到有因果引用的修订过程。刷新页面后进度正确恢复。对普通用户，未审核临床内容始终被安全隐藏，医生批准后才能查看可发布结果。整个界面符合 Iris「白色仪器」视觉和明暗主题规范。

**只有同时满足真实性、可靠性、医学安全与前端体验，才算本轮升级完成。**

## 附录 A｜Coding Agent 执行协议（建议固定提示）

```text
你正在执行 eyes-diagnosis 的实时多 Agent 升级，以 v1.1 为验收基线。正式前端为 React web/，不得以历史 Vue frontend/ 交付。先核对当前工作树、SHA、远端和依赖，再按 TASK-01 → TASK-03 → TASK-02 / TASK-04 的依赖推进。先在现有 Coordinator 建立真实持久事件，再以 1.1.2.2 实际能力和领域等价性验证 Graph；不混用其他版本示例。真实提供方验证从 M0/M1 开始，与夹具证据分开。保留影像绑定、引用、证据冻结、预算、权限和医生复核门禁。取消、游标、授权投影和恢复依照第 4/5 章执行。每次实施一张任务卡及其必要依赖；限定当前 diff 和暂存范围，不混入无关 OOD 或他人改动。每个 PR 提供变更、决策、测试与跳过数、证据类型、未验证项和回滚方式；禁止伪事件、伪 token、密钥及患者隐私泄露。
```

## 附录 B｜来源与核对范围

项目来源与 v1.0 历史核对记录

1. yuwen773/eyes-diagnosis：master/web/、pom.xml 与 worktree-java-multi-agent-arch@6572743 的 DiagnosisAgent、PatientDraftCoordinator、DraftAgents、PatientDraftRunner、AgentController。

1. web/src/pages/AgentPage.tsx、web/src/lib/agentStream.ts、web/DESIGN.md、web/src/styles/tokens.css（以目标开发分支最新版为最终真源）。

1. 用户提供：《多 Agent 协作：设计讨论、实现边界与交付状态报告》，2026-11-11。

**外部来源（源码/官方文档检查）**

1. [https://java2ai.com/docs/frameworks/studio/quick-start/](<https://java2ai.com/docs/frameworks/studio/quick-start/>)

1. [https://github.com/alibaba/spring-ai-alibaba/tree/main/spring-ai-alibaba-studio/agent-chat-ui](<https://github.com/alibaba/spring-ai-alibaba/tree/main/spring-ai-alibaba-studio/agent-chat-ui>)

1. [https://github.com/alibaba/spring-ai-alibaba/tree/main/examples/multiagent-patterns](<https://github.com/alibaba/spring-ai-alibaba/tree/main/examples/multiagent-patterns>)

1. [https://github.com/spring-ai-alibaba/deepresearch](<https://github.com/spring-ai-alibaba/deepresearch>)

1. [https://github.com/spring-ai-alibaba/spring-ai-alibaba-multi-agent-demo](<https://github.com/spring-ai-alibaba/spring-ai-alibaba-multi-agent-demo>)

证据说明：v1.0 的源码和报告核对记录作为历史来源保留，v1.1 未重新核验远端、源码或外部 API。所有新增协议、状态、配置和恢复语义均为待实施基线，不能视为已存在功能。Graph 检查点、取消、恢复、Studio 兼容和真实 token 流仍以 M0/M2 编译及故障验证结果为准。开工用完整 SHA 和时间更新证据，保留未验证项。
