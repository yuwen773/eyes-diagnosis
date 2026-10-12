# Issue 01 — FastAPI 现有业务兼容基线

日期：2026-10-12，Asia/Shanghai。范围仅为 issue 01、AC-15 的现有业务部分及 AC-19 的会话/启动部分，不表示 Python Agent、真实模型、知识库迁移或整个 spec 已验收。

工作位置：`.claude/worktrees/py-rewrite`，分支 `worktree-py-rewrite`。开始版本为 `d74784ea0030f2d778ad3f2d4c402244650b5913`。本基线提交包含原来尚未保存的 `algorithm/web`、部署配置、依赖及迁移裁定；源 spec、OMC 运行状态和无关工作树改动不纳入提交。定位交付版本：`git log -1 --format=%H -- docs/fastapi-baseline.md`。

## 当前契约

按当前 FastAPI OpenAPI 和 Java Controller 的 **HTTP 方法 + 路径** 对账，得到 34 个 Python 业务操作（user 11、diagnosis 8、news 7、knowledge 3、mcp-server 5）；这是本次重新计算的结果，不以历史总数作为断言。完整清单见 [fastapi-business-contracts.md](fastapi-business-contracts.md)，对应回归 `algorithm/web/tests/test_contracts.py`。

Java 保留 `POST /api/user/login`、`GET /api/user/get/login`、`POST /api/user/logout`。本票未迁移 Agent；现有 `/api/agent/` 仍转发 Java，后续工单再切流。

| 边界 | 兼容行为 | 本次证据 |
|---|---|---|
| 返回封装 | 成功 `{code:0,msg:"ok",data:...}`；业务错误仍 HTTP 200；不存在的路径为真实 404 | HTTP 契约回归 |
| 分页 | `records,total,size,current,pages`；四个数值为 JSON 字符串；通常接收 `pageSize`，MCP 接收 query `size` | HTTP 契约与真实分页查询 |
| Long | ID 等 Java Long 输出字符串，包含超过 JS 安全整数范围的 `9007199254740993` | HTTP 契约回归 |
| 日期/字段名 | `yyyy-MM-dd HH:mm:ss`，camelCase 字段；不返回 `userPassword` | HTTP 契约回归 |
| 身份/权限 | Java 权威；匿名 40100；普通用户访问管理员业务为 40101；个人诊断列表按服务端身份限制 | HTTP 回归；真实管理员查询与登出重放 |
| 登录失效 | 默认 `SESSION`，兼容使用 `JSESSIONID` 的部署；逐请求验证 Java，无 Python 正身份缓存 | red→green + 真实 Java/Redis |
| 旧同步诊断 | `POST /api/diagnosis/diagnosis` 仍同步；不是新工作流；无可用权重时 50000，不能生成伪造成功记录 | HTTP 回归与真实缺权重调用，记录数不变 |
| 既有诊断展示 | `severity=NOT_ASSESSED`；recommendations 为换行字符串；拒识记录隐藏预测结论；AI 来源字段不由复核 DTO 改写 | 既有业务及 HTTP 回归 |

## 可复现依赖与启动

使用 Python 3.11。`requirements-web.lock` 从业务依赖和测试工具两个输入文件通用解析生成，包含精确版本及平台标记。本次为 Windows / Python 3.11.17；Maven/Java 统一使用 Corretto 21.0.7。模型依赖与权重不包含在这个 Web 基线中。

```powershell
# 以下命令在 PowerShell 7、迁移 worktree 中执行。
uv venv --python 3.11 algorithm/.venv-baseline
uv pip sync --python algorithm/.venv-baseline/Scripts/python.exe algorithm/requirements-web.lock
& algorithm/.venv-baseline/Scripts/python.exe -m playwright install chromium
Set-Location algorithm
& .venv-baseline/Scripts/python.exe -m pytest web/tests -q
& .venv-baseline/Scripts/python.exe -m mypy web/auth.py web/config.py web/app.py web/verify_baseline.py web/response.py web/schemas/user.py web/schemas/diagnosis.py web/schemas/news.py --follow-imports=silent --ignore-missing-imports
```

重新解析依赖（升级时才执行）：在 `algorithm` 中运行 `uv pip compile requirements-web.txt requirements-web-test.txt --python-version 3.11 --universal -o requirements-web.lock`，然后重新回归。CI 的 Web 验证使用这个锁文件。

真实验证须使用独立测试数据库和账号，不能直接对业务库运行本段。此次用户明确批准 `eye_baseline_issue01` 及一次性账号。测试库中只有合成数据；诊断历史行由测试夹具预置，**不是模型输出**。

| 服务 | 本次地址/版本 | 说明 |
|---|---|---|
| MySQL | 127.0.0.1:3307 / 8.0.26 | schema `eye_baseline_issue01`，业务事实来源 |
| Redis | 127.0.0.1:16379 / 3.2.100 | 独立临时实例、DB 8；Python 显式 RESP2；这是本地兼容验证，不是生产版本建议 |
| Chroma | 127.0.0.1:18000 / 1.5.9 | 独立目录，预建 `diagnosis-knowledge`；本票仅验证 Java 能启动，不验收检索 |
| Java | 127.0.0.1:8082 | 原应用，Flyway V1–V9 已在隔离库执行并能再次启动 |
| FastAPI | 127.0.0.1:8080 | 单 worker，无权重、无模型后备 |
| Nginx | :8081 / 1.28.0 | 三个会话端点到 Java，业务到 Python |
| 原前端 | localhost:5173 / Vite 5.4.18 | 未修改 Vue 源码；默认 API URL 指向 localhost:8081/api |

复现真实环境步骤：

1. 创建独立 MySQL schema；用 `src/main/resources/db/schema.sql` 中的原始 `t_user` DDL 初始化用户表。原 Java Flyway callback/migrations 负责 `t_diagnosis`、MCP、推理缓存等升级。用 BCrypt 密码插入合成账号，不使用旧 MD5 账号以免登录触发密码升级。账号凭据存入忽略的 `.scratch/baseline-runtime/login.json`，字段为 `userAccount`、`userPassword`。
2. 启动隔离 Redis；启动 `chroma run --host 127.0.0.1 --port 18000 --path <隔离目录>`。使用 `chromadb.HttpClient(host="127.0.0.1",port=18000).get_or_create_collection("diagnosis-knowledge")` 预建空集合，避免原 Java 在集合不存在时启动失败。
3. 将 `src/main/resources/application-server.example.yml` 复制到忽略的运行目录，填写本地测试配置。覆盖 `server.port=8082`、`spring.datasource`、`spring.flyway.schemas=eye_baseline_issue01`、`spring.data.redis.port=16379`、Chroma client port 18000 及 `app.cors.allowed-origins=http://localhost:5173`。保留日期配置；模型/云服务配置使用测试占位值，本票不调用外部 LLM、COS 或 embedding。配置文件和凭据不提交。
4. 设置 `$env:JAVA_HOME='C:\Users\yuwen\.jdks\corretto-21.0.7'` 并将其 bin 放到 Path 首位。运行 `mvn -o -q -DskipTests compile`，然后 `mvn spring-boot:run '-Dspring-boot.run.arguments=--spring.profiles.active=baseline --spring.config.additional-location=file:<运行配置绝对路径>'`。若依赖未缓存，正常在线解析 Maven 依赖。不要修改 Java 源码或 pom。
5. 给 Python 设置 `MYSQL_HOST/PORT/DATABASE/USER/PASSWORD`、`REDIS_PORT=16379`、`CHROMA_PORT=18000`、`JAVA_BASE_URL=http://127.0.0.1:8082/api`、`CORS_ALLOWED_ORIGINS=http://localhost:5173`；清空 `MODEL_WEIGHTS_PATH`。在 `algorithm` 运行 `python -m uvicorn web.app:app --host 127.0.0.1 --port 8080`（使用上述 venv 的 Python）。
6. `deploy/nginx.conf` 是 `http` 内配置；安装其公共 headers snippet 到 `/etc/nginx/snippets/`。Windows 本地验证可生成忽略的完整配置，添加 `events {}`/`http {}` 包装、将 include 改为本工作树绝对路径，并创建 `logs`、`temp` 目录。先 `nginx -t` 再启动。Java 上游为 8082，禁止与前门 8081 重复。
7. 在 `frontend` 执行 `npm ci`、`npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`。浏览器、前端 API 统一使用 `localhost`；混用 127.0.0.1 与 localhost 会改变 cookie 域。
8. 在 `algorithm` 运行下方验证器。它通过 UI 登录，进入用户中心，再点击已有菜单打开诊断历史；原用户中心首次挂载会跳转 profile，直接深链接不能作为可靠导航步骤。

```powershell
& .venv-baseline/Scripts/python.exe -m web.verify_baseline `
  --login-file ../.scratch/baseline-runtime/login.json `
  --output-dir ../.scratch/baseline-runtime/evidence `
  --missing-weights
```

`--missing-weights` 只用于明确未配置权重的隔离服务：它实际调用旧同步写入接口验证失败保护。如果部署已有权重，不传此参数。验证器只允许 localhost/127.0.0.1；结果不包含凭据或 cookie。截图和 JSON 应先人工检查再保存为证据。结束时登出并关闭验证器自己的浏览器，停止本次启动的进程；测试库和临时文件保留供复查，不自动删除。

## 验证结果与边界

真实链路结果见 [issue01-live-results.json](baseline/issue01-live-results.json)，页面证据见 [issue01-frontend-history.png](baseline/issue01-frontend-history.png)。涵盖匿名探针、登录/登录态、Python 分页查询、同条记录 Java/Python 的 ID 与日期对照、缺权重拒绝且不增记录、登出后旧 cookie 在两端失效、原前端历史查询。合成历史行仅用于页面与字段兼容验证。

当前锁定环境的 Web 全量回归 **420 passed**（0 skipped）；8 个本票修改/新增模块的 mypy 检查通过，锁定依赖一致性检查通过；原 Java `mvn -o -q -DskipTests compile` 与真实启动通过；Nginx 1.28.0 的 `-t` 通过。全量回归首次实际执行了此前因缺 NumPy 跳过的数值测试，修正了旧测试中的类别顺序错误与缺失 import，未修改推理算法。

双轴代码审查及修正复审见 [issue01-review.md](baseline/issue01-review.md)，两轴均无遗留发现。权重缺失仍是**真实模型验收阻塞**；COS 上传、真实模型成功诊断、Chroma 跨语言检索、.doc/.docx 完整迁移、Agent/SSE 工作流、生产部署/回滚和临床复核均未由本票验收。

## 缺陷分流

迁移修复：遗漏 Spring Session 默认 cookie；Python 正身份缓存导致登出延迟；`functools.partial` 关键字默认值被 FastAPI 暴露为 query `must_role`，允许客户端降低管理员权限要求（改为位置参数固定绑定，并通过 HTTP 验证两种绕过均被拒绝）；Java 与 Nginx 端口冲突；公共 snippet 与 SSE location 重复 `proxy_http_version` 导致 Nginx 语法拒绝；新 Redis 客户端默认 RESP3 与本地旧 Redis 不兼容（显式 RESP2，命令及业务缓存语义不变）；Java `Date` 的 UTC 字符串与 Python 数据库时间相差 8 小时（按现有上海 JDBC/UTC Jackson 组合复刻，缓存回读不重复转换；`LocalDateTime` 保持原值）。这些修改均在 Python/部署层。

既有业务问题保持原状，详见 [rewrite-findings.md](rewrite-findings.md) 与 [migration-decisions.md](migration-decisions.md)：新闻没有有效建档入口、封面更新覆盖标题/作者、公开列表不按发布状态过滤、物理删除等。原前端对格式化日期调用 `Number(...)`，历史表格仍显示 `Invalid Date`，截图保留该事实。另观察到原 `UserCenter.vue` 挂载固定跳转 profile，深链接历史会被改写；使用现有菜单可完成查询，本票不修前端。原 Java 源码与构建配置保持不变。
