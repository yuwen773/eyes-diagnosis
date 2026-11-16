# 配置边界：部署级 vs 动态级

**基线：** `f42065e4`　**日期：** 2026-11-16
**配套：** `configuration-inventory.md`（逐项证据）、`config-center-adr.md`（决策）

---

## 1. 判定规则

任何配置项进入配置中心之前，先过三问：

1. **改它会不会改变安全边界？**（CORS、Origin 白名单、密钥、鉴权、监听地址）→ 会：`STATIC_POLICY` / `SECRET_REF`，**永不入库**。
2. **改它会不会改变数据/证据语义？**（推理指纹、类别顺序、质量门阈值、缓存键）→ 会：`STATIC_POLICY`，随代码版本走。
3. **改它需不需要重启或重建 Bean？**（线程池、连接、监听端口）→ 需要：`DEPLOY_ONLY`，只登记不可改。

三问都否，才可能进入 `DYNAMIC`。MVP 的 `DYNAMIC` 集合只有 `brand.*` 六个键（见 §3）。

---

## 2. 硬边界清单（不可由数据库覆盖）

| 领域 | 键 | 为什么是硬边界 |
|---|---|---|
| 数据库 / Redis / 会话 | `spring.datasource.*`、`spring.data.redis.*`、`spring.session.*`、`spring.flyway.*` | 配置存储本身依赖它们；写入错误值等于让配置中心把自己锁死 |
| HTTP 形态 | `server.port`、`server.servlet.context-path`、`spring.servlet.multipart.*` | 改端口/前缀会改变全部前端调用与部署拓扑 |
| CORS | `app.cors.allowed-origins` | 一次错误发布即扩大凭据型请求的攻击面；当前无 CSRF 防护兜底 |
| MCP 远程 | `mcp.remote.allowed-origins` | 空=全拒，是 SSRF/远程工具注入的第一道门 |
| 线程池 | `mcp.executor.*`、`document.executor.*`、`agent.queue.parallelism` | 运行中改容量会静默丢弃/排队，且现有实现无 resize 路径 |
| 对象存储 | `cos.client.host/region/bucket` | 决定文件 URL 与删除范围 |
| 密钥 | `cos.client.secretId/secretKey`、`spring.ai.*.api-key`、`eye-diagnosis.vision-recognition.api-key` | 只允许 `SECRET_REF` 引用，任何明文都不入库 |
| 算法服务端点 | `diagnosis.grpc.host/port` | 改错等于让诊断链路指向未知服务 |
| 推理指纹 | `eye-diagnosis.inference.model-version / preprocess-version / model-weight-sha256 / policy-version` | 是 `t_inference_cache` 的键；动态改动会让缓存命中错误结果 |
| 上传补偿 | `eye-diagnosis.upload.compensation.enabled` | 开启后会**真实删除** COS 对象 |
| 语料播种 | `eye-diagnosis.rag.corpus.seed-enabled` | 每次启动触发付费嵌入调用 |
| Python 运行时 | `MODEL_WEIGHTS_PATH`、`MODEL_REGISTRY_PATH`、`MODEL_CALIBRATION_PATH`、`QUALITY_GATE_MODE`、`INFERENCE_POLICY_VERSION`、`MCP_HOST/PORT` | 属于算法服务启动契约；本仓库没有让它们热生效的通道 |
| 算法口径 | 8 类顺序、质量阈值、拒识阈值、OOD、校准参数 | 医学证据链的一部分，改动必须走算法侧评审与版本化，不走配置中心 |

**结论：** 第一期数据库里**只存** `brand.*` 与 Provider 连接**元数据**；其余键一律留在 yml / 环境变量 / 代码默认值里。

---

## 3. 可动态化的范围

### 3.1 MVP 内（`brand.*`）

| 键 | 作用域 | 生效方式 |
|---|---|---|
| `brand.siteName` | 浏览器标题、导航品牌名 | 前端启动时读 `/api/system/brand`，非阻塞改写 |
| `brand.shortName` | 侧栏/页脚短名 | 同上 |
| `brand.logo.light` / `brand.logo.dark` | 全站铭牌、管理端侧栏、认证页 | 前端按主题选择对应 `ASSET_REF` URL |
| `brand.favicon.light` / `brand.favicon.dark` | 浏览器标签图标 | 运行时改写 `<link rel="icon">`（当前 `index.html` 是静态标签，必须新增改写逻辑） |

**边界内的明确不做：**

- 不改变医学风险色、`--signal` / `--risk-*` 语义色、设计令牌。
- 不改变免责声明、示例影像标注、法律文案（见 inventory §4）。
- 不允许通过品牌配置注入 HTML/脚本/SVG（只接受服务端校验过的位图资产）。
- 不把「未发布」的品牌资源暴露到公开站点。

### 3.2 MVP 内（Provider 连接元数据，仅元数据）

允许入库的字段：`displayName`、`providerType`、`baseUrl`、`secretRef`（受控枚举）、`enabledForTesting`、`revision`。

**生效层次（2026-11-16 补）：**

| 层 | 内容 | 谁可见 |
|---|---|---|
| 草稿修订 | 新增/修改的 Provider 连接，`origin = DRAFT` | 管理端草稿视图 |
| 发布快照 | 每个 release 保存 `connectionId → revisionId` 的不可变引用 | 审计、回滚、管理端活跃视图 |
| 修订行 | `t_provider_connection_revision`，只插入不更新 | 被草稿或 release 引用 |

规则：

- **没有直接修改生效连接的写路径**；所有修改先进草稿，随版本发布。
- 连接测试结果绑定具体 `revisionId`；发布只认与草稿引用一致的成功测试。
- 回滚复制目标快照的修订引用，连接元数据随之准确恢复。
- 历史 release 的含义不因后续 Provider 修改而改变。

**明确不做：**

- 不改变 `ChatModel` / `EmbeddingModel` / `RerankModel` / 视觉客户端 / gRPC 客户端的实际构造与执行路径。
- 不接受任意环境变量名；`secretRef` 只能取服务端注册表里的枚举值。
- 响应只返回 `CONFIGURED / MISSING / INVALID_REFERENCE`。

### 3.3 未来（不在本期）

- 统一 `ModelRegistry` / `ModelResolver`：需要先把「自动注入的模型」与「手工构造的模型」统一到一个解析入口（见 `model-callsite-inventory.md`）。
- RAG 检索参数在线调整：当前无刷新机制，且会破坏评估可复现性。
- 多实例一致发布：本期只承诺单实例原子切换。

---

## 4. 读取与降级规则

| 场景 | 行为 |
|---|---|
| 数据库无自定义配置 | 使用 Config Registry 的内置默认值（品牌 = 当前 Iris 资源） |
| 当前发布版本读取失败 / 超时 | 品牌：回退内置默认值并记录一次告警；**不得**回退到未发布草稿 |
| Schema 版本不兼容 | 拒绝加载该版本，公开品牌接口降级内置默认值，管理端报明确错误 |
| 敏感运行能力（未来） | 失败关闭（fail-closed），不得使用默认值继续运行 |
| 品牌资源文件 404 / 损坏 | 回退对应主题的内置资源，不使用另一主题的图片 |
| 公开品牌接口不可用 | 首页**不得**被阻断：前端先渲染内置品牌，配置到达后再替换 |
| Provider 元数据读取 | 管理端只读「活跃版本视图」或「草稿视图」；运行时不读取 Provider 元数据（本期不接执行路径） |
| 历史品牌资产 | 任一已发布 release 引用过的资产仍可公开读取；只有草稿引用的资产对外不可见 |

**优先级（从高到低）：**

1. 部署级安全边界（yml / 环境变量）——数据库永远不能覆盖。
2. 已发布配置版本（数据库）。
3. Config Registry 默认值（代码）。

未发布草稿在任何读取路径上都**不可见**。

---

## 5. 单实例一致性声明

- 本期采用「单活跃版本指针 + 单实例原子切换」。发布事务提交后，该实例的下一次读取即使用新版本。
- **不承诺**多实例间的即时一致；多实例部署时，其他实例的切换时延未定义。
- 不引入配置消息总线、缓存失效广播或分布式锁。若未来需要，单独出 ADR。

---

## 6. 与既有冻结面的交叉约束

| 冻结面 | 约束 |
|---|---|
| Iris 2.1 UI 冻结（`iris-ui-v2.1-freeze-20261115`） | 新增 `/admin/settings/*` 属于新页面；修改 `AdminNav` 增加一级入口、修改 `index.html` 增加 favicon 改写，都需要**单独的解冻例外批准**。**2026-11-16 仅记录申请范围**（`AdminNav` 第七项、`index.html` 的 title/favicon 改写、品牌 Provider 与双主题 logo 接入），**不构成批准**；无正式授权记录前，冻结面一律视为未解冻 |
| 算法 P1 契约（`algorithm/p1/`） | 配置中心不触碰训练/评估协议、类别顺序、权重白名单 |
| 迁移历史 | 只能新增迁移；当前分支止于 V17，多 Agent 分支已占 V18–V28，配置中心**暂定**从 V29 起；WP-01 建表前必须重新核对目标集成分支的迁移目录 |
| 认证 | 现有 `@AuthCheck` 只有 user/admin 两档，`CONFIG_PUBLISH` 等权限必须新增服务端策略，不能靠前端 AdminGate |

---

## 7. 明确禁止的做法

1. 用数据库覆盖任意 `spring.*` / `eye-diagnosis.*` 键（「把 Spring Environment 搬进库」）。
2. 引入 `@RefreshScope` 后全量重建 Bean 来「让配置生效」。
3. 把 CORS / Origin / 密钥 / 线程池 / 推理指纹登记为可编辑项。
4. 以「配置中心」名义改动已冻结页面的视觉或令牌。
5. 在审计或日志里记录明文密钥、患者影像内容、完整模型请求/响应。
6. 提供直接修改生效 Provider 元数据的写路径（必须经草稿与发布）。
7. 用「revision 冲突」冒充幂等：重试语义必须由 `requestId` + 请求指纹 + 结果持久化实现。
8. 让未发布的品牌资产或草稿内容出现在公开端点。
