# 工单 19：真实服务与兼容回归

入口：`algorithm/web/verify_real_services.py`。仅在迁移工作树运行，必须指定本地 MySQL
管理员 URL，且 URL 不包含数据库名。每次创建随机 `eye_real_services_issue19_*` 库，
用原始表 DDL 引导，再由现有独立 Flyway 工程升级 V1–V22；不修改 Java 源码、原 pom
或源 spec，也不会在业务库执行验收或自动删库。

## 复现

使用 `algorithm/requirements-web.lock` 的 Python 3.11 环境，以及 Java 21、Maven、
redis-server。Windows 使用仓库指定的 Corretto 21.0.7；Linux 使用 `JAVA_HOME`。
Chroma 通过同一 Python 环境安装的 CLI 启动，数据目录和各服务端口由入口隔离。

```powershell
# 在 py-rewrite 工作树下，以 PowerShell 7 运行。
$env:REAL_SERVICES_MYSQL_ADMIN_URL='mysql+pymysql://<user>:<password>@127.0.0.1:3307'
$env:REAL_SERVICES_REDIS_SERVER='<redis-server.exe 绝对路径>'
Set-Location algorithm
& .venv-baseline/Scripts/python.exe -m web.doc_parser
& .venv-baseline/Scripts/python.exe -m web.verify_real_services `
  --output-dir ../.scratch/python-agent-migration/evidence/issue19/local
```

默认尝试真实 `text-embedding-v3`：密钥只从 `DASHSCOPE_API_KEY` 环境读取。
`REAL_SERVICES_EMBEDDING_BASE_URL` 可指定 Python 兼容端点，但旧 Java 读端仍用原生
DashScope embedding 客户端；两端必须使用同一模型及维数。
没有凭据或供应商预检失败时，继续受控向量编排测试，并保留 `realEmbedding=BLOCKED`。
显式 `--embedding-mode controlled` 同样不能获得真实 embedding PASS。

结果 `results.json` 和 `source-sha256.json` 可提交复查；原始日志、账户密码和本地对象
只保留在忽略的 `.scratch/baseline-runtime/<测试库名>/`。退出时停止本次启动的 PID
及其子进程；测试库、日志和 Chroma 数据保留，供人工复查。

退出码为 0（本票真实服务、embedding 与旧 Java Long 用户读端判据通过）、1（验证失败）、2（阻塞）。
即使退出 0，`realClassifier`、`realLLM`、`realCOS` 和 `clinical` 仍各自保持
`NOT_VERIFIED`；不能据此宣称真实模型、COS、临床或完整迁移 spec 已验收。

## 验证范围

| 层级 | 实际边界 |
|---|---|
| 真实基础设施 | 新 MySQL schema、Flyway、Redis 会话/缓存、Chroma HTTP、原 Java 应用启动 |
| 业务兼容 | Java 登录/注销与旧 cookie 重放；Python 逐请求鉴权；Long/分页/日期/业务码；旧同步诊断缺权重失败保护；Java/Python 历史与新闻对照 |
| 文档与读取 | 真二进制 DOC、表格 DOCX 经上传/解析/索引；私人范围与引用；Python 写→原 Java `DocumentSearchTool` 和 ChromaVectorStore 读 |
| 工作流 | 真实 TCP API→MySQL 任务→独立 Worker→生产图→持久 checkpoint；幂等上传、质量复核、最终复核、解释发布/撤回、本人显式保存确认与重放 |
| Agent | 旧 SSE 正常结束/错误、MySQL 会话与历史、按需历史工具、跨用户拒绝；状态 SSE 每次重新鉴权 |
| MySQL 专属 | 复用工单 16/17 的真实 MySQL 多进程竞争、SKIP LOCKED、租约、fencing、事务及人工等待重启套件，独立建库 |
| 确定性适配器 | 分类、聊天、解释、COS；受控模式额外替换 embedding，不能作为语义召回证据 |

旧业务及 Agent 的完整契约边界回归仍由 `python -m pytest web/tests -q` 执行，
大部分使用 SQLite/HTTP 适配器；它与上述真实服务检查分开报告，不能改称全量真实服务验证。
新工作流上传必须 HTTP 202，版本冲突与权限使用真实 409/403/401，旧业务仍保留 HTTP 200
业务封装。两个契约集不混用成功判据。

Java 检索探针 `deploy/real-services/Issue19Probe.java` 是验收专用启动源，编译到临时目录，
不加入原 Maven 构建或生产应用。身份来自原 Java `UserService`；受控模式只增加测试 embedding
bean，真实模式使用原生 embedding bean。真实读端及用户过滤仍调用未修改的原实现。
禁用测试环境的 rerank/hybrid，避免把本票扩大为真实重排模型验收。
同时测试 Snowflake 大用户 ID 和小 ID：原 Java 的字符串过滤表达式解析器遇到
`9007199254740993` 会抛出 `NumberFormatException`，当前 `legacyJavaReader=BLOCKED`。
小 ID 的 Python 写→Java 读与归属过滤实测通过；不能用它替代大 ID 兼容验收。

## CI

`.github/workflows/python-real-services.yml` 在相关 PR 上运行真实 MySQL/Redis/Chroma/Java
和受控模型。CI 只在 `infrastructure`、`orchestration`、`mysqlSemantics` 均为 PASS
且全局明确 BLOCKED 时接受受控模式；不能简单忽略入口的退出码 2。
手动启动并勾选 `real_embedding` 时，需配置仓库 `DASHSCOPE_API_KEY` secret，
并要求入口退出 0、真实 embedding 和旧 Java 读端 PASS。缺凭据、供应商拒绝或旧 Java
Long 过滤缺陷未解决时，该 CI job 失败。当前只做本地等价执行，未触发 GitHub 托管 job。
上传 artifact 仅包含安全结果与源码摘要，不上传含账号哈希、SQL 或提供商内容的运行日志。

## 本次结果

2026-10-14 真实服务执行：MySQL 8.0.26、Redis 3.2.100、Chroma Python 包 1.5.9
（服务器 version API 返回 1.0.0）、原 Java 应用、真实 FastAPI TCP API 与独立 Worker。
V1–V22 migrate/validate 以及升级后 Java 启动通过。
真实基础设施、受控模型编排和 MySQL 语义三个 gate 均 PASS；总结果为 BLOCKED。
分类执行 4 次、解释 3 次、聊天 3 次；审批与重放没有增加这些调用或正式保存效果。
正式记录只有本人批准的 1 条，医生复核不隐式建档。
MySQL 并发套件 14 passed、人工等待/重启套件 12 passed；各自使用新的 Flyway 隔离库。

结果与源码摘要见 [真实服务结果](../.scratch/python-agent-migration/evidence/issue19/final/results.json)
和 [运行源码摘要](../.scratch/python-agent-migration/evidence/issue19/final/source-sha256.json)。
CI 等价的空字符串密钥完整运行已通过三个工程 gate，按预期退出 2，
结果见 [CI 空密钥结果](../.scratch/python-agent-migration/evidence/issue19/ci-empty-key/results.json)；
此轮 MySQL 并发 14 passed、人工等待/重启 12 passed，源码摘要与当前源码一致。
2026-10-15 继续复核：固定 Corretto 21 后，DOC 相关 5 项通过；
最终 Web 全量 **720 passed、2 skipped**（476.12 秒，1 项既有 Pydantic warning）。
默认跳过的真实 MySQL 用例不冒充通过；真实 MySQL 专属套件另行执行并记录上述 26 项通过。
原首次全量 718 passed、2 failed、2 skipped，失败为宿主默认 Java 无法执行 Tika，
不是文档解析逻辑变更。类型检查（含未标注函数体）4 文件通过，133 个安装依赖一致性通过。
独立 Standards 首轮 1 项（CI 空字符串密钥），修正后 0 项；Spec 0 项。
机器可读回归摘要见 [regression.json](../.scratch/python-agent-migration/evidence/issue19/regression.json)，
双轴记录见 [审查报告](real-services-review.md)。没有修改前端，未重复执行前端构建。

真实 embedding 预检已返回 HTTP 401；用户明确选择继续执行并保留该阻塞。
旧 Java 大用户 ID 检索另行保留为阻塞。两者均不标为通过，也不修改原 Java 或源 spec。
真实分类权重、真实 LLM、COS、临床、Nginx 切流/部署回退不在本次通过范围。

真实验收发现并修正 `CHROMA_HOST=http://host` 时 Chroma SDK 忽略独立端口的问题。
新增真实 Chroma 回归，使用公开写入/查询/删除边界验证，修复前带协议用例失败、纯主机名
用例通过，修复后两者通过。

MySQL 实测 SQLAlchemy 空写 rowcount=1，Java/Python 的新闻重复保存均返回 code=0。
这是当前驱动配置的匹配行语义；未修改旧 ADR 或业务实现，不能把历史文字中的变化行假设
当作本机实测事实。
