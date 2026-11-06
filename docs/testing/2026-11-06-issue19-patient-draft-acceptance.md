# #19 四 Agent 患者解释草稿验证

日期：2026-11-06。范围为 Java 线的内部草稿协作，接入 #17 的推理快照和 #18 的受控证据。所有图片、模型输出、身份和参考资料均为合成测试数据；测试中的模拟审核不代表真实领域审核。

## 本地验证

| 检查 | 结果 | 证据与限制 |
|---|---|---|
| JDK 21 全量后端 `mvn clean test`，CI profile | PASS：156 例，0 failures，0 errors，17 skipped | 隔离 MySQL 8.0.36、Redis、Chroma；`tmp/issue19-full-backend.log`，报告位于 `tmp/issue19-full-reports/surefire-reports/` |
| 评审修复后的 #19 专项回归 | PASS：26 例，0 skipped | 实际 MySQL、协调入口、HTTP 安全投影、受控模型/时钟；`tmp/issue19-green-review.log`，最终报告位于 `tmp/issue19-final-reports/` |
| 规范 ID 与显式复核绑定回归的 red 阶段 | 符合预期：2 例失败 | `tmp/issue19-red-review-findings.log`；随后修复并包含在上述 26 例回归中 |
| 独立 JVM 崩溃与双执行者竞争 | PASS | JVM 在调用额度提交后终止；新实例将过期工作标为受限，不发送新调用；大小写别名不能创建第二份预算 |
| 来源撤回、引用与输出校验、反馈及总预算、超时迟到输出 | PASS | 通过公开协调入口观察持久化报告；患者接口只返回安全状态和任务 ID |
| 提供方自动重试 | PASS，替身证据 | OpenAI REST 提供方替身返回 429，只允许一次请求；未调用真实提供方。DashScope 副本采用同样的单次 RetryTemplate，未进行真实网络验证 |
| Flyway 新库迁移 | PASS，最终 V12 | 未改动已应用迁移；更新最终迁移版本断言 |
| Python 报告门禁 | PASS：21 例 | 包含 #19 报告缺失、单例跳过和用例减少的拒绝路径；专项真实报告通过零跳过门禁 |
| 未配置数据库的显式跳过 | PASS：26/26 skipped | `tmp/issue19-no-env.log`；未连接数据库，参数化用例仍完整展开；不将此运行视为业务验证通过 |
| 架构文档门禁与差异检查 | PASS | `scripts/check_design_doc.py`、`git diff --cached --check` |

全量测试在最后两项评审修复前完成；修复后重跑了包含所有受影响行为的完整 #19 专项套件。没有将未重跑的全量套件描述为修复后的全量结果。

全量中的 17 个显式跳过为 Chroma 专用集成 1 例、RAG 模型评估 2 例、协调恢复 PoC 专用 MySQL 套件 14 例；本轮 #17、#18、#19 和 Flyway/上传迁移套件均实际执行。没有把跳过项目标为通过。

## Standards

最终 0 项未解决发现。首轮 1 项 P3 判断已修复：从已校验推理一次派生受控疾病码，移除重复解析。增量只读复核未发现新问题。

## Spec

最终 0 项未解决发现。首轮 P1 规范任务 ID 预算隔离问题与 P2 Critic/草稿缺少显式审计绑定均由回归测试复现后修复；保存数据库规范任务 ID，以及每次调用的 `{context,result}` 业务信封。增量只读复核确认修复。

双轴汇总：Standards 0 项未解决；Spec 0 项未解决。

## 使用与未覆盖范围

- 使用说明、数据发送范围及预算见 `docs/patient-draft.md`。草稿调度器默认关闭，需在获授权环境设置 `eye-diagnosis.draft.enabled=true`。
- `REVIEW_READY` 仅表示材料可供后续复核，不构成发布授权；医生复核、患者结果发布和保存分别属于后续任务。
- 未执行真实 Python、真实模型、真实参考资料领域评估、浏览器或临床验收，也未部署。
- CI 已增加 `issue19-mysql` 作业，尚未运行远端 GitHub Actions。
- 只使用本任务创建的隔离依赖，没有向本机既有业务数据库写入数据。日志和报告为被忽略的本地产物，不纳入提交。
