# Windows 最终 Python 验收：20261017T-windows-01

**当前结论：BLOCKED；第 21 票不关闭。**

所有本轮运行证据按 attempt 保留；历史失败和训练目录样本不匹配结果保留。

调用累计：LLM 6/50；embedding 31/500 个输入文本。

最终 Windows Web：{"status": "FAIL", "passed": 821, "failed": 1, "skipped": 43, "evidence": ".scratch\\python-final-acceptance\\20261017T-windows-01\\windows-web-final\\web.xml"}。

前端 build exit=0，test exit=0；详细输出见前端日志。

## 当前阻塞

- Production structured explanation adapter timed out after JSON-mode prompt repair
- Actual patient and doctor UI actions and separate approve/refuse-save evidence are not complete
- Image deidentification confirmation pending for external supplementary sample upload
- Remaining human acceptance not executed: participant declined further manual actions
- Final Windows Web regression has not passed
- Owned runtime cleanup is not complete

## 分层证据

| 层级 | 结果/来源 |
|---|---|
| 真实供应商 embedding | PASS；供应商响应不改写，失败计入额度 |
| 真实供应商 streamingChat | PASS；供应商响应不改写，失败计入额度 |
| 真实供应商 structuredExplanation | BLOCKED；供应商响应不改写，失败计入额度 |
| 真实基础设施/模型 | 见各 attempt/real-services.json；原入口、隔离 MySQL/Redis/Chroma、真实权重 |
| 受控并发 | controlled-worker-concurrency/results.json；不能冒充真实参与者 |
| 人工 UI | 见 observation 与截图；只有实际参与者的决定才计入 |
| 资源保全 | runtime 保留数据库/向量/账号；objects.json 与 extra-http 文件仅列本轮对象 |

## 原五图

得分为未校准 softmax，不是患病概率；样本来自训练目录，不计算临床准确率。

| 样本 | 参考标签集合 | top-1 | 得分 | 质量 | 标签不符 |
|---|---|---|---|---|---|
| 1_left.jpg | normal | normal | 45.4279 | REVIEW | False |
| 2_left.jpg | diabetes + other | normal | 36.6712 | REVIEW | True |
| 13_left.jpg | myopia | myopia | 63.6765 | REVIEW | False |
| 30_left.jpg | glaucoma + other | normal | 38.6865 | REVIEW | True |
| 0_left.jpg | cataract | cataract | 87.6719 | REVIEW | False |

## AC-01～AC-22

| AC | 原要求 | 当前边界 | 证据层 | 结果 | 来源与限制 |
|---|---|---|---|---|---|
| AC-01 | 聊天和上传分别发起任务，均经同一工作流服务；同幂等请求只返回同一任务，页面查询不触发新推理。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-02 | 无登录、跨用户会话、跨用户任务、跨用户审批和越权工具调用均被拒绝；不能靠传入 userId 扩权。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-03 | 当前会话第二轮能使用已提供信息；另一会话的症状不自动进入本次病例，历史查询显示可追溯来源。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-04 | 图片通过、拒绝与需质量复核分别走正确路径；质量和影像节点共享同一已提交推理包。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-05 | 缺权重、来源校验失败或推理异常不产生成功诊断；技术失败不伪装成安全拒绝或医生复核。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | controlled failure regressions; real strict weight loading | PASS | windows-web-final/web.xml；Result limited to the listed evidence layer; no clinical or production claim |
| AC-06 | 检索仅使用允许的可见性、审核状态和受控元数据；不足时至多改写一次，范围不扩大。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-07 | 来源不合格、声明校验拒绝和解释扣留均不会发布草稿；COMPLETED 与 COMPLETED_LIMITED 符合解释不变量。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-08 | 补充输入中断真实等待用户；再次提交后恢复同一交互与任务，不重复处理原输入直至循环耗尽。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-09 | 用户批准前不执行拟保存操作，拒绝后仍无写入；批准合法且内容版本匹配后只保存一次。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-10 | 重复确认、过期批准、修改内容后批准、跨用户批准和恢复后重放均不会导致非法或重复写入。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-11 | 两类医生复核执行各自的决策矩阵；自审、未领取、过期版本和不兼容决策被拒绝；用户确认不能替代复核。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-12 | 服务在任务执行中、等待用户确认和等待医生复核时分别重启；恢复后状态一致、审批仍有效且已完成结果不重复提交。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-13 | 模拟重复任务、租约失效、两个执行者竞争及重试耗尽；过期执行者不能提交，新任务恢复不复制业务路由。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real isolated MySQL with controlled model/identity and fault branches | PASS | controlled-worker-concurrency/results.json；Result limited to the listed evidence layer; no clinical or production claim |
| AC-14 | 实际 SSE 可展示响应和任务事件；断连重连后可从服务端恢复状态，正常结束与错误不会留下虚假的完成界面。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-15 | 原业务与 Agent 接口契约回归覆盖 HTTP/SSE 真实响应、分页、字段类型、Long/日期格式、权限及旧同步诊断行为。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | controlled HTTP contract regressions plus real login/ID/upload seams | BLOCKED | windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-16 | 使用真实 .doc 和包含有效表格内容的 .docx，经上传、抽取、入库、embedding 和检索得到有效内容；明确区分空文档与解析失败。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real COS/embedding/Chroma DOC and DOCX; controlled invalid/empty files | PASS | *-extra-http.json; windows-web-final/web.xml；Result limited to the listed evidence layer; no clinical or production claim |
| AC-17 | 真实 MySQL 验证事务、版本冲突、租约与受影响行数语义；不能用 SQLite 通过替代这些验证。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real MySQL lease/fencing/version/transaction regression, controlled model | PASS | controlled-worker-concurrency/results.json；Result limited to the listed evidence layer; no clinical or production claim |
| AC-18 | 真实 Chroma 与 embedding 验证写入、检索、访问范围和引用；过渡阶段额外验证旧 Java 读端兼容。 | ADR 0001 and 2026-10-17 plan supersede JVM requirements; Windows direct API/CORS scope, no production release | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-19 | 真实 Java 会话服务验证登录、登出、鉴权转发和失效；数据库升级后 Java 仍能启动，Nginx 无端口冲突或代理回环。 | ADR 0001 and 2026-10-17 plan supersede JVM requirements; Windows direct API/CORS scope, no production release | Python Cookie/Redis replacement; old Java results remain historical | PASS | */real-services.json；Result limited to the listed evidence layer; no clinical or production claim |
| AC-20 | 从文档可复现启动、健康检查、逐项切流和回退；回退不遗失已创建任务或审批，也不让两套服务同时执行同一任务。 | ADR 0001 and 2026-10-17 plan supersede JVM requirements; Windows direct API/CORS scope, no production release | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-21 | 前端端到端覆盖上传、聊天绑定任务、拒绝/批准保存、补充说明、医生复核和刷新恢复；必要改动通过类型检查与构建。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |
| AC-22 | 实现具有生产可调用的图注册、任务执行器和完整任务终态；只有单元测试中的图能够运行不算通过。 | Original business requirement; rare/abnormal branches use separately labelled controlled regression | real partial HTTP/model evidence + controlled regression; human closure pending | BLOCKED | */real-services.json; *-observation.json; windows-web-final/web.xml；Real structured explanation, actual human decisions, or full scenario closure remains unproven |

## 恢复

保留相同 runId；先检查 8080/5173 端口。仅从主检出 .env 读取供应商凭据，另在进程环境提供本机无库名 MySQL admin URL。

```powershell
algorithm/.venv-model-acceptance/Scripts/python.exe scripts/accept_python_migration.py --run-id 20261017T-windows-01 --phase manual --manual-seconds 1200
```

不要自动重试已阻塞的真实解释调用，不自动批准复核/资料审核/保存，不清空数据或调用计数。

Linux、临床效果、生产发布、合并和推送不属于本轮通过声明。
