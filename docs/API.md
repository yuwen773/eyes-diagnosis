# API 参考（API.md）

> 所有接口前缀为 `/api`。下列路径均源自源码注解（RELEASE-001 抓取）。**请求需携带登录态**（`@AuthCheck`）。

## 1. 工作流（Workflow）

Base：`/api/diagnosis/workflows`（`@AuthCheck(mustRole = DEFAULT_ROLE)`，即登录用户）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/{workflowId}` | 工作流详情 |
| GET | `/{workflowId}/events` | 事件流（SSE 之外的一次性查询） |
| POST | `/{workflowId}/cancel` | 取消工作流 |
| GET | `/{workflowId}/stream` | **SSE** 事件流（produces `text/event-stream`） |

## 2. 人工复核（Review）— DOCTOR_ROLE

Base：`/api/reviews`（`@AuthCheck(mustRole = DOCTOR_ROLE)`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tasks` | 待复核任务列表 |
| POST | `/tasks/{taskId}/claim` | 认领任务 |
| POST | `/tasks/{taskId}/submit` | 提交复核决策（触发 Resume） |

## 3. 审计（Audit）— AUDITOR_ROLE（只读网关）

Base：`/api/audit`（`@AuthCheck(mustRole = AUDITOR_ROLE)`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/workflows/{workflowId}/events` | 某工作流的审计事件（append-only 查询） |

## 4. 统计（Workflow Stats）— DEFAULT_ROLE

Base：`/api/workflow/stats`（`@AuthCheck(mustRole = DEFAULT_ROLE)`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/summary` | 工作流统计汇总（WorkflowStatsSummaryVO） |

## 5. 运维端点（Actuator）

| 路径 | 说明 |
|------|------|
| `/api/actuator/health` | 健康检查（前端 nginx 反代自此判断 UP） |
| `/api/actuator/prometheus` | Prometheus 指标（workflow/segment/inference/review 四类 + review_pending_count） |

## 6. 其他业务接口（概览）

| 模块 | Base | 主要能力 |
|------|------|---------|
| 用户 | `/api/user` | 注册/登录/登出/资料/分页 |
| 诊断 | `/api/diagnosis` | 上传/列表/详情/删除(ADMIN)/复诊 |
| 智能体对话 | `/api/agent` | SSE 对话、会话管理、历史导出 |
| 知识库 | `/api/knowledge` | 上传/列表/删除（ADMIN 相关） |
| 新闻 | `/api/news` | 分页/详情/编辑(ADMIN) |
| MCP 服务 | `/api/mcp-server` | 增删查（内部集成） |

> 待补充：逐接口的 Request/Response 字段表、错误码约定、鉴权失败行为、分页参数规范。
> 提示：`UserController`/`DiagnosisController` 等遗留接口沿用旧契约，与 workflow 新体系并存。
