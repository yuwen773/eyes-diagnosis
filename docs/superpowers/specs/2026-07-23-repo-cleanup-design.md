# 2026-07-23 Eye-Diagnosis 仓库深度整理 — 设计文档

## 背景与目标

eye-diagnosis 仓库经多阶段迭代后处于"能用但杂乱"状态，存在三类风险：P0 安全问题（明文密码会话日志、`application-local.yml` 潜在泄露）、P1 卫生问题（filter-repo 残留目录、冗余模型权重、ESLint 87 错误）、P2 代码质量（1117 行的 LeftSidebar.vue、285 行的 UserController 等超大文件）。本次整理目标：在不动业务逻辑与 API 契约的前提下，将仓库提升至"可维护、可审查、可演进"状态，并为后续测试补全留出空间。

## 范围

| 优先级 | 覆盖项 |
|--------|--------|
| **P0 安全** | 删除含明文密码的会话日志；`.gitignore` 排除 `application-local.yml` / `application-dev.yml`；删除 `frontend/2026-04-30-151157-202634.txt` |
| **P1 卫生** | 完善 `.gitignore`（`.git-rewrite/`、中文文件名、`__pycache__/`、proto 生成件）；删除冗余 `.pth` 模型权重；配置 `.gitattributes` Git LFS；删除已 D 的 `banner3.png` / `img.png`；移除已入仓的 `__pycache__/` |
| **P2 代码质量** | 修复 SSE 事件命名不一致（`tool-confirm` ↔ `mcp-confirm`）；显式声明 `@ant-design/icons-vue` 依赖；ESLint 未使用 import/变量清零；拆分 LeftSidebar(1117) / NewsDetailPage(933) / AgentMessageList(915)；拆分 UserController(285) / AgentController(206)；补 Mockito 单元测试骨架；修复 DiagnosisController 删除接口路径前缀 bug；确认 `DiagnosisGrpcClient` 由 Spring 托管 |

## 非目标

- **业务逻辑**：诊断算法、Agent 推理逻辑、UI 交互流程不变
- **API 契约**：所有 REST 路径、请求/响应字段、SSE 事件 schema 保持兼容
- **数据库 Schema**：`schema.sql` 与 MyBatis 实体映射不调整
- **git 历史重写**：已跟踪的敏感文件（如历史 `application-local.yml`）仅"删除 + 防未来提交"，不动 `master` 历史
- **前端路由**：Vue Router 配置不调整
- **TypeScript 严格性升级**：保留 `any` / `ts-ignore` 待后续重构

## 安全考量

- **明文密码**：`frontend/2026-04-30-151157-202634.txt` 含 `root/123456`，删除前提醒用户确认该密码是否仅本地开发使用；若是真实凭据需在合并前轮换
- **`application-local.yml`**：通过 `.gitignore` 阻止未来提交，但已跟踪的文件不重写历史；如需清理，提示用户手动执行 `git filter-repo`
- **`application-server.yml`**：已在上次 commit `522ffdf` 中脱敏并改用模板，本计划不动
- **LFS 配置**：`.pth` / `.pt` / `.pb` 配置 Git LFS 仅对未来新文件生效，不追溯已入库文件

## 关键命名约定

SSE 事件类型统一为 `tool-confirm`（对应后端枚举 `MessageType.TOOL_CONFIRM`）。前端 `useAgentStream.ts` 同时处理 `tool-confirm` 与历史遗留的 `mcp-confirm`，通过 OR 分支兼容两路事件，确保旧客户端不受影响。后续 Task 10 修复完成后，新代码统一使用 `tool-confirm`。

## 风险与回滚策略

| 风险 | 回滚方式 |
|------|----------|
| 删除会话日志导致审计数据丢失 | Task 4 前备份非敏感片段 |
| 删除冗余 `.pth` 后需分别管理 | Task 6 前用 `md5sum` 确认两份完全相同 |
| icons-vue 显式声明版本与传递版本冲突 | Task 11 前备份 `package-lock.json` |
| 拆 Vue 组件影响范围大 | Task 16-18 独立 commit，可单独 `git revert` |
| 拆 Controller 内部包路径变化 | Task 19-20 保持 API 路径不变，仅调整包结构 |
| Spring 托管注解缺失导致 gRPC 客户端未注入 | Task 14 编译验证通过 |

每个 Task 一个原子 commit，整体计划执行期间任何失败可逐 Task 回滚，不影响 master 主线。

## 验收标准

| 类别 | 标准 |
|------|------|
| **安全** | 仓库无明文密码文件；`application-local.yml` 与 `application-dev.yml` 被 `.gitignore` 阻止未来提交 |
| **卫生** | `.git-rewrite/` 已删除；临时文件清理；`.pth` LFS 配置就位；`__pycache__/` 被忽略 |
| **依赖** | `@ant-design/icons-vue` 显式声明在 `package.json`；ESLint 错误从 87 降至 ≤30 |
| **代码** | SSE 事件命名统一为 `tool-confirm`；LeftSidebar/NewsDetailPage/AgentMessageList 拆完（主组件 ≤200 行，子组件 ≤250 行）；UserController/AgentController 拆完 |
| **测试** | User/Diagnosis/Agent 服务层有 Mockito 单元测试骨架且通过 |
| **构建** | `mvn compile` + `npm run build` 通过 |
| **Git** | 全部清理项单独 commit；历史未重写；最终 `git status` 干净 |