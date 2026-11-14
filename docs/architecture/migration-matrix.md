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

整合后的唯一链为 **V1–V9 + V15–V27**，其后追加 **V28**。目录里不再存在同号迁移。V28 只新增 `t_agent_tool_audit`，不修改此前任何已应用脚本；该表独立于 `t_agent_message`，不存原始工具参数、Prompt 或患者文本。

## 2. 目标库 → 动作

| 目标库状态 | 识别方式 | 动作 |
| --- | --- | --- |
| 空库 | 无 `flyway_schema_history` | 正常启动，Flyway 顺序执行 V1–V9、V15–V28；等价于 `FlywayMySqlIntegrationTest#migratesAnEmptyMySqlDatabaseThroughTheCurrentSafetySchema` |
| master 生产/主线库 | history 最高版本 V17，V15–V17 checksum 与 master 一致 | 直接启动，追加执行 V18–V28；V15 的 `CREATE TABLE IF NOT EXISTS` 不会改动既有 `t_user`；等价于 `#preservesExistingAccountsWhenUpgradingFromMasterV17` |
| Java 线旧开发库 | history 含 V10–V20，且 V10–V14 的 checksum 对应原脚本 | **重建**。这些库不在生产序列；旧文件已从 `db/migration` 移出，Flyway 会把 V10–V14 判为 missing。不要用 `repair`/`ignoreMigrationPatterns` 掩盖，按 `db/migration` 全量重建后再灌测试数据 |
| 迁移中途库 | history 最高版本在 V18–V28 之间且校验和一致 | 直接启动续跑；Flyway 只执行缺失的高版本 |
| `flyway_schema_history` 校验和不一致 | `Validate failed: checksum mismatch` | 停止发布，先比对实际脚本与 history；不得修改已应用脚本或删除 history 强行通过 |

`spring.flyway.out-of-order` 必须保持 `false`。本整合方案不依赖 out-of-order，也不允许把它当作跳过版本缺口的开关。

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

三个用例分别覆盖：master V17 → V28、空库 → V28、V23 → V24 历史行标注不改写冻结消息。测试会为每次运行创建并删除独立 schema，不触碰现有库。

## 5. 约束

- 已应用迁移的内容不得修改；只能追加更高版本。
- 新迁移必须大于 V28。
- 不得删除或手工编辑 `flyway_schema_history` 来绕过冲突。
- 历史冻结脚本 `scripts/product_acceptance_inputs.py` 记录过已删除的 `V15__bootstrap_user_table.sql` 作为 `additionalDependency`；该字段只描述 2026-11-12 的输入快照，不参与当前迁移链。重新封存验收证据时应改为引用 master V15，而不是恢复旧文件。
