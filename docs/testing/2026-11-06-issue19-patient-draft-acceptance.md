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

## 评审补修（2026-11-07）

PR #19 合并后的代码评审发现 4 处真实缺陷，均已修复并在隔离 MySQL 8.0.26 上回归：

| 问题 | 修复 | 回归证据 |
|---|---|---|
| 推理门禁把 Python gRPC 的 0–100 百分制概率当成 0–1，真实快照一律 `INVALID_INFERENCE` | `inference()` 量程改为 `[0,100]`，测试夹具同步改为 `70.0` | 27 例真库全绿 |
| 补证守卫只检查 `extra.citations().isEmpty()`，重复引用仍冻结出逐字节相同的证据版本 2 并触发重写 | 改为 `combined.size() == frozen.citations().size()`，新增 `duplicateOnlySupplementStopsWithoutIdenticalEvidenceVersion` | 新增用例通过 |
| `claim()` 在 `inference()` 校验前提交 RUNNING 记录并翻 `DRAFTING`，无效推理白烧运行记录 | 校验移入 claim 事务，无效时直接落 `RESTRICTED` 终态、不进入 `DRAFTING` | `changedSnapshotIdentityIsRejectedBeforeAnyProviderCall` 强化为断言 0 调用、无消息 |
| `invoke()` 吞掉 `ExecutionException` 的 cause，provider 故障无法诊断 | 记录 cause 日志（停止原因不变） | 429 替身用例仍通过 |

另补入后台 `--fix` 已应用但未计入本表的改动：null 列表元素显式校验、外层异常日志、下载文件名与 blob 释放时序、上传异常日志、`originalFile()` 单次查询、`CLAUDE.md` 迁移头 V10→V12。

- 专项回归：`ISSUE19_TEST_URL` 指向一次性 `mysql:8.0.26:3308`，`mvn -B -Dtest=PatientDraftTest test` → **27 例，0 failures，0 errors，0 skipped**；`check_surefire_skips.py ... issue19` 门禁通过；用例计数契约 26→27 同步更新到脚本、Python 门禁单测（21 例通过）和 `docs/patient-draft.md`。
- 全量后端：`mvn -B test` → 157 例，**1 error 为本地已知 `contextLoads` 必红**（`cosClient` 缺 `Access key`，与本次改动无关），其余 0 failures / 0 errors；48 skipped 为各 opt-in 套件按设计跳过。`#19` 专项 27 例在此运行中同样全绿且未跳过。
- 前端：`npm run build` 通过（仅既有大 chunk 警告）；`ControlledReferencesPage.test.ts` 4/4 通过；`check_design_doc.py` 门禁通过。
- 一次性验证容器 `issue19-verify` 用后即弃，未写入本机既有业务库。

## 使用与未覆盖范围

- 使用说明、数据发送范围及预算见 `docs/patient-draft.md`。草稿调度器默认关闭，需在获授权环境设置 `eye-diagnosis.draft.enabled=true`。
- `REVIEW_READY` 仅表示材料可供后续复核，不构成发布授权；医生复核、患者结果发布和保存分别属于后续任务。
- 未执行真实 Python、真实模型、真实参考资料领域评估、浏览器或临床验收，也未部署。
- CI 已增加 `issue19-mysql` 作业，尚未运行远端 GitHub Actions。
- 只使用本任务创建的隔离依赖，没有向本机既有业务数据库写入数据。日志和报告为被忽略的本地产物，不纳入提交。

## 迁移测试顺序隔离补修（2026-11-09）

交付核对发现 `flyway-mysql` 的两个测试类共用 `diagnosis_ci`。上传 Mapper 测试先执行时已完成迁移，空库测试随后得到 `migrationsExecuted=0`，与“必须执行全部迁移”的断言冲突。修复前在隔离 MySQL 8.0.36 上指定 `-Dsurefire.runOrder=reversealphabetical`，4 项中 1 项失败，错误为 `expected: <12> but was: <0>`。

空库测试现为每次执行创建独立的 `diagnosis_ci_empty_<UUID>` 数据库，并在 `finally` 中删除；上传 Mapper 仍使用其原有测试库。保留全部迁移数和 V12 断言，没有清空共享库或放宽断言。运行账号需在隔离测试实例上具备 `diagnosis_ci_empty_%` 数据库的建库、迁移和删除权限；CI 仅在该作业的一次性 MySQL 服务内授予此权限。CI 增加 `alphabetical` / `reversealphabetical` 两组矩阵，分别执行两套测试和零跳过门禁。

修复基于本地提交 `d66c66f70579735cc87be3bb77e77f4047211409`，本节结果对应其工作区补丁，使用规定的 JDK 21：

| 检查 | 本轮实际结果 |
|---|---|
| 反向顺序：`FlywayMySqlIntegrationTest,UploadTaskMapperMySqlIntegrationTest` | 4 项通过，0 failures / errors / skipped；`flyway` 报告门禁通过 |
| 正向顺序：上述两套测试与 `PatientDraftTest` 合跑 | 31 项通过，0 failures / errors / skipped；`flyway`、`issue19` 两个报告门禁通过 |
| 数据库清理 | 两轮执行后均无遗留的 `diagnosis_ci_empty_%` 数据库 |
| 设计、steering、概率量纲门禁 | 全部通过 |
| Python 报告及文档门禁单测 | 31 项通过 |
| 工作流 YAML | 解析通过，包含两组执行顺序 |

日志和 XML 保存在被忽略的 `tmp/issue19-fix-20261109/`。修复前的失败证据位于 `tmp/issue19-audit-20261109/flyway-reverse-order.log`。

此前同日核对在基线 `d66c66f` 上使用 CI profile 跑过全量后端：159 项，111 实际执行、48 按 opt-in 契约跳过，0 failures / errors，`contextLoads` 通过。本轮补丁后仅重跑上表相关套件，不将基线全量结果描述为补丁后的全量结果。

截至本轮回填，修复仍为本地工作区补丁，#18/#19 实现及后续修复尚未同步远端，新增 CI 矩阵尚未在 GitHub Actions 执行。工单本地工程验收与远端交付状态分别记录；真实 Python、真实模型、领域、浏览器及临床验收仍未执行。
