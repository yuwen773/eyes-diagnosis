# 升级与回滚手册（Release Candidate）

> 适用对象：本候选分支 `integration/iris-release-candidate` 的审批者、部署执行人。
> **本手册不授权任何部署动作**；正式发版、部署与生产开关变更需 owner 批准。
>
> 本手册按**目标库的实际迁移史**分路。不同历史下的升级动作与回滚能力不一样，
> 不存在一条适用于所有库的「恢复旧 jar 直接起服务」。

## 1. 升级前核对

| 项 | 要求 |
|---|---|
| 候选 SHA | 与 `release-candidate-readiness.md` 记录的 HEAD 一致，不得用其他分支或旧 SHA |
| 数据库 | 相对基线 `origin/ui@1ff9c71c` **无新增 Flyway 迁移**（当前 head 仍是 `V28__agent_tool_audit.sql`） |
| 目标库历史 | 先按 §2 判定属于哪一类；**从 master V17 升上来的库会实际执行 V18–V28** |
| JDK | 21（本机 `C:\Users\yuwen\.jdks\corretto-21.0.7`） |
| 前端产物 | `web/` 构建产物；`VITE_COLLABORATION_ENABLED` 未设置或非 `true` |
| 冻结 tag | `iris-ui-v2.1-freeze-20261115` 指向 `80f53f7f`（不要移动它） |

## 2. 判定目标库属于哪条路径

```sql
SELECT installed_rank, version, description, checksum, success
FROM flyway_schema_history ORDER BY installed_rank;
```

| 路径 | 识别方式 | 升级动作 |
|---|---|---|
| **A · 已在 V28** | 最高成功版本 `28` | **不执行任何迁移**；只换产物 |
| **B · master V17** | 最高成功版本 `17`，无 V10–V14 行 | 启动即按 Flyway 顺序执行 V18–V28；先做 §3.2 的全量备份 |
| **C · 旧 Java 线 / 旧 release** | history 含 `10`–`14` 等本候选不存在的版本 | **不得就地升级**：Flyway 会把这些行判为 missing 并拒绝启动。按 `docs/architecture/migration-matrix.md` §2 重建后再灌数据 |
| 迁移中途 | 最高成功版本在 `18`–`28` 之间且校验和一致 | 直接启动续跑，Flyway 只执行缺失的高版本 |
| 校验和不一致 | `Validate failed: checksum mismatch` | 停手比对脚本与 history；不得改已应用脚本、不得删 history |

## 3. 升级步骤（供审批后执行，本轮不执行）

1. **备份数据库**（无论走哪条路径都先备份，回滚依赖它）：
   `mysqldump --single-transaction --routines --triggers diagnosis > diagnosis_$(date +%Y%m%d%H%M).sql`
2. **记录升级前的基线读数**（备份时刻）：`t_user` / `t_news` / `t_diagnosis` /
   `t_agent_session` / `t_agent_message` 的行数与抽样内容，供 §4.3 数据差异核对使用。
3. **备份当前部署产物**（jar 与前端静态目录各留一份 `.bak`，命名带时间戳）。
4. 构建：
   - 后端 `mvn -DskipTests package`
   - 前端 `npm --prefix web ci && npm --prefix web run build`
5. 停服务 → 替换产物 → 起服务（路径 B 的库此时执行 V18–V28，启动日志里应有 11 条迁移）。
6. **冒烟**（必须逐项留证据，不要只看进程活着）：
   - `GET /actuator/health`（或现有健康端点）返回 UP；
   - 登录 → 进入 Agent 页 → 发一条会命中知识库工具的提问 → 确认工具步骤状态从 `running`
     收敛到 `succeeded`；
   - 触发一次工具失败（例如断网或错误参数）→ 确认步骤显示 `failed` 而**不是**成功，
     且对话仍能继续；
   - 刷新页面 → 确认历史回合的工具步骤状态与刷新前一致，**旧回合不显示「执行中」**；
   - 上传影像 → 确认资源面板能恢复该影像；
   - 确认协作入口**没有**出现（默认关闭）。

## 4. 回滚

### 4.1 路径 A（库本来就在 V28）：只回滚代码

停服务 → 恢复第 3 步备份的 jar 与静态产物 → 起服务 → 重复 §3.6 前两项冒烟。
**没有 schema 变更，不需要动数据库。**

### 4.2 路径 B（从 master V17 升到 V28 之后）

两种做法，按「要不要回到 V17 的数据形态」选：

**B-1 · 只回滚代码（推荐，故障恢复时间最短）**

实测：旧 master jar（classpath 只到 V17）在 V28 库上**可以正常启动**——
V18–V28 对它是 future 迁移，Flyway 默认 `ignoreMigrationPatterns=*:future` 予以放行，
不报校验错、不执行任何迁移。V18–V28 对升级前已存在的表只有一处影响：
`V22` 给 `t_diagnosis` 加一列**可空**的 `patientTaskId`；`V23`/`V24` 的 `ALTER` 只落在
`V20` 新建的草稿表上，旧 jar 根本不碰。因此旧代码的读写路径不受影响——
用例里回滚后用旧形状的 `INSERT INTO t_diagnosis` 写入成功。

按住这一点再回滚的前提，是 §1 的记录都成立。回滚后要接受两个后果：
新表（任务/授权/协作/审计）在旧代码下不再写入；再次升级时 Flyway 从 V28 续跑，不会重放 V18–V28。

证据：`FlywayMySqlIntegrationTest#anOldMasterJarStillStartsAfterTheDatabaseWasUpgradedToV28`
（隔离 schema 真跑：V17 → V28 → 旧 jar 启动，V18–V28 状态为 `FUTURE_SUCCESS`，迁移数 0）。

**B-2 · 要回到 V17 的 schema 形态**

**不要**在生产上删表或回滚 schema。受支持的做法是**恢复备份到新库再切流**：

1. 停写（或接受切换窗口内的数据丢失，见 §4.3）；
2. 用 §3 第 1 步的 dump 恢复到**新库**（新库名，例如 `diagnosis_rollback_<时间戳>`）；
3. 核对新库结构与行数，按 §4.3 做数据差异确认；
4. 把应用连接串指向新库，启动旧 jar，验证后切流；
5. 旧库保留只读一段时间再清理，**不要直接覆盖**。

整套流程必须先在数据库副本上演练一遍（升级 + 回退两段都要跑），不要在生产上首次执行。

### 4.3 数据差异核对（B-2 专用）

切换前对着 §3 第 2 步的基线读数确认：

- `t_user`、`t_news` 的行数与抽样内容**完全一致**（这两张表升级前后都不应被改）；
- `t_diagnosis` 行数一致；新增列 `patientTaskId` 在旧备份里不存在，恢复后自然消失，符合预期；
- `t_agent_session` / `t_agent_message` 的行数差等于备份时刻到停写时刻的写入量——
  这部分会丢失，必须让业务方先确认可接受；
- V18–V28 新建的表在新库里不存在（因为恢复到的是 V17 备份），旧 jar 不依赖它们。

### 4.4 路径 C（history 含 V10–V14 等本候选不认的版本）

这类库**不能靠回滚 jar 修好**：本候选的迁移集合里没有这些版本，Flyway 会把 history 里的
V10–V14 判为 missing 并拒绝启动（实测：
`FlywayMySqlIntegrationTest#aJarRejectsAHistoryThatContainsVersionsItDoesNotResolve`）。
处置方式只有一条：按 `docs/architecture/migration-matrix.md` §2 重建，重建后灌数据。
**禁止**用 `repair`、`ignoreMigrationPatterns`、手工删 `flyway_schema_history` 行来绕过。

### 4.5 前端回滚

静态产物整体替换即可，无持久化状态。**注意**：前端本地缓存（会话列表）可能与旧后端字段不兼容，
回滚后建议让受影响的用户重新登录或刷新会话列表。

## 5. 不可逆操作清单

| 操作 | 是否可逆 | 说明 |
|---|---|---|
| 替换 jar / 静态产物 | 可逆（有 `.bak`） | |
| `mysqldump` 备份 | — | 只用 `--single-transaction`，不锁表 |
| 在生产库上执行 `DROP TABLE` / 回滚 schema | **不可逆** | 本手册不提供这种路径；回退一律走「恢复到新库 + 切流」 |
| 改 `flyway_schema_history` / `repair` 掩盖 missing | **不可逆且禁止** | |
| 生产开关改为开启 | 需人工再审 | 协作、医生复核写入、患者草稿校验均属此类 |
| 删除工作树 / 分支 | 不可逆 | 本轮不执行；见 `scripts/worktree-hygiene.sh`（默认只读） |
| 移动冻结 tag | 不可逆且禁止 | |

## 6. 升级后必须观察

- 日志中 `AgentController` 的匿名化请求行（`requestId` + `userIdHash`）是否出现异常峰值；
- 工具失败率是否异常升高（说明 P0 修复把此前被吞掉的失败暴露出来了，属于**预期行为**，
  应核对是否为真实的依赖故障）；
- SSE 连接是否有异常断流。

## 7. 关联文档

- `release-notes-rc.md` — 本版本内容与已知限制
- `verification-matrix.md` — 每条结论绑定的 SHA 与命令（含本手册引用的两条 Flyway 用例）
- `release-candidate-readiness.md` — 终态判定与未关闭门禁
- `docs/architecture/migration-matrix.md` — 各目标库的升级路径与重建口径
