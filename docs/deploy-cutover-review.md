# 工单 20 双轴审查

用户确认基线：`cba53519098d6942626eda060883a2bb4f009db5`。审查限定本票增量；
原有 CLAUDE.md、frontend/.omc 删除及其他未跟踪迁移设计不纳入提交。
首次审查使用 `git diff --cached cba5351`，由两个独立只读子代理执行；正式提交后可用
`git diff cba5351...HEAD` 复查同一增量。
Spec 来源为用户指定工单 `.scratch/python-agent-migration/issues/20-deploy-cutover-rollback.md`
及依赖工单 19 的验收边界；没有修改、删除或发布源 spec。

## Standards

0 项。未发现明确仓库标准违规或需要修改的基线代码气味。Java 源码/构建、会话权威
与用户保存授权边界均保留；手册明确区分工程演练、真实模型与生产验收。
审查不把尚在运行的验证当成已通过。

## Spec

0 项可操作问题。代码及手册覆盖工程范围；工单 19 的真实 embedding 与 Java Long
检索阻塞保留。SSE 同源修正直接服务“前端……聊天经过 Nginx 实测”。
恢复 URI 保留 Python 工作流/复核/补充与查询；pause 拒写、drain 禁新建并保留
既有审批。手册要求先停旧执行器、限定 Python 分段、保留租约及 fencing。
模型、临床、生产发布、生产热切流和真实旧执行器交接均单独标为未验。

合计：Standards 0 项，Spec 0 项；两轴均无未关闭问题。

## 验证与边界

机器可读结果：`.scratch/python-agent-migration/evidence/issue20/local/results.json`，
回归结果：`.scratch/python-agent-migration/evidence/issue20/regression.json`。
完整源码/前端摘要与三个浏览器截图随结果保留；
私有日志只留在忽略的 baseline-runtime 中。

Nginx、MySQL/Flyway、Redis、Chroma、原 Java 会话、TCP API 与独立 Worker 为真实
进程；分类、LLM、COS、embedding 为明确标识的确定性适配器。
工程 gate 与最终总状态分开；受控模型演练的总结果仍是 BLOCKED/退出 2。
旧 Java Long 检索缺陷保持原样，不通过改小用户 ID 或修改 Java 掩盖。

2026-10-15 最终结果：Web 全量 **731 passed、24 skipped**，544.14 秒；前端全量
12 文件 **47 passed**，构建与 TypeScript 检查通过（保留既有 chunk-size 提示）。
4 个 Python 文件 mypy（含未标注函数体）通过，133 个安装依赖一致性通过。
另行执行的真实 MySQL 并发 **14 passed**、人工等待重启 **12 passed**；全量套件中
未启用的可选集成用例仍计 skipped，不冒充通过。
Nginx 1.28.0 + 真实 MySQL 8.0.26/Redis/Chroma/Java/API/Worker 的四个工程 gate
均 PASS；浏览器为无网络 mock 的 headless Chromium。
4 类人工等待的前后快照摘要相同，实际运行的源码/前端 manifest 与当前文件全部一致。
最终总结果为 BLOCKED，保留工单 19 依赖边界。
最终证据补充复核后，两轴仍为 0 项；504 项源码/前端摘要全部匹配。

隔离切流通过重启自有 Nginx 完成；无中断热切流不在本次验证范围。原有生产/旧
Worker 未被操作，本票没有发布生产，也没有宣称真实旧执行器交接完成。
