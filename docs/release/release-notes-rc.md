# Iris Release Candidate · 发布说明（草案）

> 本文件随候选分支 `integration/iris-release-candidate` 维护。
> **不是正式 Release Notes**：正式发版、合并 `ui`/`master`、打 tag、创建 GitHub Release、
> 部署与生产开关变更，均需 owner 批准后另行执行。

## 1. 候选标识

| 项 | 值 |
|---|---|
| 分支 | `integration/iris-release-candidate` |
| 基线 | `origin/ui@1ff9c71c`（PR #118 合并后的 ui tip） |
| 建议版本号 | `v1.1.0-rc.1`（在 `release/v1.0.0@5ac742f0` 之后，不复用旧分支、不重写旧 tag） |
| 数据库迁移 | V28（**相对基线无新增迁移**） |
| UI 冻结 tag | `iris-ui-v2.1-freeze-20261115` = `80f53f7f`（本地与远端均未移动） |

## 2. 本版本包含什么

### 2.1 诊断 Agent 正确性（PR #111，R3）

- **工具状态族收口**：服务端唯一词表 `running / succeeded / failed / cancelled / awaiting-confirm`，
  由 `ToolStepContract` 定义并同时驱动 SSE、前端状态与落库。
- **工具结果闭环**：工具成功时正文（脱敏 + 32k 截断）与结构化资源随终态帧下发，
  并持久化到会话历史，刷新后可恢复。
- **时间契约**：所有消息时间戳统一为带时区偏移的 ISO-8601（`TimeFormats`），
  历史与实时消息不再出现时区错位。
- **脱敏**：推理正文、工具参数、工具输出、确认文案四个出口统一过 `SensitiveDataRedactor`。
- **外域图片保护**：前端只加载受控来源的影像，防止会话内的远程图片绕过授权。
- **结构化知识来源**：知识库检索结果与模型片段的分数语义分开呈现。

### 2.2 Agent 运行时护栏（PR #112）

- **工具调用预算**：`ToolCallBudgetInterceptor` 按单次运行隔离，超预算时不再执行工具，
  且记录为**失败**终态（不是假成功），模型据此收尾。
- **图递归上限**：`CompileConfig.modelCallLimit` 接线到配置项，默认值可控。
- 框架默认的无限循环不再被当作「已有保护」。

### 2.3 工具失败语义修复（本轮新修，P0）

Spring AI Alibaba 1.1.2.2 的 `AgentToolNode#executeSyncTool` 对 `ToolExecutionException`
走 `processor.process()` 分支，默认 `alwaysThrow=false` → 返回字符串 →
`ToolCallResponse.of(...)`，`status` 为空 ⇒ `isError()==false`。结果是**真实工具失败被记成成功**。

修法（两层，缺一不可）：

1. `toolExecutionExceptionProcessor(new DefaultToolExecutionExceptionProcessor(true))`
   让异常先逃出框架的工具执行节点；
2. 最外层 `ToolFailureBoundaryInterceptor` 把逃逸异常转成 `ToolCallResponse.error(...)`。

效果：失败不再被记成 success，会话也不会因异常中断而断流。

### 2.4 前端状态恢复（本轮新修，P1）

`agentSteps.ts` 的 `streaming` 是页面级状态，新回合开始时会把**旧回合**里未完成的工具步骤
重新显示成「执行中」。修复后只有「排在最后、且后面再没有消息」的过程块才可能保留 running。

### 2.5 系统状态与错误恢复（PR #101，R2）

- 安全重定向、死代码清理；
- 系统状态页与错误恢复体验精修；
- 新增 CI 门禁 `web-e2e-system-states`：14 条 Playwright 浏览器契约
  （认证表单 + 资讯错误恢复，全部用 `page.route` 注入合成故障，不需要后端）。

### 2.6 工程清理

| 项 | 内容 |
|---|---|
| 依赖 | 移除未使用的 `caffeine` |
| 配置 | 移除三组无消费者的配置键（`inference.hash-algorithm`、`rag.evaluation.enabled`、chroma `tenant-name`/`database-name`） |
| 注释 | 删除 16 处从未填写的 `@Description TODO` 占位 |
| 脚本 | 删除一次性 GitHub 门面脚本与截图；停止跟踪 `skills-lock.json` |
| 新增脚本 | `scripts/worktree-hygiene.sh`（`report`/`reap`/`branches`，默认只读）、`scripts/dev-servers.sh`（`list`/`stop`） |
| 文档 | 安全遗留治理计划、考古清理台账、UI 冻结例外登记、本组发版文档 |

## 3. 默认关闭的能力（本版本未改变）

| 能力 | 配置键 | 默认值 |
|---|---|---|
| 多 Agent 协作 | `eye-diagnosis.collaboration.*` | 全部 `false` |
| 协作前端入口 | `VITE_COLLABORATION_ENABLED` | 未设置（入口不出现） |
| 医生正式复核写入 | 复核门禁 | 保持关闭策略 |
| 患者草稿校验 | `patient-draft-test` | 仅管理员 + 显式开启 |
| 知识库来源筛选 | `eye-diagnosis.rag.source-type.enabled` | `false`（开启只会**收窄**可见集合） |
| 内置语料播种 | `eye-diagnosis.rag.corpus.seed-enabled` | `false` |

## 4. 已知限制

1. **真实临床能力未验证**：本轮只做工程验证。工具失败、超时、取消的语义已按真实执行路径修复，
   但未在真实临床数据上做疗效或安全性评估。
2. **跨功能真实链路**：SSE 断流、跨用户隔离等链路的验证状态以
   `verification-matrix.md` 与 `release-candidate-readiness.md` 为准，不在此处重复声明。
3. **`frontend/`（Vue）已弃用**：本版本不含 Vue 前端任何变更，也不作为设计参考。
4. **冻结范围内不做视觉迭代**：首页/品牌层、管理端、知识库、新闻工作台保持冻结基线外观。

## 5. 升级注意

见 `upgrade-rollback-manual.md`。相对基线**无新增 Flyway 迁移**，升级不需要执行数据库变更。
