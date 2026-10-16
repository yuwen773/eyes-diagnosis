# 工单 20：部署、分项切流与回退

本手册复现历史工单 20 的分项切流演练，已按完整迁移工单 02 更新为 Python 会话 + Python 业务/Agent。历史演练结果不等于更新后的演练通过；完整回退须由新工单 07 重新验收。只在隔离环境执行本票
演练；生产发布需另行授权。工单 19 的真实 embedding、旧 Java Long 用户检索仍阻塞，
所以本票的工程演练通过也不能解除生产切流或完整迁移验收门槛。

## 交付拓扑与启动顺序

| 服务 | 本机端口 | 归属 |
|---|---|---|
| Nginx | 127.0.0.1:8081 | 浏览器唯一入口，静态前端、业务与 Agent 分别切流 |
| Java 21 | 127.0.0.1:8082 | 历史比较/旧业务与 Agent 回退目标；不再提供 Python 登录态 |
| Python 3.11 API | 127.0.0.1:8080 | 业务、工作流、复核、用户确认、聊天 |
| Python Worker | 无监听端口 | `python-graph` 分段任务的唯一执行器类型 |
| MySQL / Redis / Chroma | 3307 / 6379 / 8000 | 同一业务库 / Redis DB 8 / diagnosis-knowledge |

端口可在隔离演练中独立选择；生成器拒绝三个 HTTP 服务端口重叠。Python 不需要
`JAVA_BASE_URL`；三个会话端点始终走 Python。生产网络入口、TLS 和反向代理的部署
由运维另行配置；生成器默认只监听 loopback。

启动顺序：MySQL/Redis/Chroma → 单独执行 Flyway → Java → Python API → Worker →
Nginx。API 的 `/health` 仅代表进程存活；必须再做真实登录、业务查询、Worker 分段
执行和旧 cookie 注销重放才能判断可切流。检查现有监听 PID/名称/命令行，端口占用
时停止演练并查明归属，不杀其他进程、不偷偷改产品端口。

## 可复现准备

以下代码块在 **PowerShell 7** 内运行；先执行 `pwsh.exe -NoLogo -NoProfile -Command
'$PSVersionTable.PSVersion'`，不可退回 PowerShell 5.1。工作目录为本迁移工作树。

```powershell
$env:JAVA_HOME='C:/Users/yuwen/.jdks/corretto-21.0.7'
$env:Path="$env:JAVA_HOME/bin;$env:Path"
uv venv algorithm/.venv-deploy --python 3.11
uv pip sync --python algorithm/.venv-deploy/Scripts/python.exe algorithm/requirements-web.lock
uv pip check --python algorithm/.venv-deploy/Scripts/python.exe
Push-Location algorithm
& .venv-deploy/Scripts/python.exe -m web.doc_parser
& .venv-deploy/Scripts/python.exe -m playwright install chromium
Pop-Location
```

锁文件包含 Web、Worker 与验证依赖，不含真实分类器的 torch/torchvision。真实分类
发布还必须安装经过目标 CPU/CUDA 环境验证的分类依赖、冻结其版本及 wheel 摘要，
提供权重、SHA256、模型注册与校准文件；这些属于工单 21，不能用
`requirements.txt` 的宽松版本范围宣称可复现模型发布。缺权重的旧同步诊断失败保护
不等于分类能力通过。

`.doc` 使用固定 LibreOffice 26.2.6.3，无 JVM。提前提供官方 Windows MSI 或 Linux DEB
归档，通过 `python -m web.doc_tool --archive <本地归档>` 校验内置 SHA256 并隔离解压；
自定义安装位置用 `DOC_TOOL_HOME`。运行时不下载，Tika/JAR 不再是 DOC 路径依赖。
安装、许可证与双环境证据见 [文档工具交付](no-jvm-document-knowledge.md)。
`.docx`、PDF、文本依赖已在 Web 锁文件内。验证清单保留 Python/pip freeze、JDK、
Nginx、MySQL、Redis、Chroma 版本、源码/前端摘要和镜像或二进制摘要。

从密钥管理器注入配置，勿把密码、cookie 或提供商响应放进提交：

| Python 环境变量 | Java 对应配置/要求 |
|---|---|
| MYSQL_HOST/PORT/DATABASE/USER/PASSWORD | spring.datasource.url/username/password，同一 MySQL schema |
| REDIS_HOST/PORT/DB/PASSWORD，DB=8 | spring.session.store-type=redis、spring.data.redis.* 相同 |
| SESSION_COOKIE_NAME=EYE_SESSION；SESSION_REDIS_PREFIX=eye:py:session: | 与 Spring 会话空间隔离，不共享登录 Cookie |
| SESSION_TTL_SECONDS=1800；SESSION_COOKIE_MAX_AGE=2592000 | Python Redis TTL 与浏览器 Cookie 生存期独立 |
| SESSION_COOKIE_HTTPONLY=true；SESSION_COOKIE_SAMESITE=lax；SESSION_COOKIE_SECURE=true（HTTPS） | 本地 HTTP 的 Secure 为 false；生产必须显式配置 |
| CHROMA_HOST=http://127.0.0.1，CHROMA_PORT=8000 | spring.ai.vectorstore.chroma.client.host/port |
| CHROMA_COLLECTION=diagnosis-knowledge | spring.ai.vectorstore.chroma.collection-name 相同 |
| CHROMA_TENANT/CHROMA_DATABASE | Java tenant-name/database-name 相同 |
| DASHSCOPE_API_KEY、EMBEDDING_MODEL、CHAT_MODEL | Java DashScope 配置；迁移前后 embedding 模型/维数不变 |
| COS_SECRET_ID/KEY、COS_REGION/BUCKET/HOST | Java cos.client.*，原图片 URL 必须继续可访问 |
| MODEL_WEIGHTS_PATH/SHA256、MODEL_REGISTRY_PATH、MODEL_CALIBRATION_PATH | Worker/API 使用同一已批准模型版本 |
| MCP_ALLOWED_ORIGINS、MCP_READONLY_TOOLS、MCP_PROFILE_TOOLS | 默认留空，部署配置不替代用户保存授权 |

Java 使用外置配置文件，例如命令行 `--spring.profiles.active=cutover
--spring.config.additional-location=file:<private-config-directory>/`，明确覆盖仓库默认
`local,dev`。外置配置必须包含上表以及原服务所需 OpenAI/DashScope/COS 配置。
禁止把验收专用 `Issue19Probe` 当生产入口。构建原 Java：`mvn -DskipTests package`，
启动产物时显式传 `--server.port=8082 --server.address=127.0.0.1`。
Python 使用 HttpOnly、Path=/ 的 EYE_SESSION；Redis 仅存 userId，每请求重查账号与角色。
Spring Session 保持历史空间，旧 Cookie 不授予 Python 身份。业务回退到 Java 时必须独立重新登录，
不能把 Python Cookie 交给 Java；该跨身份域回退仍需工单 07 重演。

隔离手工启动基础服务时，先使用本机服务管理器启动已配置的 MySQL 8，并验证
目标 schema 和账号可连接。Redis 与 Chroma 各用独立终端运行（生产需交由服务管理器
持久管理，不要沿用演练的无持久化 Redis 参数）：

```powershell
# 设置本地 redis-server 的绝对路径变量 $redisExe，使用已有且已核验的配置文件。
& $redisExe '<private redis.conf>'
# 另一终端，工作目录 algorithm；路径必须是专用持久目录。
& .venv-deploy/Scripts/chroma.exe run --host 127.0.0.1 --port 8000 --path '<persistent chroma directory>'
```

Redis 配置明确 bind/port、持久化、认证和 namespace；Java/Python 均使用 DB 8。
Chroma 数据目录在重启及回退时保留。Docker 可用时根目录 compose 仅启动 Chroma，
不能把它当完整栈；本机 Docker daemon 未启动，本次采用锁定 Python Chroma CLI。
Nginx 共享头用 `$http_host` 保留浏览器入口端口，避免 Java 将同源请求判为跨域；
不扩大 CORS 白名单以掩盖代理配置问题。

## 数据库升级与执行器交接

1. 封存源版本、前端包、外置配置摘要和路由配置。备份 MySQL（含全部审批、任务、
   checkpoint、输入原图、Flyway history）、Chroma、对象存储引用；在隔离库验证恢复。
2. 先关闭新任务入口；记录所有旧/新 Worker 的 PID、名称、命令行与服务调度归属。
   停止旧调度器领取新任务，等已有执行提交到安全边界，再停止旧执行器并确认进程退出。
3. `deploy/workflow-migrations/README.md` 的独立工程执行 info、validate、migrate、
   validate，目标 **V22**。只允许 additive migrations，保留唯一
   `flyway_schema_history`。不 clean、repair、drop、倒写历史或降级 schema。
   当前完整 Python 项目迁移的 `deploy/python-migrations` 属另一组工单，不能混用。
4. Java 启动前在外置配置中设 `spring.flyway.enabled=false`：本次升级由独立 V1–V22
   工程负责。重启 Java 并验证真实会话、旧查询和 schema 兼容。
5. API、Worker 都不执行 DDL。Worker 仅领取 `segmentCode=python-graph`；保留 graph
   version/hash、action version 和 checkpoints。禁止把这些任务转交旧 Java、修改
   segmentCode 或复制任务“续跑”。旧执行器若无法证明会排除 Python 分段，必须保持停止。
6. 启动指定 Python Worker 后，先用合成账号/图片验证创建 202、查询、分段、重启、
   复核和保存确认幂等。正式建档仍必须由记录所有者明确批准；医生复核不能替代授权。

在各自独立、配置相同的终端启动：

```powershell
# 工作目录 algorithm；预先注入上表环境变量。
& .venv-deploy/Scripts/python.exe -m uvicorn web.app:app --host 127.0.0.1 --port 8080 --workers 1
# 另一终端，同一配置与 Python 环境；管理服务需记录该 PID。
& .venv-deploy/Scripts/python.exe -m web.workflow.worker
```

API 单进程维持现有 Snowflake 限制；不擅自增加 API 副本。

## 分项切流

前端构建必须显式指定同源 API，SSE 默认沿用同一地址；如曾设置
`VITE_APP_API_BASE_URL`，清除该旧覆盖或将它配置为本次唯一入口。

```powershell
Push-Location frontend
$env:VITE_API_BASE_URL='/api'
Remove-Item Env:VITE_APP_API_BASE_URL -ErrorAction SilentlyContinue
npm ci
npm run build
Pop-Location
Push-Location algorithm
& .venv-deploy/Scripts/python.exe -m web.cutover --output ../.scratch/cutover/nginx.conf --business java --agent java --workflows pause
Pop-Location
# 使用本地已经核验的 Nginx 二进制；设置绝对路径变量 $nginxExe。
$proxyRuntime=(Resolve-Path .scratch/cutover).Path.Replace('\','/') + '/'
& $nginxExe -p $proxyRuntime -c nginx.conf -t
& $nginxExe -p $proxyRuntime -c nginx.conf
```

生成的是完整 Nginx 配置；`deploy/nginx.conf` 是历史 server/http 片段，不可直接当完整
主配置。新生成器复用共享 cookie/代理头，提供 MIME 类型与前端 SPA fallback。

| 阶段 | --business | --agent | --workflows | 验证后才能进入下一阶段 |
|---|---|---|---|---|
| 历史业务基线 | java | java | pause | 三个会话端点已固定走 Python；Java 业务需独立身份，待工单 07 重验 |
| 业务切流 | python | java | pause | 用户/新闻/文档/历史兼容；无新 Python 工作流 |
| Agent 切流 | python | python | drain | 既有聊天历史、待确认、补充与复核可读 |
| 放行 | python | python | active | Worker 归属、真实服务 gate、浏览器核心路径 |

先生成到同目录候选文件、`nginx -t` 验证，再备份/替换当前文件并用相同 `-p/-c`
执行 `-s reload`。reload 失败保留原进程和配置；实测前后请求分别记录。
生产 hot reload 的既有连接会继续使用旧配置，需在接入层先关闭新 admission，等待
旧连接/上传/SSE 结束并确认没有新增执行，再宣布进入 pause。隔离自动演练通过停止
本次拥有的代理 PID再启动新配置完成切换，不能冒称无中断 hot reload 已验证。

## 回退条件、暂停与恢复

触发条件：代理回环/端口冲突、登录或注销重放失败、越权读取、任务重复执行、租约
或版本冲突错误、图版本不兼容、审批丢失、正式记录无用户授权、发布依据不可信，
或真实依赖 gate 未通过。立即关闭 admission 并保全日志/数据库状态。

| 策略 | 路由命令参数 | Python Worker | 能力 |
|---|---|---|---|
| 安全排空 | --business java --agent python --workflows drain | 保留指定版本，继续已提交分段 | 禁新建/聊天发送，允许既有复核、补充回复及明确保存审批 |
| 完全暂停新图执行 | --business java --agent java --workflows pause | 停止并确认退出 | 旧业务/Agent 可恢复；Python 工作流、复核与恢复聊天只读，写入 503 |

两种策略都把 `/api/diagnosis/workflows`、`/api/reviews/tasks` 留给 Python。
Agent 回 Java 后，原 Python 会话可经 `/api/python-recovery/sessions`、
`/api/python-recovery/history/<sessionId>`、`/api/python-recovery/supplements/<requestId>`
查询；仍用 Python EYE_SESSION 鉴权。恢复命名空间拒绝新聊天、附件写入和会话变更。
drain 时补充回复/工具批准使用对应恢复路径；这不改变原所有权、版本或确认要求。
pause 时这些写请求也被拒绝。旧 Java 无法继续 Python 会话/图；运维须告知用户原
任务暂停并保留原 ID，不向旧端自动重放消息或批准。

暂停不是只改路由：先暂停新入口，再停 Worker 并确认没有活跃进程；若强制停止
执行中的自有 PID，保留其租约和 token，等租约失效后再由同版本 Python Worker
接续，fencing 防止旧结果提交。不要清空运行中记录或人工等待来“解除卡住”。
查询接口可能做既有发布依据重校验或过期聊天恢复；查询策略不意味着数据库绝对零写入。

恢复：校正环境/依赖 → 独立 Python migration inspect → Python 会话验证 → 启动同版本 Python
API → 对照任务/待确认/复核/补充与 receipt → 确认旧执行器停止 → 启动指定 Python
Worker → drain 路由验证 → active 放行。不得自动批准等待项、重跑已冻结推理或回滚
已有正式记录。对照必须检查状态、版本、checkpoint 关联、确认摘要和正式记录数量。

前端包也必须分别保留：旧包提供旧业务/Agent；当前包配 Python 提供任务恢复。切换
旧页面不代表新任务已迁回。图片仍通过 Python 工作流 URL 提供时保留 API 与原图。
只有 Python 工作流/补充/复核/确认/保存图片引用全部完成保留期审核，才能另案退役。

## 隔离自动演练与证据

```powershell
$env:REAL_SERVICES_MYSQL_ADMIN_URL='mysql+pymysql://<admin>:<secret>@127.0.0.1:3307'
$env:REAL_SERVICES_REDIS_SERVER='<absolute redis-server.exe>'
Push-Location algorithm
& .venv-deploy/Scripts/python.exe -m web.verify_real_services --embedding-mode controlled --cutover-nginx '<absolute nginx.exe>' --output-dir ../.scratch/python-agent-migration/evidence/issue20/local
Pop-Location
```

每次新建隔离 schema、随机端口、独立 Redis/Chroma/Java/API/Worker/Nginx，只终止
本次拥有的子进程。测试库与私有日志留在忽略的 `.scratch/baseline-runtime` 供复查。
受控模型测试的退出 2 表示真实 embedding/旧读端仍阻塞；不能简单忽略退出码。
要求 infrastructure、orchestration、mysqlSemantics、cutover 四个工程 gate PASS。
浏览器必须真实通过 Nginx完成登录、上传 202、任务刷新、聊天 SSE done，不拦截网络。
`cutoverWaits` 记录实际读取的审批/复核快照前后摘要与写入拒绝码；恢复后用原版本
继续审核/用户批准，原保存确认重放只产生一条正式记录。

证据只提交结果、源码/前端摘要和合成账号截图；不提交 cookie、密码、原始 SQL/日志。
真实分类/LLM/COS/临床、生产发布、生产热切流、真实旧执行器交接各自单独验收。
