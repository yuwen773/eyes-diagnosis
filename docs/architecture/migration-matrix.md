# Flyway 迁移矩阵（Java 线）

本文件记录 `codex/realtime-product-acceptance` 与 `master` 的迁移历史整合方式。执行任何数据库升级前，先按目标库的 `flyway_schema_history` 对照本矩阵。

## 1. 已部署基线

2026-11-13 之前，两条线各自维护了一套版本号：

| 版本 | master 基线（生产/主线） | Java 线原迁移 | 整合后 |
| --- | --- | --- | --- |
| V1–V9 | 既有安全/缓存/MCP 迁移 | 相同 | 不变 |
| V10 | 无 | `V10__diagnosis_task.sql` | `V18__diagnosis_task.sql` |
| V11 | 无 | `V11__controlled_reference.sql` | `V19__controlled_reference.sql` |
| V12 | 无 | `V12__patient_draft.sql` | `V20__patient_draft.sql` |
| V13 | 无 | `V13__doctor_review.sql` | `V21__doctor_review.sql` |
| V14 | 无 | `V14__patient_authorization.sql` | `V22__patient_authorization.sql` |
| V15 | `V15__baseline_legacy_tables.sql` | `V15__bootstrap_user_table.sql`（未跟踪） | 采用 master V15；删除重复 bootstrap |
| V16 | `V16__diagnosis_evidence_and_audit.sql` | `V16__patient_draft_message_timing.sql` | 采用 master V16；Java 线重排为 V23 |
| V17 | `V17__news_business_model.sql` | `V17__autonomous_draft_workflow.sql` | 采用 master V17；Java 线重排为 V24 |
| V18 | 无 | `V18__collaboration_events.sql` | `V25__collaboration_events.sql` |
| V19 | 无 | `V19__graph_execution.sql` | `V26__graph_execution.sql` |
| V20 | 无 | `V20__bootstrap_agent_history.sql` | `V27__bootstrap_agent_history.sql` |
| V28 | 无 | 无 | `V28__agent_tool_audit.sql`（普通聊天工具调用结构化审计，默认关闭持久化） |
| V29 | 无 | 无 | `V29__knowledge_index_version.sql`（`t_knowledge_document` 增加可空 `indexVersion`，标记一次文档处理的服务端 UUID） |

整合后的唯一链为 **V1–V9 + V15–V27**，其后追加 **V28、V29**。目录里不再存在同号迁移。
V28 只新增 `t_agent_tool_audit`，不修改此前任何已应用脚本；该表独立于 `t_agent_message`，
不存原始工具参数、Prompt 或患者文本。V29 只给既有表加一列可空列，不改写任何既有行；
历史行的 `indexVersion` 为 NULL，**在按版本准入的检索里等于「不能证明处理完整」**，
必须重新处理后才可能重新成为证据（见 `docs/release/upgrade-rollback-manual.md` §2）。

## 2. 目标库 → 动作

| 目标库状态 | 识别方式 | 动作 |
| --- | --- | --- |
| 空库 | 无 `flyway_schema_history` | 正常启动，Flyway 顺序执行 V1–V9、V15–V29；等价于 `FlywayMySqlIntegrationTest#migratesAnEmptyMySqlDatabaseThroughTheCurrentSafetySchema` |
| master 生产/主线库 | history 最高版本 V17，V15–V17 checksum 与 master 一致 | 直接启动，追加执行 V18–V29；V15 的 `CREATE TABLE IF NOT EXISTS` 不会改动既有 `t_user`；等价于 `#preservesExistingAccountsWhenUpgradingFromMasterV17` |
| Java 线旧开发库 | history 含 V10–V20，且 V10–V14 的 checksum 对应原脚本 | **重建**。这些库不在生产序列；旧文件已从 `db/migration` 移出，Flyway 会把 V10–V14 判为 missing。不要用 `repair`/`ignoreMigrationPatterns` 掩盖，按 `db/migration` 全量重建后再灌测试数据 |
| 迁移中途库 | history 最高版本在 V18–V29 之间且校验和一致 | 直接启动续跑；Flyway 只执行缺失的高版本 |
| `flyway_schema_history` 校验和不一致 | `Validate failed: checksum mismatch` | 停止发布，先比对实际脚本与 history；不得修改已应用脚本或删除 history 强行通过 |

`spring.flyway.out-of-order` 必须保持 `false`。本整合方案不依赖 out-of-order，也不允许把它当作跳过版本缺口的开关。

### 2.1 回滚方向（谁能在什么库上起服务）

上表只讲「往前走」，回滚方向单独有两条实测结论（隔离 MySQL schema 上真跑，
见 `FlywayMySqlIntegrationTest`）：

| 库的 history | 更旧的 jar（只认到 V17）能否直接启动 | 依据 |
| --- | --- | --- |
| 升到 V29 之后（master V17 线上来的） | **能启动**。V18–V29 对它记为 `FUTURE_SUCCESS`，Flyway 默认 `ignoreMigrationPatterns=*:future` 放行，迁移数 0；对既有表只有 V22 加的一列可空 `patientTaskId` 与 V29 的一列可空 `indexVersion` | `#oldMigrationSetAcceptsFutureVersionsWithoutCertifyingArtifactSafety` |
| history 里含本 jar 解析不了、且低于其已知最高版本的版本（如旧 release 线 V10–V14） | **不能**。Flyway 判 missing 并拒绝启动 | `#aJarRejectsAHistoryThatContainsVersionsItDoesNotResolve` |

> 该用例的名字是刻意写成的：它只证明**迁移解析**对 future 版本放行，
> **不证明旧产物安全**。第二轮独立审查用真实旧 JAR 实测确认，旧 master 产物能启动，
> 但会恢复正式复核写入与推理输出等不安全行为——所以它不能作为回退候选（见
> `docs/release/upgrade-rollback-manual.md` §1、§5）。

所以「代码回滚」在 master V17 升上来的库上**技术上**可行（新表在旧代码下不再写入），
但这**不等于允许切过去**：旧 master 产物会恢复不安全的正式复核写入与推理输出
（§2.1 上表注解）。**要回到 V17 的 schema 形态**只能恢复到升级前备份的新库并切流；
路径与演练要求见 `docs/release/upgrade-rollback-manual.md` §4。V10–V14 这类历史不提供回滚路径，只能重建。

## 3. 发布前检查

1. 导出目标库 history：
   ```sql
   SELECT installed_rank, version, description, type, checksum, success
   FROM flyway_schema_history ORDER BY installed_rank;
   ```
2. 确认最高版本与上表一致；`success=0` 的行必须先人工处理。
3. 确认目标库 `t_user` 的实际列；master V15 只做 `CREATE TABLE IF NOT EXISTS`，不会补齐旧表缺列。
4. 在数据库副本上先跑一次迁移，核对：
   - `flyway_schema_history` 只追加，不重写既有行；
   - 协作相关表存在：`t_diagnosis_task`、`t_controlled_reference`、`t_patient_draft_run`、`t_patient_draft_message`、`t_doctor_review`、`t_patient_authorization`、`t_collaboration_event`、`t_graph_execution`；
   - 既有 `t_user` / `t_news` 行数与抽样内容不变。
5. 迁移完成后再启动应用；应用侧协作总开关仍默认关闭。

## 4. 演练命令

本机 MySQL 8（3307）：

```bash
FLYWAY_TEST_URL='jdbc:mysql://127.0.0.1:3307/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC' \
FLYWAY_TEST_USERNAME=root FLYWAY_TEST_PASSWORD='<本地密码>' \
JAVA_HOME=/c/Users/yuwen/.jdks/corretto-21.0.7 \
mvn -o -B -Dtest=FlywayMySqlIntegrationTest test
```

三个用例分别覆盖：master V17 → V29、空库 → V29、V23 → V24 历史行标注不改写冻结消息。
另有两个回滚方向用例（旧迁移集合能否接受 future 版本、history 含无法解析版本时是否拒绝启动，见 §2.1）。
测试会为每次运行创建并删除独立 schema，不触碰现有库。

## 5. 约束

- 已应用迁移的内容不得修改；只能追加更高版本。
- 新迁移必须大于 V29。
- 不得删除或手工编辑 `flyway_schema_history` 来绕过冲突。
- 历史冻结脚本 `scripts/product_acceptance_inputs.py` 记录过已删除的 `V15__bootstrap_user_table.sql` 作为 `additionalDependency`；该字段只描述 2026-11-12 的输入快照，不参与当前迁移链。重新封存验收证据时应改为引用 master V15，而不是恢复旧文件。
