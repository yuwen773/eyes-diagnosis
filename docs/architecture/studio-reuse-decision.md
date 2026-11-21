# ADR-0001：Spring AI Alibaba Studio 复用决策（TASK-08 / PR-08A）

日期：2026-11-13
状态：已裁决（Draft，随 PR #68 评审）
关联任务书：`Iris_TASK08_Studio_Reuse_and_React_MultiAgent_Integration.md` §PR-08A

## 1. 决定

**不引入 `spring-ai-alibaba-studio` 到生产类路径；不采用 Studio 服务端与 agent-chat-ui 作为产品组件。**
框架层（`spring-ai-alibaba-graph-core` 1.1.2.2，已在 BOM 内）的 `CompiledGraph.getGraph(MERMAID)` 与
`NodeOutput` 流模型**可直接复用**，作为 PR-08B React 时间线/状态图的交互参考与数据来源参考。

## 2. 背景

Studio（`spring-ai-alibaba-studio`）声称提供 Graph 注册发现（`ContextScanningGraphLoader`）、
`/list-graphs`、`/graphs/{name}/representation`（Mermaid/DOT）、`/graph_run_sse` 与 Next.js 前端
（GraphWorkspace / NodeTimeline / GraphDiagram / StateInspector）。任务书要求实测其与 Iris
`1.1.2.2` 环境的兼容性，并按「直接复用 / 借鉴 / 不采用」三列裁决。

## 3. 证据（全部来自源码与本工作树 PoC，commit 见 §7）

### 3.1 版本兼容：✅ 可解析

- Maven Central 存在 `com.alibaba.cloud.ai:spring-ai-alibaba-studio:1.1.2.2`
  （`https://repo1.maven.org/maven2/com/alibaba/cloud/ai/spring-ai-alibaba-studio/maven-metadata.xml`）。
- `pom.xml` 增加同版本 test-scope 依赖后 `mvn test-compile` 通过；本地仓库已落 jar
  （`com/alibaba/cloud/ai/agent/studio/**` 38 个类）。
- 官方 tag `v1.1.2.2` = `fc9dccff672f2b89a28bf499506aaf414e772626`（alibaba/spring-ai-alibaba）。

### 3.2 自动装配：❌ 无条件 ComponentScan，Bean 名硬冲突

反编译 `SaaStudioWebModuleAutoConfiguration`（jar 内 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 注册）：

```
@Configuration
@ComponentScan(basePackages=["com.alibaba.cloud.ai.agent.studio"])
```

**没有 `@ConditionalOnProperty` 或任何条件注解**。依赖一旦进类路径即无条件扫描注册全部
Studio controller。实测后果（`mvn -Dtest=EyeDiagnosisApplicationTests`）：

```
ConflictingBeanDefinitionException: Annotation-specified bean name 'agentController'
for bean class [com.alibaba.cloud.ai.agent.studio.controller.AgentController]
conflicts with existing ... [com.csust.eyediagnosis.controller.AgentController]
```

- Studio 的 `AgentController` 与 Iris 的 `AgentController` 同为 `/agent` 入口的 `@RestController`
  且默认 Bean 名相同；`GraphExecutionController` 的 `/graph_run_sse` 端点同样无鉴权直接注册。
- 唯一缓解是 `spring.autoconfigure.exclude`；实测排除后冲突消失（本工作树
  `src/test/resources/application-ci.yml` 已加），但这意味着**每次引入 Studio 都要永久维护排除项**，
  且任何遗漏（新 module、新依赖）都会让生产应用无法启动——fail-fast 是好的，但排除项本身
  就是长期脆弱点。

### 3.3 Graph 发现机制：⚠️ 与 Iris 构图方式不匹配

`ContextScanningGraphLoader.discoverFromContext` 按 `CompiledGraph` Bean 的
`StateGraph.getName()` 注册。PoC 实测：Iris `DraftGraph.compile()` **未调用 `graph.name(...)`**，
`stateGraph.getName()` 返回 `null`——Studio 会退化为 bean 名。而 Iris 的图是**按任务现场构造**
（`PatientDraftCoordinator.executeGraph()` 内 `DraftGraph.compile(this::graphRole)`），
不是单例 Bean；`ContextScanningGraphLoader` 天然发现不了。要接入只能自定义 `GraphLoader`
（`AbstractGraphLoader` 的 `loadGraphMap()` 钩子可行，PoC 第 4 测试已验证），但这要求
把「按任务构造」改成「可注册实例表」——与现有 fenced 领域事务、任务锁的耦合方式冲突，
改造收益为零（Studio 只提供展示，不提供持久化/checkpoint）。

### 3.4 Graph 可视化能力：✅ 框架层可用，服务端层不可用

`CompiledGraph.getGraph(GraphRepresentation.Type.MERMAID)` 在 1.1.2.2 下直接产出完整
Mermaid（PoC 实录）：

```
flowchart TD
	__START__((start))
	vision("vision") ... critic("critic")
	condition1{"check state"}
	__START__:::__START__ --> vision:::vision
	...
```

并行汇合在流中以 `__PARALLEL__(__START__)` 聚合事件出现（PoC 第 3 测试实录），即
GraphDiagram/NodeTimeline 的交互模型（节点列表 + 选中展开 + state 查看）可以在
**Iris 自有 React 组件**中按同样的 `NodeOutput` 形态实现，无需 Studio 前端。

### 3.5 SSE 事件契约：❌ 不可对齐

- Studio `GraphRunResponse{node, agent, message, chunk, state}` 直接携带**完整 Graph State
  对象**（`Record<String,any>`），且无投影/可见性过滤、无游标重放、无鉴权重校验。
- Iris `CollaborationRunService.Event{eventId, schemaVersion, runId, sequence, type, actor,
  visibility, payload}`：16 类白名单载荷、AES-GCM 游标、每批重读会话/授权、(runId, sequence)
  幂等。两者**安全模型完全不同**；把 Studio SSE 接进患者/医生页面等于绕开全部投影门禁。

### 3.6 前端组件：借鉴交互，不引入代码

- `GraphDiagram.tsx`：`mermaid.initialize({securityLevel: "loose"})` + `innerHTML = svg`——
  **loose 级 Mermaid + 直接 innerHTML 是已知 XSS 面**（mermaid 官方文档明确 loose 允许点击
  回调与 HTML 标签）。任务书 §PR-08A 要求审计的点在此坐实。若 Iris 需要图示，必须用
  `securityLevel: "strict"`（或自绘），且 Mermaid 源只来自服务端受控生成（`getGraph(MERMAID)`
  的静态结构输出，不含任何用户输入）。
- `NodeTimeline.tsx`：交互模式（序号圆点 + 节点名 + agent 标注 + 40 字截断 + 选中展开）
  可作为 Iris `AgentTimeline` 的参考；其数据源是裸 `nodeOutputs`，Iris 版必须改为
  白名单事件流。
- `StateInspector.tsx`：完整 State 树展开。**仅限隔离开发工具**；Iris 患者页面禁止任何
  等价物（State 含 prompt/上下文）。
- agent-chat-ui 是 Next.js + pnpm + shadcn；Iris 是 React 19 + Vite + Tailwind v4
  自有设计系统（`web/DESIGN.md` 双主题）。直接移植组件树违反任务书 §2.2。

### 3.7 DeepResearch 与 multiagent-patterns：仅设计参考

- DeepResearch（`spring-ai-alibaba/deepresearch`，main）的 planner/researcher/reflection/HITL
  面向开放研究任务；Iris 是确定性医疗门禁流程，Planner/在线搜索/沙箱不适用（任务书 §4 底线表）。
- `examples/multiagent-patterns`（handoffs/pipeline/routing/supervisor/subagent/workflow/skills）
  与 Iris 角色（VISION/EVIDENCE/EXPLANATION/CRITIC + Critic 条件回边）在 supervisor/handoff
  的**编排思想**上可对照，但其示例无持久化、无投影、无审计，不构成实现复用。

## 4. 三列技术矩阵

| 能力 | 裁决 | 依据 | 落点 |
| --- | --- | --- | --- |
| `CompiledGraph.getGraph(MERMAID)` / `DOT` | **直接复用** | 1.1.2.2 实测可用（§3.4）；已在 BOM | PR-08B 服务端可为授权管理员提供静态结构输出（默认关闭） |
| `NodeOutput` 流模型 | **直接复用** | `DraftGraph.stream()` 已在用；Studio 前端消费同型数据 | PR-08B reducer 以 node 名 + 领域事件双轨对齐 |
| `GraphLoader`/`AbstractGraphLoader` 注册钩子 | **可参考实现** | §3.3 实测 `loadGraphMap()` 可自定义；但 Iris 按任务构图无需常驻注册表 | 仅在 08C 收敛时再评估 |
| Studio 服务端（autoconfigure + controllers） | **不采用** | §3.2 无条件扫描 + Bean 硬冲突 + 无鉴权端点；排除项维护成本高 | 不引入；`spring.autoconfigure.exclude` 仅出现在 test profile |
| Studio agent-chat-ui（Next.js） | **不采用** | §3.6 框架/设计系统冲突；`securityLevel: "loose"` XSS 面 | React 自研组件借鉴其交互模式 |
| `GraphRunResponse` SSE 契约 | **不采用** | §3.5 完整 State 透传，绕开投影门禁 | 保留 Iris `CollaborationEvents` 白名单契约 v1 |
| `NodeTimeline`/`GraphDiagram` 交互模式 | **借鉴交互方案** | 序号+节点名+选中展开+截断的模式轻量且可及 | PR-08B `AgentTimeline`/`GraphStatus` 参考 |
| `StateInspector` | **不采用**（患者面）/ 隔离 dev 工具可参考 | State 含 prompt/上下文 | 不出现在产品页面 |
| DeepResearch planner/HITL | **不采用** | 与确定性医疗门禁冲突（§3.7） | 维持现有 Critic 条件回边 |
| multiagent-patterns 编排示例 | **借鉴设计** | supervisor/handoff 思想对照 | 文档引用，不引代码 |

## 5. 避免重复造轮子的落地方案（PR-08B 衔接）

1. **图示能力**：不引 Mermaid 运行时到患者面。PR-08B 的 `GraphStatus` 用 React 有向布局
   （五个固定角色节点的静态拓扑 + 实时状态填充）表达 Vision/Evidence 并行 → Explanation →
   Critic 回边；若需 Mermaid，仅限医生/管理员面且 `securityLevel: "strict"` + 服务端静态输出。
2. **时间线能力**：`AgentTimeline` 按 Iris 白名单事件（`agent.started/completed/summary/`
   `handoff/readable`、`run.*`）渲染，交互模式参考 `NodeTimeline`（序号、角色名、选中展开）。
   数据来自 `useCollaborationRun` 的 (runId, sequence) 幂等流，不用裸 NodeOutput。
3. **不新增后端**：Studio 验证的所有能力（列表/图示/流）在 Iris 已有对应物（snapshot/
   白名单事件/SSE 重放），无需为 Studio 兼容新增端点。

## 6. 未解决风险

- **R-1**：`spring.autoconfigure.exclude` 留在 test profile；若未来有人把 studio 依赖移到
  compile scope，生产将 fail-fast（启动冲突），这是**故意的安全失败**，但需在 PR-08B 的
  verify.yml 或 README 提示。风险等级：低（冲突立即暴露，不会静默）。
- **R-2**：Mermaid 图示若进入医生面，需独立评估 mermaid 包版本与其 strict 模式的实际
  行为；本次 PoC 未验证 strict 渲染效果。风险等级：中（仅授权面，非患者面）。
- **R-3**：官方 `v1.1.2.2` 的 agent-chat-ui 依赖 `1.1.2.0`-`1.1.2.1` 示例版本（任务书 §1），
  与后端 jar `1.1.2.2` 存在示例漂移；本次以 jar 实测为准，未复刻 Next.js 端到端（避免引入
  Node 工具链）。风险等级：低（结论不受影响——服务端冲突已一票否决）。

## 7. 源码与证据索引

- 官方 tag：`alibaba/spring-ai-alibaba@v1.1.2.2` = `fc9dccff672f2b89a28bf499506aaf414e772626`
  - `spring-ai-alibaba-studio/src/main/java/com/alibaba/cloud/ai/agent/studio/loader/ContextScanningGraphLoader.java`
  - `.../loader/AbstractGraphLoader.java`（`discoverFromContext` / `loadGraphMap` 钩子）
  - `.../controller/GraphController.java`（`/list-graphs`、`/graphs/{name}/representation`）
  - `.../controller/GraphExecutionController.java`（`/graph_run_sse`，无鉴权）
  - `.../dto/GraphResponse.java`（单参构造走 DOT；`(String,boolean)` 才走 Mermaid）
  - `agent-chat-ui/src/components/graph/{GraphDiagram,NodeTimeline,StateInspector}.tsx`
  - `agent-chat-ui/src/lib/spring-ai-api.ts`（`GraphRunResponse{node,agent,message,chunk,state}`）
- 本仓库 PoC：`src/test/java/com/csust/eyediagnosis/studio/StudioReusePocTest.java`（4 测试全绿，
  含 mermaid 实录、`__PARALLEL__` 聚合事件实录、`stateGraph.name=null` 实录）
- 本仓库冲突实证：`mvn -Dtest=EyeDiagnosisApplicationTests` 输出
  `ConflictingBeanDefinitionException ... agentController`（§3.2）
- 依赖落点：`pom.xml` test-scope `spring-ai-alibaba-studio:${spring-ai-alibaba.version}`；
  `src/test/resources/application-ci.yml` 追加 `spring.autoconfigure.exclude`。
- 生产 BOM：未改动（`spring-ai-alibaba.version=1.1.2.2` 不变）。

## 8. PR-08B 最小集成方案（设计稿，待实施）

按任务书 §3/PR-08B 建议结构，新增全部为**默认可见仅限授权 run**的产品组件：

```text
web/src/lib/collaborationProtocol.ts   # 16 类白名单 DTO 严格解码；eventId≠cursor；sequence 跳号合法
web/src/lib/collaborationApi.ts        # create/get/events(SSE)/cancel；Cookie 身份；400/409/410/429/503 分类
web/src/lib/collaborationReducer.ts    # snapshot→事件状态机；(runId,sequence) 幂等；未知类型 fail-closed
web/src/hooks/useCollaborationRun.ts   # 单连接 + resumeCursor 续读；409/410 换快照；账号/run 切换清理
web/src/components/agent/collaboration/
  CollaborationWorkspace.tsx           # /agent 页显式“影像协作”入口容器（普通聊天保持不动）
  AgentTimeline.tsx                    # 白名单事件时间线（交互参考 NodeTimeline）
  GraphStatus.tsx                      # 五节点静态拓扑 + 实时状态（复用 getGraph(MERMAID) 的拓扑事实）
  ReviewHandoff.tsx                    # REVIEW_READY → 医生复核既有路径；禁止患者直接发布
```

后端**零新增端点**；`agent.readable` 仅医生投影消费，患者面只用 `agent.summary` 结构化标记。
门禁沿用现有 `verify.yml` web job（typecheck/test/build/lint）+ 后端契约 fixture 检查。
