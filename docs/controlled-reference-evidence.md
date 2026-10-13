# 工单 08：受控诊断参考资料

实施范围：`worktree-py-rewrite`；审查基点 `51cfc3636a2325b9e5a2ecae5de1088ebdfb70ea`。
Java 源码、构建配置、源 spec 保留。

## 准入与授权

V19 为知识文档增加 visibility、reviewStatus、diseaseCodes、topicCodes、governanceVersion、
reviewedBy、reviewedAt，为任务输入增加 evidenceSnapshot。旧资料和新上传均默认
PRIVATE_USER + PENDING；旧编码为 NULL，API 显示空列表。部署前先运行独立 Flyway 升级，
应用启动不执行 DDL。

管理员在 `/admin/knowledge` 编辑审核属性。写请求必须携带 confirmed=true 和当前
expectedVersion；行锁与版本阻止并发覆盖，前端属性变更后清除确认。审核通过要求索引完成、
疾病和主题编码非空。医生质量复核与资料管理、用户保存授权相互独立。

正式检索从 MySQL 筛选未删除、索引完成、CURATED_PUBLIC + APPROVED、疾病和主题均匹配
的资料，再用 documentId 的 `$in` 过滤 Chroma 查询。MySQL 持有受控属性，既有向量无需
改写或重嵌入。返回片段还必须匹配 MySQL 归属、来源、文档和合法片段 ID；错误类型或
缺失元数据被拒绝。旧 Java 的 ownerUserId、collection、embedding、chunk ID 契约保留。

查询只来自通过门禁的推理包，默认主题沿用 release 的 DISEASE_OVERVIEW，不采用患者自由
文本决定范围。沿用 release 的六疾病/六主题目录；模型标签 diabetes、hypertension、other
没有明确临床映射时按 UNSUPPORTED_EVIDENCE_CODE 报不足，不自动扩充或改名。

私人问答独立使用 `/knowledge/search`，只允许当前已验证用户的资料，拒绝隔离、撤回、审核
拒绝、删除、未完成索引的资料。其结果不进入正式诊断证据。对话工具/MCP 注册由工单 14
处理，本票不扩大工具执行范围。

## 图与追踪

通过质量与可靠性门后执行：

`visionExposure → evidenceRetrieval → [不足时 evidenceRewrite] → evidenceValidation`

查询最多改写一次，只改变文本，不改变疾病/主题、审核条件、访问范围或启用网页搜索。
当前单疾病、单主题意图以至少一个合法引用判定检索充分性，这不是临床充分性判断。
检索不可用、无片段或来源失效均不伪造成功。图校验不足进入
COMPLETED_LIMITED / EVIDENCE_INSUFFICIENT；有证据进入既有解释未接入检查。解释生成、
声明校验和发布属于工单 09；本票仍为 result=null、patientVisible=false。

引用保存文档/片段 ID、审核版本、标题、稳定对象来源、内容 SHA-256。内部快照包含引用
文本，任务 API 仅展示追踪信息。Worker 沿用租约/版本 fence 同事务提交快照与 checkpoint。
检索后、图校验、提交和读取任务时再次核对来源；撤回、隔离、删除、审核版本变化后任务页
隐藏引用。后续解释发布必须在自身发布门重新核对证据。旧图 checkpoint 拒绝静默恢复。

## API（均以 `/api` 为前缀）

| 路径 | 用途 |
| --- | --- |
| GET /knowledge/admin/catalog | 管理员读取受控目录 |
| POST /knowledge/admin/documents | 管理员分页查询资料 |
| PATCH /knowledge/admin/documents/{document_id} | 管理员确认审核及元数据 |
| POST /knowledge/search | 独立检索本人资料，query 长度 1–1000 |
| GET /diagnosis/workflows/{workflowId} | 所有者读取 evidence 状态、次数、引用 |

新管理路径返回 422 参数校验、404 不存在、409 版本冲突；身份桥和 BizError 权限信封沿用
既有规则。旧知识端点兼容，列表追加属性。默认 CORS 增加 PATCH 支持跨端口开发环境。

## 验证与门禁

使用真实文本/PDF 解析、HTTP、LangGraph、checkpoint、Worker、Vue 和 Chromium；SQLite、
Java 身份、COS、embedding、Chroma、模型结果为受控替身。

- API 覆盖默认私有待审、非管理员拒绝、确认/版本、受控编码、允许/拒绝集合、私人隔离、
  PDF、恶意向量元数据、一次改写、图校验前撤回、刷新后撤回和 CORS 预检。
- UI 验证引用与刷新、证据不足、管理员确认撤回、撤回后隐藏引用、普通用户拒绝管理页；
  页面错误为 0。截图/JSON 在 `.scratch/python-agent-migration/evidence/issue08/`。
- 执行 Python Web 全套、前端全套、mypy、Vue 类型检查、生产构建、uv pip check。

2026-10-13 受控结果：Python Web 513 passed；前端 29 passed；mypy 12 个目标文件通过；
Vue 类型检查与生产构建通过；uv pip check 验证 127 个包兼容。构建保留既有大 chunk 提示。

真实 MySQL V19 升级、Redis/Chroma、Java 会话、embedding/模型权重、临床目录、部署回退
未由以上结果证明。未对业务数据库执行审核或资料发布。V19 必须先在隔离真实环境验证；
回退保留新增列及数据，不删除表或重写 Flyway 历史。

一手 API 参考：[Chroma metadata filtering](https://docs.trychroma.com/docs/querying-collections/metadata-filtering)、
[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)。
