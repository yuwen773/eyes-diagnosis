# Eye Diagnosis AI System · 眼科智能诊断系统

> 基于深度学习的眼科疾病智能诊断系统。通过分析眼底图像，利用 EfficientNet-B4 模型识别 **8 种常见眼科疾病**，并提供 **AI 智能问诊**、**知识库 RAG 检索** 与 **MCP 工具扩展** 能力。

![功能模块总览](docs/assets/readme/features-overview.png)

## 当前 Python 工程（2026-10-17）

| 范围 | 当前交付 | 证据 |
|---|---|---|
| 工单 01 | Python 数据库初始化与支持的旧库承接 | [数据保全](docs/python-database-handoff-evidence.md) |
| 工单 02 | Python/Redis 登录态、HTTP/SSE 鉴权、Vue/OpenAPI 接线 | [身份验证](docs/python-session-auth-evidence.md) |
| 工单 03–05 | 非 JVM 文档、旧任务重建及现有等待恢复 | [.scratch/python-project-migration](.scratch/python-project-migration/README.md) |
| 工单 06 | 根目录 Python、Windows 脚本、Linux Compose、无 JVM CI | [当前运行与验收指引](docs/python-delivery.md) |
| 工单 07 | 隔离切换与故障恢复演练 | [演练证据](docs/python-cutover-rehearsal.md) |
| 工单 08 | 历史保全、Java 退出与工程收尾完成；待人工复核 | [最终验收](docs/python-retirement.md) |

完整进度、已完成能力和剩余真实模型/发布边界见 [工作树进度](docs/python-worktree-progress.md)。

在根目录运行，当前开发、测试及部署不需要 Java/Maven/Flyway/Tika：

```powershell
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 install
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 start -EnvFile .env
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 status
pwsh.exe -NoLogo -NoProfile -File scripts/dev.ps1 stop
& .venv/Scripts/python.exe scripts/verify.py web
& .venv/Scripts/python.exe scripts/verify.py frontend
```

配置样例为 `deploy/python/.env.example`；先填写隔离目标连接和安装 DOC 工具。
Linux 使用 `docker compose -f deploy/python/compose.yml build` 和 `up -d`，API/Worker
分别运行，通过 Nginx/Vue 同源访问。数据库升级为独立显式步骤；启动不自动建表或清空数据。
OpenAPI 来源 `/api/openapi.json`，用户用原账号密码重新登录，详情见
[Python 交付指引](docs/python-delivery.md)。工程、基础设施、供应商/模型和临床分层验收，
工单 06 结果不表示已生产切流。


历史 Java 源码、构建和原说明可由本地标签 `archive/java-before-python-retirement-2026-10-17` 定位。
[历史说明](docs/history/java/README.md)仅作档案；当前操作以本文及 Python 交付指引为准。
