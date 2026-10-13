# 工单 02 双轴审查记录

日期：2026-10-13。审查起点：`0a098db194664bf1e481fd57a1dee2af89b37989`。
审查范围为本票暂存实现；源 spec、原 Java 源码和原构建配置不在修改范围内。
按 `/code-review` 分别由 Standards 与 Spec 两位只读审查者检查，并在修复后复审。

## Standards

初审发现一项 P2：幂等重放响应可能把 MySQL REPEATABLE READ 的旧 Workflow
快照与加锁读取的最新上传进度混合，导致同一响应的版本和状态不一致。

已修复：重放响应先用 `db.refresh(existing, with_for_update=True)` 刷新并锁定
Workflow，再读取上传输入，锁顺序与 Worker 提交一致。真实验收新增 Worker
提交期间重复 POST 的响应一致性检查，已通过。

复审：无遗留可操作问题。审查者独立从仓库根目录执行工作流测试，8 项通过。
确认 Python Worker 只领取 `python-graph` 队列，保留旧运行时任务的归属；
现有结构契约只增补本票两个接口和六个 ORM 表。

## Spec

复审：无遗留问题。确认注册图决定后继路由、MySQL checkpoint 可跨进程恢复、
幂等重放读取一致、Python 队列归属明确，上传页在 Web 与浏览器重建后查询原任务。
审查者独立执行工作流测试，8 项通过。

真实链路 11 项由主执行者运行并归档，审查者未独立重跑该环境。
结果见 [真实检查结果](issue02-live-results.json) 和
[上传页截图](issue02-restored.png)；测试层次、依赖、迁移及未验收范围见
[实现与验证报告](../durable-upload-workflow.md)。

## 结论

两个审查轴均无遗留发现。本票实现上传任务的持久执行最小闭环；有效图片在
完成验证后进入明确的 `DIAGNOSIS_NOT_AVAILABLE` 终态，不产生伪造模型结果，
不新增正式诊断记录。真实模型、完整并发故障矩阵和生产切流仍属于后续验收。
