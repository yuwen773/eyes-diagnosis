# Iris Multi-Agent R1.1 整改与第二轮独立审查

日期：2026-11-15。基线 `31f30ddc8c80a1e0556504058e6d34b145880653`，冻结 UI tag `iris-ui-v2.1-freeze-20261115`。

**总体结论：REQUEST_CHANGES。七项确认 P2 已修复并有定向回归。WP-C 的确定性产品时钟缺陷已修复，但历史 Docker 现场约 3 秒静默的因果尚未闭环，不能称 REVIEW_PASS。**

本报告取代 R1 对心跳问题“只是夹具脆弱点、非产品缺陷”的归因。继承来源、单方法通过或统一 UTC 均不能证明该结论。

## 起点与本地提交

入口工作树是 `realtime-product-acceptance`，实际分支 `fix/graph-lease-heartbeat-flake@10173ae9`；存在未提交的 PatientDraftCoordinator 心跳探针和两份未跟踪文档，均保留。集成工作树初始 HEAD 是给定 `31f30ddc`。从该提交创建 `iris-r11-remediation`，分支 `fix/iris-r11-review-remediation`。

| 提交 | 范围 |
| --- | --- |
| `fe68aff2` | WP-A：工具状态/投递串行化、迟到终态门禁、协议修复预算、聊天存活门禁 |
| `d8fca767` | WP-B：Critic 语义、冻结 Vision 白名单展示、服务端上传引用转换 |
| `100a34fb` | WP-C：领取/校验/续约统一数据库时钟，增加受控时差回归 |
| `747656f` | 快 20 秒竞争者负例；精确 Graph 例数更新至 36 |
| `2dc6820f` | 将真实后端浏览器回归对齐独立协作入口、授权图片重读；产品代码不变 |

本地候选交付代码/测试 HEAD：**e4e13aadb9673a85cc494d75cff9d9b94001b360**。完整Java组合验证在其父提交 `c2815fcdbc1af593daec1dd1ea79ce3c28482303` 执行；其后只增加两份已通过浏览器验证的测试适配。文档提交随后追加，不改变验证源码。

候选与独立分支的 src/web/src/scripts tree 分别同为 `2e0d451acf5db1cd1b4dd8895d783b1584f2d641` / `0860db39e044d8ac562e6ffae339161c139172eb` / `2fd10037074256e263aea2a09c9ea482592efb70`。提交范围的可审查补丁见 [最小产品修复](r11-minimal-fix.patch)。补丁仅含产品源码；测试和计数契约随上述提交保留。

## 七项关闭矩阵

以下测试均使用合成材料或确定性外部替身，不调用真实模型、不使用患者资料。Java代码位置相对 `src/main/java/com/csust/eyediagnosis/`；前端相对 `web/src/`。

| 原 ID | 代码位置与最小处理 | 复现与回归 | 结果 |
| --- | --- | --- | --- |
| ST-1 / WP-A1 | `agent/ToolStepSink.java`：同一 monitor 覆盖状态认领、审计顺序及发射，检查 EmitResult；仅明确的 subscriber cancellation 转为 audit-only，其余失败抛出 | `ToolStepConcurrencyTest.overlappingCompletionsDeliverEveryAuditedFrameInOrder`：用 latch 保持第一终态订阅回调在途，确认第二线程已阻塞或旧实现已返回，释放后比较审计与 SSE 完整顺序；旧实现确实缺少 two:succeeded | CLOSED |
| ST-2 / WP-A2 | 同文件：closed + pending 原子认领；重复开始/结果不能重新打开调用 | `lateAndDuplicateResultsCannotAcquireASecondTerminalState`、`duplicateStartAndFinishCannotReopenACompletedCall`、`closeOwnsTheTerminalWhileAnIgnoringToolReturns`；旧实现出现 running,cancelled,succeeded,failed。另验证意外 Sink 终止可观测、取消后审计唯一终态 | CLOSED |
| SP-2 / WP-A3 | `web/src/hooks/useCollaborationRun.ts`：只有成功应用 sequence 更高的新事实才清零 repairs，心跳和重复事实仅代表传输活着 | `useCollaborationRun.test.tsx` 中 heartbeats/duplicate 两负例及 compatible-fact 正例；旧实现两负例继续 live，修复后两次协议失败即 PROTOCOL_MISMATCH，停止订阅，fake timers 无随机 sleep | CLOSED |
| SP-4 / WP-A4 | `collaboration/CollaborationRunService.java`：subscribe/read/reauthorize 独立检查 owner 的聊天会话未删除、活跃且未过期；snapshot/后台生命周期保持独立 | `GraphExecutionTest.deletedChatClosesLiveDeliveryButPreservesAuditAndBackgroundRun`：latch 阻塞角色、等首心跳、软删除，三个入口都403；活动连接关闭，无删除后事件；释放角色后真实后台 SUCCEEDED，审计保留。旧实现 reauthorize 未抛错 | CLOSED |
| SP-1 / WP-B5 | `collaborationLabels.ts`：NONE、REWRITE、SUPPLEMENT 分别映射，未知标记中性降级 | `collaborationLabels.test.ts` 四种动作；旧 NONE 显示要求修订，修复后未提出异议 | CLOSED |
| SP-3 / WP-B6 | `DoctorReviewsPage.tsx`：只展示授权冻结 agentMessages 中 COMPLETED VISION 的 summary、字符串 limitations、reanalysisSuggestion；沿用同一材料摘要、版本与决定 API | `DoctorReviewsPage.test.tsx` 从医生页面列表/打开到审批，验证摘要、限制、建议、具体异议、隐藏推理缺席及传回原 detail 版本/摘要；旧组件未渲染摘要。后端 DoctorReviewApiTest 独立覆盖授权/版本失效，未从协作患者投影拼医疗内容 | CLOSED |
| SP-5 / WP-B7 | `DiagnosisAgent.java` + `AgentImageUploadService.java`：模型前将精确自有上传 URL 转成 active 登记 object key；检查配置来源、完整 URL、用户、登记行及状态。工具保留读取 COS 和再次授权，不抓任意 URL | `DiagnosisAgentImageReferenceTest` 从真实上传服务生成 PNG URL、经过真实 ReactAgent 模型边界，断言模型只见 key，再驱动真实 user-bound 工具存储门禁；跨用户、外站、缺失、删除、查询参数、userinfo、端口变化均在模型/COS读前拒绝；原实现将 URL 原样送模型 | CLOSED |

重现命令（配置测试专用 schema 环境变量后，使用 JDK21）：

```text
mvn -o test -Dtest=ToolStepConcurrencyTest,ToolStepContractTest
mvn -o test -Dtest=DiagnosisAgentImageReferenceTest,UserBoundEyeImageAnalyzerToolTest,AgentImageUploadServiceTest
mvn -o test -Dtest=GraphExecutionTest
npm test -- --reporter=dot
```

工具并发用例通过 latch 和线程阻塞/完成状态确定交叠窗口；没有用碰运气的 sleep 触发竞态。Graph 角色屏障确保外部工作在删除/竞争期间仍在途；原套件既有有界轮询用于观察持久状态。

## WP-C：确认根因与未解部分

按要求先复现再修改。检查了 driver/branch executor 创建与 finally shutdown、模型调用池、task→run→graph 锁顺序、事务边界、时间源和 AfterEach 线程清理。原始实现在本轮原生隔离 MySQL 上，原有整类 32/32、原方法连续 12/12 通过；这不能否定此前 Docker 整类失败。

确认的产品缺陷：`recoverPending()` 用 MySQL CURRENT_TIMESTAMP 判断过期；`takeLease()`、`checkLease()` 和续约使用执行器 Java Clock。统一 UTC 只统一时区，不能统一宿主/VM 的实际墙钟。

- 新参数化 `databaseLeaseSurvivesHostClockSkew(-6,+6)` 先测量并断言受控 DB/host 时差，复用原始方法全部时序/续约/预算/围栏断言。旧实现 **2/2 FAIL**，均失败在原 `leaseUntil > NOW()+5s` 的有界等待。
- Java 快 6 秒时，DB NOW()+3 的改写可令执行器自我 fencing；Java 慢 6 秒时，Java+10 的续约最多为 DB+4，无法满足 DB+5 的断言。这是确定性产品时钟一致性缺陷，非扩大超时可以正确解决的问题。
- 最小处理：领取活租约判断、token 绑定的校验、首次领取/续约截止时间统一使用 MySQL CURRENT_TIMESTAMP(6)，与恢复扫描相同。原 3 秒改写、10 秒 TTL、等待和 fencing 断言不改。
- 独立审查要求加强领取侧负例，新增快20秒竞争者不得调用提供方/增加 token。只回退旧 `takeLease()` Java 时间判断时该用例 **FAIL**（实际非法派发提供方），恢复修复后随整类验证。Graph 精确计数契约从32增加到36，没有放宽跳过门禁。

**仍未知**：旧 Docker 失败现场数据库已被第一次审查删除，没有同一现场的 DB/host 时间包围测量、协调器线程栈和锁等待记录。受控偏差证明了一种确定性产品失败，不能证明历史约3秒无SQL就是该原因。WP-C 历史因果调查仍 OPEN，不以原生测试全绿或上游逐字节一致把它降为夹具缺陷。

## 验证结果与环境边界

独立整改代码验证点：`747656f196ac1729b430b1bbd84f6fe9ae6fc302`；整合后组合验证点：`c2815fcdbc1af593daec1dd1ea79ce3c28482303`。以下须以实际完成结果为准。

| 门禁 | 实际结果 | 证据边界 |
| --- | --- | --- |
| Vitest | 66文件，636/636 PASS | 前端单测，无真实外部服务 |
| Typecheck / ESLint / build | 全部PASS；最后两份e2e测试另跑定向ESLint PASS | 构建存在已有大chunk提示 |
| 协作浏览器 + 冻结布局 | 31/31 PASS（协作29 + 双主题布局2） | 合成HTTP/SSE；144路由/宽度/主题检查点；截图人工检查 |
| 默认关闭浏览器 | 1/1 PASS | 生产构建预览，普通聊天独立，无协作请求 |
| 医生Vision浏览器定向 | PASS | 真实React DOM，授权材料HTTP合成；摘要/两限制/RECAPTURE可见，隐藏字段不见；测试图片403为显式夹具 |
| 原生等价pass1（按verify.sh排除三类Flyway） | 610总数，309执行PASS，301预期SKIP，0失败 | 包含完整Boot7/7和contextLoads；不能把301跳过称通过。其单独backend-unit计数门禁因排除报告缺失失败，随后完整调用补齐 |
| 原生等价pass2 | 7/7 PASS，0 SKIP；flyway精确门禁PASS | 新空schema，Flyway/上传Mapper/工具审计 |
| 原生等价pass3 | **301/301 PASS，0 SKIP**；12类精确门禁PASS | 含Graph36、医生复核36、隔离MySQL和跨JVM恢复；不是生产验证 |
| **集成候选完整调用 `mvn -o test`** | **617总数，345执行PASS，272预期SKIP，0失败；backend-unit精确跳过门禁PASS** | 候选c2815fcd，ci + GRAPH_EXECUTION_TEST_URL；Graph36/36、FullApplication7/7、SameOrigin10/10、contextLoads同调用通过。其余隔离套件结果以前项301为准 |
| 真实Java浏览器 | **5/5 PASS**，0跳过；单worker | CollaborationBrowserServer真实HTTP/SSE、MySQL与服务，MapSession及外部推理/存储/模型为合成；区别于完整SpringBoot |
| 第二轮独立审查 | Standards PASS；Spec REQUEST_CHANGES | 未确认新增P0/P1/P2；历史WP-C因果未闭环 |

最初真实Java浏览器是2 FAIL/3 NOT_RUN，截图和trace证实旧测试仍在冻结普通聊天页找协作控件。只修改两份e2e测试：入口/深链改独立工作台、用既有新建协作按钮、刷新要求重新授权获得新Blob影像；没有删除业务断言或扩大超时。backend截图路径改为target；safety两张仍写旧docs目录的截图已复制至target/r11-runtime/safety-screenshots后，仅还原本轮生成差异。两文件共享测试服务器状态，最终用`--workers=1`串行完成5项。失败和重跑日志均保留。

关键命令：

```text
npm test -- --reporter=dot
npm run typecheck
npm run lint
npm run build
playwright test e2e/collaboration.spec.ts e2e/ui-freeze-regression.spec.ts
playwright test e2e/collaboration-default-off.spec.ts
playwright test e2e/collaboration-backend.spec.ts e2e/collaboration-safety.spec.ts --workers=1
mvn -o test                 # ci + test-only GRAPH_EXECUTION_TEST_URL
python scripts/check_surefire_skips.py target/surefire-reports backend-unit
```

原生pass2/3所选类与`scripts/verify.sh`一致，12类例数由显式JSON契约逐项校验。此处没有将Docker脚本的环境失败转换为PASS。

Docker Desktop 初始未启动；启动后容器 create 请求挂起，VM 日志记录 soft lockup，重启与终止 Docker 专属 WSL 实例未恢复。已实际运行 `scripts/verify.sh`，它在创建首个 Redis 容器时报 `Docker Desktop is unable to start`。该脚本结果是 **BLOCKED_ENV/FAIL**，不能写成 Docker 三遍通过。

备用验证使用工作树 target 下全新 datadir 的原生 MySQL8.0.26、独立端口原生 Redis7.4；未连接已有业务库。SpringBoot 使用ci虚拟凭据；模型/gRPC/存储沿用验收测试确定性替身。因本机Chroma未启动，另提供只响应集合初始化GET的loopback Chroma HTTP夹具，其他请求501；不支持向量检索、不调用嵌入。这是新增明确的外部初始化替身边界，不能算真实Chroma/RAG验收。

探索中一次应用验证因Chroma缺失失败；一次共用target的并行Maven导致类扫描异常，已作废。最终门禁均串行运行，原失败日志保留，没有改产品以隐藏这些失败。

## 冻结与安全边界

- `AgentPage.tsx` 保留且与冻结tag逐字节一致；冻结页面、tokens、admin目录相对候选无新增差异，Flyway既有迁移零修改。
- 浏览器生成的旧证据目录变更先复制到 `target/r11-runtime/screenshots` 后仅还原本轮生成差异；未将时间戳/浏览器噪声写回冻结资产。
- 没有启用生产医疗协作，没有真实患者资料/模型调用，没有push、正式PR、合并或部署。仅授权范围内的本地提交及候选整合。

## 第二轮独立审查与剩余事项

使用code-review的两个独立Codex子代理：Standards初审 `31f30ddc…d8fca767` 为PASS、0确认发现；Spec为REQUEST_CHANGES，明确WP-C未闭环。Standards另以真实Reactor回调重入探针验证 `[running,cancelled]`；这不替代全套验证。Spec后续独立核对时差RED/GREEN及数据库时钟修复，未确认实现错误，提出快时钟竞争者负例，已补充。

最终产品 `31f30ddc…747656f` 复审，及测试增量 `747656f…2dc6820f` 复审：Standards **PASS / 0确认发现**；Spec **REQUEST_CHANGES / 未确认新增代码缺陷，历史WP-C仍OPEN**。原文分轴记录见 [第二轮审查](r11-second-review.md)。主代理实际重跑下表承重门禁；没有把代理判断当成运行通过。

已确认剩余P0/P1：本轮未证实新增，不能推断不存在。七项原P2：均CLOSED。WP-C历史静默原因：OPEN，维持REQUEST_CHANGES。旧报告SameOriginFilter scheme观察仍未证明真实浏览器利用链，未扩大为本轮确认漏洞或擅改过滤器。

建议：七项修复可进入后续独立复核；已执行第二轮并保留REQUEST_CHANGES。要整体放行，需在能复现历史静默的环境采集时间差、线程和锁证据，或建立能解释该静默的另一条确定性复现并最小修复。不得以此报告启用生产医疗协作。

原始执行日志及截图位于整改工作树 `target/r11-runtime/`。RED与最终GREEN的摘要和hash见 [验证清单](r11-verification.txt)。本轮服务已停止，测试端口无监听，日志保留。临时MySQL datadir `target/r11-runtime/mysql` 的递归删除被自动安全检查拒绝（`blocked by policy`），故保留该已停机目录，未改用其他方式绕过。
