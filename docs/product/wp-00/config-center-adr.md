# ADR：Iris Control Center 1.0（MVP）架构决策

**状态：** Proposed　**日期：** 2026-11-16　**基线：** `f42065e4`
**输入：** `configuration-inventory.md`、`model-callsite-inventory.md`、`configuration-boundary.md`

---

## 背景

Iris 的配置事实分散在四处：tracked YAML、gitignored 本地 profile、环境变量、代码默认值与硬编码字面量。已确认 22 处多重事实来源或缺口（inventory §6），其中 3 处会直接影响运行行为：混合检索默认值相反、Chroma collection 名不一致、上传上限双口径。

同时，品牌信息（站名、Logo、Favicon）全部是构建期静态资源，改动必须重新构建部署。

PRD 要求：强类型注册、草稿/校验/发布/回滚、审计、品牌资源、Provider 元数据与连接测试，且**不改变现有 Agent 与推理执行路径**。

---

## 决策

### D1. 配置定义只有一个真源：代码内 Config Registry

**决定：** 允许管理的配置项由 Java 代码显式注册（`ConfigDefinition`），数据库只存「已发布的值」，不存定义。

**理由：**

- 现有配置的真实默认值都在代码里（`@Value` 默认值、`@ConfigurationProperties` 字段初始化）；把定义搬进数据库会立刻产生第二个真源。
- 类型、校验、敏感级、可变性属于代码契约，改它们应当走 PR/评审，而不是后台点击。
- 未知键必须拒绝（AC-01-02），只有代码注册表能给出完备集合。

**替代方案与否决理由：**

- 数据库存 schema：可在后台加键 → 等于允许绕过代码评审改变契约，否决。
- 扫描 Spring `Environment` 自动导入：会把 `spring.datasource.*`、`cos.client.secretKey` 一并暴露，直接违反边界文档，否决。

**后果：** 新增配置项需要发版；这是有意的成本。

---

### D2. 发布是不可变快照 + 单活跃指针

**决定：** `t_config_release` 只插入不更新；`t_config_active_pointer` 单行，保存当前 release id；发布事务内「插入 release → 更新指针 → 写审计」。

**快照必须自包含：** release 快照除了 `brand.*` 的值，还要保存本次发布引用的 **Provider 连接修订 ID 列表**（`connectionId → revisionId`）。回滚生成新 release 时，复制的是目标快照里的这些引用，因此回滚能准确恢复当时的连接元数据（见 D7）。

**理由：**

- 回滚语义要求历史不可变（PRD FR-02）。
- 单实例原子切换可以用一个事务完成，不引入额外中间件。
- 与现有 `t_news_audit` 同事务写审计的先例一致（`NewsLifecycleService.java:235`）。

**替代方案与否决理由：**

- 原地更新配置表 + 历史表：回滚会变成「恢复旧行」，与不可变要求冲突。
- 事件溯源：MVP 过重。

**后果：** 需要定期归档旧 release；MVP 不做自动清理（AC-04-06 要求旧资产在仍被引用时不得删除）。

---

### D3. 草稿是单例 + revision 乐观锁

**决定：** 全局只有一份草稿；每次编辑 `revision + 1`；校验结果绑定 `revision`；发布必须携带匹配的 `revision` 与 `expectedActiveReleaseId`。

**理由：**

- 满足 AC-02-04（过期 revision 不得覆盖）与 AC-02-05（重复提交不产生重复版本）。
- 多草稿合并需要三方 diff 与冲突解决，MVP 不值得。

**后果：** 两个管理员不能并行编辑不同配置分区；UI 必须提示「他人正在编辑」并在 409 时刷新。

---

### D4. 审计与发布同事务，审计只追加

**决定：** `t_config_audit_event` 与 release/pointer 在同一数据库事务内写入；审计表不提供更新/删除接口；普通管理员只能读。

**理由：** PRD FR-03 明确「禁止配置已发布但没有成功审计」。同库同事务是唯一不引入分布式一致性的实现方式。

**审计内容约束：** 只记录 `eventId/actorId/action/targetId/requestId/beforeVersion/afterVersion/result/reasonCode/occurredAt` 与字段级 diff；不记录密钥、患者数据、完整模型请求/响应。

---

### D5. 品牌资源独立于现有上传管线

**决定：** 新建 `t_brand_asset` 与专用 `BrandAssetService`；不复用 `FileManager`。

**理由：**

- `FileManager` 只校验扩展名与 2 MiB 上限（`manager/FileManager.java:97-106`），不满足 PRD「按真实文件内容验证」。
- `t_upload_task` 是用户诊断图片的状态机（`UploadStatus`），语义不同，混用会污染补偿对账。
- 品牌资产需要「内容哈希寻址 + 不可变 + 发布前不可公开」三件事，现有管线都不提供。

**存储选择：** 沿用腾讯 COS（已有客户端与凭据），对象 key 用 `sha256` 前缀；公开访问走后端代理端点（`/system/brand/assets/{id}`），避免暴露 bucket 结构，也便于回退与缓存头控制。

**校验规则：** PNG/WebP（Logo）、PNG/ICO（Favicon）；按 magic bytes + 解码结果双重校验；拒绝 SVG/远程 URL/可执行内容；限制字节数、像素总量与边长。

**保留与访问策略（2026-11-16 补）：**

- 资产不可变、按 `sha256` 寻址；同一内容重复上传复用同一 Asset ID。
- 公开读取端点服务于**任何已发布 release 引用过的资产**，不只是当前活跃版本——历史页面与旧 URL 不会 404。
- 只被草稿引用的资产对公开端不可见，仅管理员可读。
- 被任一 release 引用过的资产**永不删除**（AC-04-06）。
- 从未被任何 release 引用的上传（草稿残留、孤儿）可由维护任务在超过保留期后清理；MVP 不自动清理，只提供查询。

---

### D6. 权限是服务端动作策略，不是新数据库角色

**决定：** 新增 `@ConfigPermission(action)` AOP；MVP 的「发布者」由部署期白名单（管理员 userId 列表，yml 配置）判定，`CONFIG_READ/EDIT/VALIDATE/TEST_CONNECTION` 授予所有 admin。
**裁决（2026-11-16）：** 采用本方案，不新增 `t_config_grant` 表。

**理由：**

- 现有 `UserRole` 只有 `user/admin`，`AuthInterceptor` 只判「是否 admin」（`aop/AuthInterceptor.java:41-64`）。
- PRD §2.1 明确第一期不强制引入新数据库角色。
- 白名单放 yml 意味着「谁能发布」由部署控制，符合「部署级安全边界不可被数据库覆盖」。

**后果：** 增加发布者需要改配置并重启；若将来发布者数量增长，再引入 `t_config_grant` 表并单独评审。

---

### D7. Provider 连接只做元数据，不接执行路径

**决定：** Provider 连接元数据**只能通过草稿修改、随配置版本发布**，不存在「直接改当前生效连接」的写路径；模型客户端构造代码**一行不改**。

**修订语义（2026-11-16 补）：**

- `t_provider_connection` 只保存稳定身份（`connectionId`、`providerType`、`createdAt`）；所有可展示、可修改的字段放进**不可变的修订行** `t_provider_connection_revision`（`revision`、`displayName`、`baseUrl`、`secretRef`、`enabledForTesting`、`contentDigest`）。
- 草稿阶段的新增/修改 = 插入一条 `origin = DRAFT` 的新修订行；已发布的修订行永不更新。
- 草稿 payload 记录 `providerRevisions: [{connectionId, revisionId}]`；发布快照原样保存这份引用（D2）。
- 连接测试结果绑定 `revisionId`（`t_provider_connection_test`）；发布时只认与草稿引用**完全一致**的 revision 的成功测试，过期结果不可用（AC-08-08）。
- 回滚复制目标快照的 `revisionId` 引用，因此能准确恢复当时的连接元数据。
- 无论是否发布，本期都**不改变** `ChatModel` / `EmbeddingModel` / `RerankModel` / 视觉客户端 / gRPC 客户端的构造与执行路径。

**理由：**

- 当前模型客户端分两类：Spring AI 自动配置注入（`ChatModel`、`EmbeddingModel`、`RerankModel`）与手工构造（`EyeImageAnalyzerTool` 内的 `OpenAiApi` + `OpenAiChatModel` + `ChatClient`）。任何「后台切换模型」都必须同时拦截这两类，MVP 做不到也不该做。
- 若允许直接 `POST/PUT /providers`，会出现「release V12 仍指向已变形的 Provider」的悬空引用，违反 D2 的不可变快照语义。
- PRD G6 只要求预留结构。

**预留点：** 未来引入 `ModelResolver` 时，只需让上述两类构造都经过同一个解析入口；本期不做接口占位类，避免「只有名字没有调用」的假实现（见 `model-callsite-inventory.md` §5）。

**连接测试安全：** 目标地址必须命中部署侧白名单；解析后校验 IP 不属于环回/内网/链路本地/云元数据段；禁止跟随重定向到白名单外；固定超时、响应大小上限、并发与频率限制。

---

### D8. 公开品牌读取非阻塞 + 内置回退

**决定：** `GET /system/brand` 可失败；前端先用内置品牌渲染，配置到达后替换；服务端读取失败返回内置默认值并标 `source: "BUILTIN"`。

**理由：** PRD 非功能要求「公开品牌配置读取不应成为首页的阻断依赖」，且 AC-04-05 要求失败回退。

**实现注意：** 当前 `web/index.html` 的 title/favicon 是静态标签（`web/index.html:6,18`），Logo 由 `Wordmark.tsx` 硬编码路径 + CSS 主题切换（`Wordmark.tsx:19-29`、`app.css:279-285`）。运行时替换需要新增一个品牌 Provider，并在 `index.html` 增加 `<link>` 改写逻辑。

**缓存策略（2026-11-16 补）：** 发布配置、失败回退与不可变图片必须分开定义。

| 资源 | 响应头 | 理由 |
|---|---|---|
| `GET /system/brand`（`source: PUBLISHED`） | `Cache-Control: no-cache` + 弱 `ETag` | 发布即变；允许条件请求，但每次都要校验 |
| `GET /system/brand`（`source: BUILTIN`） | `Cache-Control: max-age=30, stale-while-revalidate=300` | 故障期短缓存，恢复后快速切回真实配置；不得把回退结果当长期缓存 |
| `GET /system/brand/assets/{id}` | `Cache-Control: public, max-age=31536000, immutable` + 强 `ETag` | 内容哈希寻址，内容永不变 |
| 反向代理 / CDN | 不得缓存带 `source: BUILTIN` 的响应作为发布配置 | 防止故障期默认值被固化为长期品牌 |

---

### D9. Flyway 版本从 V29 起

**决定：** 本分支新增迁移从 `V29` 开始编号。

**理由：** 本分支当前止于 V17；多 Agent 分支 `6ba65478` 已占 V18–V28（`V18__diagnosis_task` … `V28__agent_tool_audit`）。从 V29 起可避免两条线合并时版本撞车。

**约束：** 只新增迁移，不修改已执行迁移；配置中心表与既有表同库同 schema（`diagnosis`）。

**WP-01 建表前必做：** 重新核对目标集成分支（`6ba65478` 及其后续提交）的 `src/main/resources/db/migration/`，确认 V29 仍空闲。若已被占用则顺延；**不得**把本文档的编号当作已核实的事实。

---

### D10. UI 变更需要单独的解冻例外

**决定：** `/admin/settings/*` 作为**新页面**实现，复用 `AdminLayout`/`AdminNav` 与现有令牌；但修改 `AdminNav` 增加第七项、修改 `index.html` 增加 favicon 改写，属于冻结面变更，必须在 WP-04 前取得解冻例外批准。

**理由：** `DESIGN.md` 2026-11-15 冻结条明确管理端外壳在冻结范围内；`AdminNav.tsx` 是外壳的一部分。

**例外范围建议（2026-11-16，待正式授权记录）：** 三项——`AdminNav` 新增第七项、`index.html` 的 title/favicon 运行时改写、品牌 Provider 与双主题 logo 接入。

> **授权口径：** 本文档只记录拟申请的范围，**不构成解冻批准**。WP-04 开始前必须有独立的授权记录（授权人、日期、范围、失效条件），并写入 `DESIGN.md` 冻结条或等价位置；没有该记录时，冻结面一律视为未解冻。

**后果：** WP-04 不能作为 WP-01 的附带产物悄悄开始；例外清单之外的冻结面仍不可动。

---

### D11. Same-Origin 校验由配置中心自带（含完整安全契约）

**决定：** 在配置中心模块内实现独立的 Same-Origin 校验 + CSRF Token 双重防护，覆盖 `/admin/control-center/**` 的**全部状态改变请求**。

**理由：**

- 本分支没有任何 CSRF / Same-Origin 过滤器（全仓 `csrf` 无命中），`CorsConfig` 只约束跨域读取。
- 多 Agent 分支 `6ba65478` 的 `SameOriginFilter` 未合并，不能作为 WP-01 的前置依赖。
- 当前认证是 Cookie Session，单靠宽松 Referer 判断不足以抵抗 CSRF。

**规则（实现不得自行选择）：**

| # | 规则 | 行为 |
|---|---|---|
| 1 | `Origin` 与 `Referer` **都不存在** | 拒绝（`40300`），不得放行 |
| 2 | 存在 `Origin` | 严格比较 **scheme + host + port**（规范化后逐段相等）；不允许通配子域、不允许后缀匹配 |
| 3 | 只有 `Referer` | 解析出 origin 后按规则 2 比较；Referer 无法解析为绝对 URL 时拒绝 |
| 4 | `Origin: null`（沙箱 iframe、`file://`、部分重定向） | 拒绝 |
| 5 | 反向代理 | 可信外部 Origin 只能来自部署配置的显式白名单（`control-center.allowed-origins`）；**不得**仅凭 `Host` / `X-Forwarded-Host` 推断。只有确认代理会覆写这些头时才启用 `ForwardedHeaderFilter` |
| 6 | 覆盖范围 | POST / PUT / PATCH / DELETE 全部覆盖：草稿创建与修改、校验、发布、回滚、资产上传、Provider 创建/修改、连接测试。GET 不要求 Origin，但审计读取仍走鉴权 |
| 7 | CSRF Token | 写请求必须携带 `X-CSRF-Token`，与服务端 session 绑定的 double-submit cookie 一致；token 在登录/会话建立时下发（`GET /admin/control-center/csrf`），会话失效即失效 |
| 8 | Cookie 属性 | Session Cookie 显式设置 `SameSite=Lax`（当前未显式设置），`HttpOnly`，生产 `Secure` |
| 9 | 失败响应 | 统一 `40300`，审计记录 `reasonCode`（`ORIGIN_MISSING` / `ORIGIN_MISMATCH` / `ORIGIN_NULL` / `CSRF_MISSING` / `CSRF_MISMATCH`），不记录请求体 |

**验收用例（独立于功能测试）：**

- 无 Origin 无 Referer 的写请求 → 40300，且不产生任何写入。
- `Origin: https://evil.example` → 40300。
- `Origin: http://same-host` 而实际为 `https` → 40300（scheme 不一致）。
- `Origin: https://same-host:8443` 而实际端口不同 → 40300。
- `Origin: null` → 40300。
- 合法 Origin 但缺 `X-CSRF-Token` → 40300。
- 合法 Origin + 合法 token → 放行；同一 token 在会话失效后 → 40300。
- 代理场景：只配 `Host` 头、不配白名单 → 拒绝。

**后果：** 若两个分支都合并，仓库里会短暂存在两份校验逻辑；届时评估收敛为同一实现。收敛前，配置中心的校验必须独立可测。

---

### D12. 写操作以 `requestId` 做显式幂等

**决定：** 发布、回滚以及所有会产生业务写入的 POST/PUT/DELETE，都接受客户端生成的 `requestId`；服务端持久化「请求指纹 → 结果」，重试返回原结果。

**规则：**

| 场景 | 行为 |
|---|---|
| 同 `actorId` + 同 `requestId` + 同请求指纹 | 直接返回首次结果（不重复执行），响应头标记 `Idempotent-Replay: true` |
| 同 `actorId` + 同 `requestId` + 不同请求指纹 | 拒绝，`40908 CONFIG_IDEMPOTENCY_MISMATCH` |
| 不同 `requestId` + 过期 revision / 活跃版本 | `40900 CONFIG_VERSION_CONFLICT`（并发冲突，不是幂等重放） |
| 首次请求事务已提交但响应丢失 | 重试命中幂等记录，返回首次发布结果（release id / releaseVersion） |

**实现要点：**

- `t_config_request` 以 `(actorId, requestId)` 唯一约束；`requestDigest` 为「方法 + 路径 + 规范化请求体」的哈希。
- 幂等记录与业务事务**同事务写入**；插入冲突（唯一键）即判定为并发重试，读取已有记录后按上表返回。
- `requestId` 缺失：发布/回滚直接拒绝（`40000`）；其余写操作可选，但服务端在响应中回显生成的 id。
- 幂等记录保留期与审计一致（MVP 不自动清理）。

**验收用例：**

- 发布成功后立刻用同一 `requestId` 重放 → 返回同一 release，不新增版本。
- 同一 `requestId` 改一个字段重放 → 40908。
- 并发两个相同 `requestId` → 只产生一个 release，另一个返回同一结果。
- 回滚重试 → 不产生第二个回滚版本。
- 事务提交后模拟响应丢失（测试钩子）→ 重试可拿到首次结果。

---

## 数据模型（建议）

| 表 | 关键列 | 说明 |
|---|---|---|
| `t_config_release` | `id`, `releaseVersion`, `schemaVersion`, `payload` JSON, `digest`, `rollbackFromReleaseId`, `createdBy`, `createdTime` | 不可变 |
| `t_config_active_pointer` | `id`（恒 1）, `releaseId`, `updatedTime` | 单行 |
| `t_config_draft` | `id`, `revision`, `status`, `payload` JSON, `updatedBy`, `updateTime`, `validationRevision`, `validationResult` JSON | 单例草稿 |
| `t_brand_asset` | `id`, `kind`, `contentType`, `byteSize`, `width`, `height`, `sha256`, `objectKey`, `createdBy`, `createdTime` | 内容哈希唯一；**永不原地覆盖** |
| `t_provider_connection` | `id`, `providerType`, `createdBy`, `createdTime` | 只存稳定身份，无可变字段 |
| `t_provider_connection_revision` | `id`, `connectionId`, `revision`, `displayName`, `baseUrl`, `secretRef`, `enabledForTesting`, `contentDigest`, `origin`（`DRAFT`/`RELEASE`）, `draftId`, `createdBy`, `createdTime` | **只插入不更新**；发布只引用，不改行 |
| `t_provider_connection_test` | `id`, `revisionId`, `result`, `reasonCode`, `latencyMs`, `checkedAt`, `checkedBy` | 结果绑定具体修订；无密钥 |
| `t_config_request` | `actorId`, `requestId`, `requestDigest`, `action`, `resultCode`, `resultPayload` JSON, `createdTime` | `(actorId, requestId)` 唯一；幂等依据 |
| `t_config_audit_event` | `eventId`, `actorId`, `action`, `targetId`, `requestId`, `beforeVersion`, `afterVersion`, `result`, `reasonCode`, `payload` JSON, `occurredAt` | 只追加 |

命名遵循仓库约定：列名小驼峰，MyBatis Plus `map-underscore-to-camel-case: false`。

---

## 已裁决（2026-11-16）

- **Same-Origin 校验**：配置中心自带 + CSRF Token 双防护（D11），不等多 Agent 分支。
- **发布者白名单**：yml 部署期配置（D6），不新增授权表。
- **Provider 语义**：只经草稿修改、随版本发布；修订行不可变；测试绑定修订（D7）。
- **幂等**：`requestId` + 请求指纹 + 结果持久化（D12）。
- **品牌资产保留**：任一 release 引用过的资产永不删除；公开端点服务历史已发布资产（D5）。
- **缓存**：发布配置 / BUILTIN 回退 / 不可变图片分开定义（D8）。
- **品牌资产访问方式**：后端代理，不直连 COS（D5）。
- **WP-04 解冻范围**：**仅为申请建议，尚未获得授权**——`AdminNav` 第七项 + `index.html` title/favicon 改写 + 品牌 Provider 与双主题 logo 接入（D10）。

## 未决问题（需在 WP-01 前答复）

1. **favicon 双主题默认值**：当前只有一张 `iris-favicon.ico`，`brand.favicon.dark` 的默认值先指向同一文件是否可接受？
2. **审计与幂等记录保留期**：MVP 不清理；需产品确认保留年限。
3. **WP-04 解冻授权记录**：授权人、日期、范围、失效条件，需写入冻结条或等价位置（见 D10）。
