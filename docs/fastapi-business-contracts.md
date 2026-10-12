# 当前 FastAPI 业务 API 契约清单

日期：2026-10-12。来自本票当前 `create_app().openapi()` 与路由的权限依赖；与 Java Controller 方法/路径集合的对账由 `test_contracts.py::test_endpoint_set_matches_java_exactly` 执行。排除三个 Java 会话端点、Agent 和健康探针。

所有业务操作使用 `{code,msg,data}`，成功 `code=0,msg="ok"`，业务错误仍 HTTP 200。序列化、分页、诊断与偏差详情见 [fastapi-baseline.md](fastapi-baseline.md) 和 [migration-decisions.md](migration-decisions.md)。

| 方法 | 路径 | 权限 | 请求 | 响应 data |
|---|---|---|---|---|
| POST | `/api/user/register` | 公开 | application/json | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/user/add` | 管理员 | application/json | 业务 VO/布尔/ID（见源 schema） |
| GET | `/api/user/get` | 管理员 | 无 body; query: id | 业务 VO/布尔/ID（见源 schema） |
| GET | `/api/user/get/vo` | 管理员 | 无 body; query: id | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/user/update` | 管理员 | application/json | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/user/list/page/vo` | 管理员 | application/json | 分页 records + 四个 Long 字符串 |
| POST | `/api/user/list/page/vo/cache` | 管理员 | application/json | 分页 records + 四个 Long 字符串 |
| POST | `/api/user/delete/{id}` | 管理员 | 无 body; path: id | 布尔（失败见业务码） |
| POST | `/api/user/update/userCenter` | 登录用户 | application/json | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/user/upload/avatar` | 登录用户 | multipart/form-data | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/user/diagnosis/reexamine` | 登录用户 | application/json | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/diagnosis/upload` | 登录用户 | multipart/form-data | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/diagnosis/list/page/vo` | 登录用户 | application/json | 分页 records + 四个 Long 字符串 |
| POST | `/api/diagnosis/list/page/vo/cache` | 登录用户 | application/json | 分页 records + 四个 Long 字符串 |
| POST | `/api/diagnosis/list/page/my` | 登录用户 | application/json | 分页 records + 四个 Long 字符串 |
| POST | `/api/diagnosis/delete/{id}` | 管理员 | 无 body; path: id | 布尔（失败见业务码） |
| POST | `/api/diagnosis/diagnosis` | 登录用户 | multipart/form-data | 同步 DiagnosisResultVO；无权重 50000/data=null |
| GET | `/api/diagnosis/get/{id}` | 登录用户 | 无 body; path: id | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/diagnosis/update` | 管理员 | application/json | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/news/list/page/vo` | 公开 | application/json | 分页 records + 四个 Long 字符串 |
| POST | `/api/news/list/page/vo/cache` | 公开 | application/json | 分页 records + 四个 Long 字符串 |
| GET | `/api/news/get/{id}` | 公开 | 无 body; path: id | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/news/delete/{id}` | 管理员 | 无 body; path: id | 布尔（失败见业务码） |
| POST | `/api/news/uploadAttachment` | 管理员 | multipart/form-data | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/news/edit` | 管理员 | application/json | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/news/uploadCover` | 管理员 | multipart/form-data | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/knowledge/upload` | 登录用户 | multipart/form-data | 业务 VO/布尔/ID（见源 schema） |
| POST | `/api/knowledge/list/page` | 登录用户 | application/json | 分页 records + 四个 Long 字符串 |
| DELETE | `/api/knowledge/delete` | 登录用户 | application/json | 布尔（失败见业务码） |
| POST | `/api/mcp-server` | 登录用户（本人资源） | application/json | 业务 VO/布尔/ID（见源 schema） |
| PUT | `/api/mcp-server` | 登录用户（本人资源） | application/json | 业务 VO/布尔/ID（见源 schema） |
| DELETE | `/api/mcp-server/{mcpServerCode}` | 登录用户（本人资源） | 无 body; path: mcpServerCode | 布尔（失败见业务码） |
| GET | `/api/mcp-server/{mcpServerCode}` | 登录用户（本人资源） | 无 body; path: mcpServerCode, query: needTools | 业务 VO/布尔/ID（见源 schema） |
| GET | `/api/mcp-server` | 登录用户（本人资源） | 无 body; query: name, query: current, query: size | 分页 records + 四个 Long 字符串 |

本次重新计算共 **34 个 HTTP 操作**。回归比较集合而不是固定总数。

注意：权限为当前实现记录。知识库与诊断列表按服务器身份过滤；某些历史详情/复核行为的旧缺陷不能由这张权限表推断为已修复。MCP 请求使用 JSON，列表的分页字段为 query `current`/`size`；其他分页主要使用 JSON `current`/`pageSize`。上传字段 knowledge 为 `files`，其余为 `file`。
