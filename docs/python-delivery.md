# Python 工程与双环境交付（工单 06）

当前入口是根目录 `pyproject.toml`、`.python-version` 和
`algorithm/requirements-web.lock`。Python 3.11，保持 `web.*`、`eye_diagnosis.*`
等模块名与持久化图兼容。开发、测试、初始化、升级及 API/Worker 运行不需要 JVM。
Java 原资产保留至工单 08；本文不授权业务库升级或生产切流。

## Windows / PowerShell 7

先运行 `pwsh.exe -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion'`。
安装 uv 0.13.0 后，在项目根目录运行：

```powershell
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 install
# 复制 deploy/python/.env.example 到自己的 .env，填写既有基础设施连接。
# Windows 的 MYSQL_HOST / REDIS_HOST / CHROMA_HOST 通常是 127.0.0.1。
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 start -EnvFile .env
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 status
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 stop
```

脚本只管理 `.runtime` 登记的 PID；停止前核对可执行路径、完整启动路径、角色与
进程创建时间，并停止该进程树。端口占用时拒绝启动，不结束已有进程或自动改端口。
`.runtime` 日志和 PID 文件不提交、不进入镜像。环境文件采用 `NAME=value`，不执行
插值或脚本；值不要额外加引号。API 默认 8080，前端开发另运行 `npm run dev`。

DOC 转换工具单独离线安装，来源、SHA256 与版本见
[非 JVM 文档工具](no-jvm-document-knowledge.md)：

```powershell
& .venv/Scripts/python.exe -m web.doc_tool --archive <已下载并核验来源的Windows安装包>
```

## 显式迁移

迁移只读取 `MIGRATION_MYSQL_URL=mysql+pymysql://.../目标库`。应先备份并确认目标。
支持的空库、V9、V22 路径由独立迁移资产及 schema/history 校验决定；不认识的状态
停止，不修历史。API/Worker 启动、Compose up、健康检查均不自动迁移。

```powershell
& .venv/Scripts/python.exe -m web.migrations baseline-check
& .venv/Scripts/python.exe -m web.migrations inspect
& .venv/Scripts/python.exe -m web.migrations upgrade
```

## Linux Compose

```sh
cp deploy/python/.env.example deploy/python/.env
# 填写既有 MySQL / Redis / Chroma / COS 及供应商配置。
docker compose -f deploy/python/compose.yml build
# 显式 inspect / upgrade 使用一次性容器，并只在已批准的隔离目标上执行。
docker compose -f deploy/python/compose.yml run --rm -e MIGRATION_MYSQL_URL api eye-migrate inspect
docker compose -f deploy/python/compose.yml up -d
docker compose -f deploy/python/compose.yml ps
docker compose -f deploy/python/compose.yml restart api worker
docker compose -f deploy/python/compose.yml down
```

Compose 只编排 API、Worker、Nginx/Vue 三个独立服务，连接既有基础设施。
不创建、清空或重置业务库、向量集合和对象存储；down 不删除这些外部数据。
前端仅绑定本机 8081；远程部署按既有反向代理/TLS 策略开放。
HTTPS 必须设置 `SESSION_COOKIE_SECURE=true`；本地 HTTP 使用 false。
旧 Spring Cookie 不授予 Python 身份，用户用原账号密码重新登录。

运行镜像固定 Python 镜像摘要、依赖版本及 LibreOffice 26.2.6.3 的归档 SHA256。
镜像通过 wheel 安装，不复制 Java、原有工作树文件、运行秘密、模型权重或业务数据。
API 的 `/health` 为存活，`/ready` 与 `eye-health` 只读探测 MySQL/Redis；健康不代表
模型、COS、Chroma 或临床可用。Worker 健康检查验证基础设施连接，队列执行能力由
独立 Worker 验收验证。默认单 API 进程，保持已有 Snowflake 进程配置边界。

Dockerfile 的 `web` 目标是无 torch 的工程/回归镜像；Compose 使用 `cpu` 目标，
从 `algorithm/requirements-model-linux.lock` 按 hash 安装 Linux CPU torch 与模型
模块所需依赖，并附带公开 registry/calibration。通过 `EYE_MODEL_DIR` 指定宿主机权重
目录，API/Worker 只读挂载至 `/models`；配置 `MODEL_WEIGHTS_PATH=/models/<文件名>`
及 `MODEL_WEIGHTS_SHA256`，仍必须通过 registry 白名单校验，镜像不包含权重。
Windows 扩展使用已有 `algorithm/requirements-model-cpu.lock`。缺少权重时推理关闭，
其他页面继续可用；模型模块可加载不代表真实分类验收。LLM、embedding、COS 密钥仅
运行时注入。

## 共同验收入口

```powershell
& .venv/Scripts/python.exe scripts/verify.py web
& .venv/Scripts/python.exe scripts/verify.py frontend
# 只用本机 MySQL 管理连接；入口创建随机 eye_python_issue06_* 隔离库并保留。
# REAL_SERVICES_REDIS_SERVER 可指定 redis-server 可执行文件。
& .venv/Scripts/python.exe scripts/verify.py infrastructure
```

`frontend` 从 Python 构建 OpenAPI schema 后生成客户端，执行 Vue 类型检查、构建与
Vitest；不依赖在线 Java 服务。`web` 执行依赖检查、资产与恢复图核验、类型检查和
全量 Web 回归。`infrastructure` 执行真实 MySQL/Redis/Chroma、独立 API/Worker、
人工等待/重启/并发/fencing/批准仅一次保存及支持的旧库承接。外部模型和 COS 使用
明确标注的受控适配器，结果与临床分层。测试数据和私有原始日志保留，不自动删库。

Linux 等价 CI 使用 `deploy/python/Verify.Dockerfile`；其中只有 Python、Redis 和
非 JVM DOC 工具，契约来自 `contracts/legacy-api.json` 和独立 SQL 资产。
`.github/workflows` 不安装/执行 Java、Maven、Flyway 或 Tika。
工单 19 的旧 Java 大 ID/embedding 失败是历史证据，见
[历史真实服务报告](real-services-ci.md)，本票不覆盖该报告。

工单 06 的实际结果见 `.scratch/python-project-migration/evidence/issue06/`。
镜像构建完成后可运行 `python scripts/smoke_compose.py --output-dir <新证据目录>`。
它使用随机 Compose 项目、独立 MySQL/Redis/Chroma 容器及卷，从空库升级后验证原 Vue
经 Nginx 登录、数据读取、实际 Worker 消费无效图片任务及 API/Worker 重启保全。
演示会占用 API 的旧容器地址再启动，验证 Nginx 经 Docker DNS 重新发现 API 地址；
会话、任务与已有数据必须保持一致。
结束只停止本次服务；隔离库、基础设施卷及私有日志保留。该演示不做生产切流或回退。
托管 CI、真实模型/供应商、临床及生产切流必须分别记录，不能由本地工程通过推断。
