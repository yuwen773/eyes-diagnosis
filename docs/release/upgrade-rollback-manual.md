# 升级与回滚手册（Release Candidate）

> 适用对象：本候选分支 `integration/iris-release-candidate` 的审批者、部署执行人。
> **本手册不授权任何部署动作**；正式发版、部署与生产开关变更需 owner 批准。

## 1. 升级前核对

| 项 | 要求 |
|---|---|
| 候选 SHA | 与 `release-candidate-readiness.md` 记录的 HEAD 一致，不得用其他分支或旧 SHA |
| 数据库 | 相对基线 `origin/ui@1ff9c71c` **无新增 Flyway 迁移**（当前 head 仍是 `V28__agent_tool_audit.sql`） |
| JDK | 21（本机 `C:\Users\yuwen\.jdks\corretto-21.0.7`） |
| 前端产物 | `web/` 构建产物；`VITE_COLLABORATION_ENABLED` 未设置或非 `true` |
| 冻结 tag | `iris-ui-v2.1-freeze-20261115` 指向 `80f53f7f`（不要移动它） |

## 2. 升级步骤（供审批后执行，本轮不执行）

1. **备份数据库**（即使无迁移也要备份，回滚依赖它）：
   `mysqldump --single-transaction --routines --triggers diagnosis > diagnosis_$(date +%Y%m%d%H%M).sql`
2. **备份当前部署产物**（jar 与前端静态目录各留一份 `.bak`，命名带时间戳）。
3. 构建：
   - 后端 `mvn -DskipTests package`
   - 前端 `npm --prefix web ci && npm --prefix web run build`
4. 停服务 → 替换产物 → 起服务。
5. **冒烟**（必须逐项留证据，不要只看进程活着）：
   - `GET /actuator/health`（或现有健康端点）返回 UP；
   - 登录 → 进入 Agent 页 → 发一条会命中知识库工具的提问 → 确认工具步骤状态从 `running`
     收敛到 `succeeded`；
   - 触发一次工具失败（例如断网或错误参数）→ 确认步骤显示 `failed` 而**不是**成功，
     且对话仍能继续；
   - 刷新页面 → 确认历史回合的工具步骤状态与刷新前一致，**旧回合不显示「执行中」**；
   - 上传影像 → 确认资源面板能恢复该影像；
   - 确认协作入口**没有**出现（默认关闭）。

## 3. 回滚

### 3.1 代码回滚（首选）

1. 停服务；
2. 恢复第 2 步备份的 jar 与前端静态目录；
3. 起服务，重复 §2.5 的前两项冒烟。

本次**无数据库迁移**，代码回滚不需要回滚 schema。

### 3.2 数据库回滚（仅当出现计划外 schema 变更时）

> 本版本不应出现此类情况。如果出现，说明实际部署的产物与候选 SHA 不一致，
> **先停手并核查**，不要直接导入备份。

1. 停服务；
2. 用第 1 步的 dump 恢复到**新库**，核对表结构与行数；
3. 切换连接串到新库并验证；
4. 确认无误后再考虑清理旧库（不要直接覆盖）。

`V28` 之后的任何删除迁移都会被 Flyway 视为「已应用迁移缺失」而拒绝启动——
遇到这种情况不要改 `flyway_schema_history`，回滚到正确产物即可。

### 3.3 前端回滚

静态产物整体替换即可，无持久化状态。**注意**：前端本地缓存（会话列表）可能与旧后端字段不兼容，
回滚后建议让受影响的用户重新登录或刷新会话列表。

## 4. 不可逆操作清单

| 操作 | 是否可逆 | 说明 |
|---|---|---|
| 替换 jar / 静态产物 | 可逆（有 `.bak`） | |
| `mysqldump` 备份 | — | 只用 `--single-transaction`，不锁表 |
| 生产开关改为开启 | 需人工再审 | 协作、医生复核写入、患者草稿校验均属此类 |
| 删除工作树 / 分支 | 不可逆 | 本轮不执行；见 `scripts/worktree-hygiene.sh`（默认只读） |
| 移动冻结 tag | 不可逆且禁止 | |

## 5. 升级后必须观察

- 日志中 `AgentController` 的匿名化请求行（`requestId` + `userIdHash`）是否出现异常峰值；
- 工具失败率是否异常升高（说明 P0 修复把此前被吞掉的失败暴露出来了，属于**预期行为**，
  应核对是否为真实的依赖故障）；
- SSE 连接是否有异常断流。

## 6. 关联文档

- `release-notes-rc.md` — 本版本内容与已知限制
- `verification-matrix.md` — 每条结论绑定的 SHA 与命令
- `release-candidate-readiness.md` — 终态判定与未关闭门禁
- `docs/architecture/migration-matrix.md` — 各目标库的升级路径
