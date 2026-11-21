# Phase 0 审计结论

**基线：** `f42065e4c38a94f4d1acd81f7cdbe15ad9c7f683`　**日期：** 2026-11-16
**交付物：** `configuration-inventory.md`、`model-callsite-inventory.md`、`configuration-boundary.md`、`config-center-adr.md`、`mvp-api-contract.md`、本文件

---

## 1. 结论

**PASS_WITH_MINOR（有条件通过）** —— 三项原始 P0 与三项新增契约 P0（Provider 发布语义、发布幂等、Same-Origin 安全契约）均已裁决并写入文档。按本轮定向修订后的口径，**WP-01 可标记为 `READY_FOR_IMPLEMENTATION`**。

**条件与范围：**

- 本结论**只覆盖固定基线 `f42065e4`**。不得据此宣称「未来集成后的配置与模型调用链路已全部审计」——多 Agent 分支合入前必须补审（§8）。
- P1 项按对应工作包逐项关闭；未关闭前不得进入对应 WP。
- 两项运行时安全风险（§5.1）独立跟踪，不因 WP-00 通过而放行生产。
- **边界不变：** 不立即开发、不修改冻结 UI（无正式授权记录）、不合并多 Agent 分支、不部署。

> 修订历史：初版结论 `BLOCKED`（权限 / CSRF / 发布者载体三项假设与代码不符）；第二次修订后为 `PASS_WITH_MINOR`；本次（第三次）补齐 Provider 发布语义、幂等与 Same-Origin 细则后维持 `PASS_WITH_MINOR`，WP-01 转 READY。

---

## 2. 准入条件逐条核对

| # | 准入条件 | 结果 | 依据 |
|---|---|---|---|
| 1 | 配置项盘点覆盖预定代码范围 | ✅ 通过（有声明缺口） | Java 55 键 / Python 17 键 / React 1 环境变量；未覆盖 gitignored profiles 与多 Agent 分支，已在清单 §8 声明 |
| 2 | 模型调用入口有可复核的代码证据 | ✅ 通过 | `model-callsite-inventory.md` §1、§6，每行带 `file:line` |
| 3 | 重复配置来源已识别并提出处理原则 | ✅ 通过 | 22 条缺口（Java 15 / Python 6 / 前端 1），处理建议见清单 §6 |
| 4 | 不可动态配置的字段有显式说明 | ✅ 通过 | `configuration-boundary.md` §2 硬边界清单 |
| 5 | MVP 与未来 Model Router 的责任边界明确 | ✅ 通过 | ADR D7；`model-callsite-inventory.md` §2 登记四个接入点 |
| 6 | 数据库迁移、认证机制、UI 冻结约束已核对 | ✅ 通过 | 迁移 V18–V28 已被多 Agent 占用 → 配置中心**暂定** V29 起（建表前复核）；认证只有 user/admin；冻结 tag `iris-ui-v2.1-freeze-20261115` |
| 7 | 不存在尚未解决的 P0/P1 架构阻塞问题 | ✅ 通过（P0 已裁决） | §3 六项 P0（三项原始 + 三项新增契约）已关闭；P1 按对应工作包推进 |
| 8 | 不得宣称覆盖未来集成分支 | ✅ 已声明 | §8 范围声明：结论仅对 `f42065e4` 生效 |

---

## 3. P0（已于 2026-11-16 裁决并关闭）

### P0-01 细粒度权限不存在

**事实：** `UserRole` 只有 `USER` / `ADMIN`（`model/enums/UserRole.java:7-8`）；`AuthInterceptor` 只判断「是否 admin」（`aop/AuthInterceptor.java:41-64`）。PRD 要求的 `CONFIG_PUBLISH` / `CONFIG_ROLLBACK` / `CONFIG_AUDIT_READ` 没有任何落点，前端 `AdminGate` 也不构成服务端授权。

**影响：** FR-03、AC-03-02、AC-03-03 无法满足。

**建议方案：** ADR D6 —— 新增 `@ConfigPermission(action)` 服务端策略；MVP 的发布/回滚权限由部署期 yml 白名单（管理员 userId 列表）授予，其余 `CONFIG_*` 授予所有 admin。

**裁决（2026-11-16）：** 采用 yml 白名单。发布者名单是部署级配置，改名单需改配置并重启；不新增 `t_config_grant` 表，也不做后台自助授权。

### P0-02 CSRF / Same-Origin 防护不存在

**事实：** 仓库内没有任何 CSRF 或 Same-Origin 过滤器（全仓 `grep -i csrf` 无命中；`config/` 下无 `SameOrigin*`）。`CorsConfig` 只约束跨域读取，不能阻止跨站表单提交。多 Agent 分支 `6ba65478` 才有 `config/SameOriginFilter.java`，且未合并。

**影响：** PRD §2.2「敏感写操作继续执行 CSRF/Origin 等既有安全检查」的前提不成立；AC-03-06 无法验证。

**建议方案：** 配置中心自带一个独立的 Same-Origin 校验（校验 `Origin`/`Referer` 与允许主机一致），作用于所有 `/admin/control-center/**` 写端点；不依赖未合并分支。

**裁决（2026-11-16）：** 配置中心自带独立的 Same-Origin 校验，只作用于 `/admin/control-center/**` 写端点，不依赖 `6ba65478`。该分支合并后再评估是否收敛为同一实现。

### P0-03 发布者权限载体未定

**事实：** 与 P0-01 同源，但影响数据模型：若用 yml 白名单，`t_config_*` 表里没有授权事实；若用表，需要新增迁移与授权审计。

**影响：** 决定 V29 迁移的内容与 API 契约 §6 的第 2 步。

**裁决（2026-11-16）：** 与 P0-01 同一裁决——yml 白名单。V29 迁移不包含授权表。

### P0-NEW-01 Provider 配置的发布语义未统一

**事实：** ADR 原稿把 `ProviderConnection` 描述为可修改的元数据，API 契约同时提供 `POST /providers`、`PUT /providers/{id}` 直接修改；但发布前置条件又要求「本次变更涉及的 Provider 必须通过测试」。两条路径合在一起会出现：release V12 仍指向已被直改的 Provider，历史快照与回滚都无法复现当时的连接元数据。

**影响：** 违反 D2 的不可变快照语义；AC-06-06（历史快照可追溯）与 AC-02-06（回滚准确）无法满足。

**处置（已写入契约）：**

- Provider 只能通过草稿新增/修改；每次修改生成一条不可变修订行（`t_provider_connection_revision`）。
- 发布快照保存 `connectionId → revisionId` 引用；回滚复制引用。
- 连接测试结果绑定 `revisionId`；发布只认与草稿引用一致的成功测试。
- 移除 `/providers` 的直接写路径，改为 `/drafts/{id}/providers`。

**落点：** ADR D2/D7、API 契约 §3.3/§3.4、边界文档 §3.2。
**状态：** CLOSED（契约层）。实现验收见 AC-06-06、AC-08-08。

### P0-NEW-02 发布幂等机制不严谨

**事实：** 原契约以「草稿 revision + 当前活跃版本」作为幂等键。发布已提交但响应丢失时，重试只会得到 `40900`，客户端无法判断首次发布是否成功。

**影响：** AC-02-05（重复提交不产生重复版本）可满足，但「网络超时后确认结果」这一真实场景无法满足；回滚重试同样存在。

**处置（已写入契约）：**

- `requestId` 为显式幂等标识；服务端以 `(actorId, requestId)` 唯一约束持久化「请求指纹 → 结果」。
- 同 ID 同内容 → 返回首次结果（`replayed: true`）；同 ID 异内容 → `40908`；异 ID + 过期版本 → `40900`。
- 幂等记录与业务事务同事务写入。
- 验收用例：响应丢失后重试、并发相同 ID、同 ID 改内容、回滚重试、事务提交后重放。

**落点：** ADR D12、API 契约 §1/§3.3/§5、数据模型 `t_config_request`。
**状态：** CLOSED（契约层）。

### P0-NEW-03 Same-Origin 防护缺少安全契约

**事实：** ADR D11 只写了「配置中心自带」，没有规定缺头、`null`、scheme/port、代理、覆盖范围等行为，实现方可以自行选择宽松路径。

**影响：** 无法形成可验证的安全验收；Cookie Session 下仍有 CSRF 面。

**处置（已写入契约）：**

- 九条规则：双头缺失拒绝、严格 scheme+host+port、`Origin: null` 拒绝、代理只认部署白名单、覆盖全部写请求、CSRF Token double-submit、`SameSite=Lax`、统一 `40300` + `reasonCode`。
- 八条独立安全验收用例（见 ADR D11）。

**落点：** ADR D11、API 契约 §6、边界文档 §7。
**状态：** CLOSED（契约层）。

---

## 4. P1（对应工作包开始前必须解决）

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| P1-01 | 品牌资产不能复用现有上传校验 | `manager/FileManager.java:97-106` 只查扩展名 + 2MiB；`AgentImageUploadService.java:44,55` 同理 | AC-04-03/04（伪装扩展名、超限图片） | 新建 `BrandAssetService`，magic bytes + 解码 + 像素上限（ADR D5） |
| P1-02 | 前端没有运行时品牌注入点 | `web/index.html:6,18` 静态 title/favicon；`Wordmark.tsx:19-29` 硬编码双主题位图；`AdminNav.tsx:47-57` 管理端标 | AC-04-01/02、AC-05-01~03 | 新增品牌 Provider + `<link>` 改写；Logo 从配置取 URL |
| P1-03 | 改动冻结面需要解冻例外 | `DESIGN.md` 2026-11-15 冻结条；`AdminNav.tsx` 属管理端外壳 | AC-07-01/07 | WP-04 前取得**正式授权记录**（授权人/日期/范围/失效条件）；本文档只记录申请范围，**方案讨论不等于批准** |
| P1-04 | Flyway 版本冲突 | 本分支止于 V17；`6ba65478` 已占 V18–V28 | 合并即撞车 | 暂定 V29 起（ADR D9）；**WP-01 建表前重新核对目标集成分支的迁移目录**，不得沿用旧结论 |
| P1-05 | tracked yml 含凭据占位字面量 | `application.yml:99` | 误部署时视觉调用静默失败 | 改为 `${DASHSCOPE_API_KEY}`（与 server 示例一致） |
| P1-06 | 本地未入库文件含真实凭据 | 主检出 `src/main/resources/application-local.yml`（本工作树不存在，未复制） | 凭据泄露面 | 轮换并改为环境变量；不要复制进工作树 |
| P1-07 | 运行时模型 ID 不可从 tracked 源码证明 | `application.yml` 无 `spring.ai.*`；`local,dev` profile 未入库 | CFG-AUDIT-02 的「真实凭据来源」只能部分证明 | 在部署文档登记生效 profile 与环境变量清单 |
| P1-08 | 公开品牌接口可能阻断首屏 | PRD 非功能要求 | 首页可用性 | 前端先用内置值渲染，配置到达后替换（ADR D8） |
| P1-09 | 品牌读取失败的回退必须与现有主题机制共存 | `web/index.html:21-33` 防 FOUC 脚本；`theme-provider.tsx:156-167` | 主题切换时不能残留错误主题资源 | 回退按主题各取内置资源，不跨主题复用 |
| P1-10 | 品牌资产历史访问策略未定义 | 初版契约只允许「当前发布引用」的资产可读 | 历史页面 / 旧 URL 会 404；AC-04-06 | 契约已定：任一 release 引用过的资产可读且永不删除（ADR D5）；待实现 |
| P1-11 | 公开品牌接口的缓存规则不足 | 初版只写了「可缓存」 | 发布后旧值滞留 / 回退值被长期缓存 | 契约已定：PUBLISHED / BUILTIN / 图片三类分开（ADR D8、API §2）；待实现 |
| P1-12 | 多 Agent 分支未做全量配置审计 | 仅定点扫描 `6ba65478`（`model-callsite-inventory.md` §4.2） | 集成后模型入口与配置清单不完整 | 合并前补审全量配置与模型调用；未补审前不得宣称已覆盖 |

---

## 5. P2（登记，不阻塞）

| # | 问题 | 证据 |
|---|---|---|
| P2-01 | Java 15 条配置缺口（死键、缺 yml、默认值冲突） | `configuration-inventory.md` §6 Java 表 M1–M15 |
| P2-02 | Python 6 条缺口（registry 白名单为空、MCP 端口冲突、双类别顺序、无 gRPC 大小上限、安全门偏软、SHA 必填性不一致） | 同上 §6 Python 表 P1–P6 |
| P2-04 | 死配置与占位实现：`AgentConstants.maxIterations/modelCallLimit`、`TitleGenerationService`、`rag.evaluation.enabled`、`hash-algorithm`、Chroma tenant/database | `AgentConstants.java:12-13`；`TitleGenerationService.java:46-53`；`application.yml:92,120`；`VectorStoreConfig.java:41-42` |
| P2-05 | 静默降级与假成功：`VectorStore`/`RerankModel` 可选注入、知识库无向量仍标成功 | `DocumentSearchTool.java:44-48`；`DocumentProcessingService.java:113-118` |
| P2-06 | MCP 无鉴权、无消息大小上限 | `grpc_server.py:176`；`mcp_server/config.py:35-36` |
| P2-07 | 多 Agent 分支的 `agent.tool-audit.digest-key` 默认值含 dev 密钥字面量 | `6ba65478:agent/service/ToolAuditService.java:40`（合并时处理） |

### 5.1 独立运行时安全风险（不得降级为 P2，不得随 WP-00 通过放行生产）

| # | 风险 | 证据 | 处置要求 |
|---|---|---|---|
| SEC-RUNTIME-01 | 视觉分析失败时返回 `urgency: attention` 的**合成医学结论**，可能被 Agent 当作真实模型输出转述 | `agent/tools/EyeImageAnalyzerTool.java:89-98` | 单独登记为医疗 AI 运行时安全问题；风险分级 + 验证；修复前不得在生产对话中把它呈现为模型结论（至少需要显式「分析不可用」状态，不得携带 urgency 语义） |
| SEC-RUNTIME-02 | Python gRPC 明文传输、无鉴权，绑定 `0.0.0.0:50051` | `algorithm/grpc_server.py:176`；Java 侧 `DiagnosisGrpcClient.java:30` `usePlaintext()` | 结合部署网络暴露面做风险评估；若跨主机通信必须加 TLS/鉴权或网络隔离；完成验证前不得把「已审计」当作放行依据 |

> 两项都不属于配置中心本期改造范围，**不阻断 WP-01**；但必须独立跟踪、有责任人与验证记录，不能混在普通技术债里。

---

## 6. 裁决记录（2026-11-16）

| # | 议题 | 裁决 |
|---|---|---|
| 1 | 发布者权限载体 | **yml 白名单**：部署期配置管理员 userId 列表；不新增授权表 |
| 2 | Same-Origin 校验 | **配置中心自带**：只作用于 `/admin/control-center/**` 写端点，不依赖多 Agent 分支 |
| 3 | WP-04 解冻范围 | **仅记录申请范围**：`AdminNav` 第七项、`index.html` 的 title/favicon 改写、品牌 Provider 与双主题 logo 接入；**不构成批准**，需正式授权记录 |
| 4 | Provider 发布语义（P0-NEW-01） | 只经草稿修改、随版本发布；修订行不可变；测试绑定修订；发布/回滚引用修订 ID |
| 5 | 发布幂等（P0-NEW-02） | `requestId` + 请求指纹 + 结果持久化；同 ID 同内容返回首次结果，同 ID 异内容 `40908` |
| 6 | Same-Origin 细则（P0-NEW-03） | 九条规则 + CSRF Token + `SameSite=Lax` + 八条独立安全验收用例 |
| 7 | 品牌资产历史访问 | 任一 release 引用过的资产可公开读取且永不删除；只有草稿引用的资产对外不可见 |
| 8 | 缓存策略 | PUBLISHED / BUILTIN / 不可变图片三类分开定义 |

裁决后本文件结论为 `PASS_WITH_MINOR`（有条件通过，范围限基线 `f42065e4`）；WP-01 可标记 `READY_FOR_IMPLEMENTATION`，但**不立即开发**。P1 项按对应工作包逐项关闭，P2 项登记不阻塞。

---

## 7. 证据索引

| 主题 | 文件 |
|---|---|
| 配置项逐条证据 | `configuration-inventory.md` §2–§5 |
| 重复来源与缺口 | `configuration-inventory.md` §6 |
| 模型调用点 | `model-callsite-inventory.md` §1、§4、§6 |
| 不可动态化的键 | `configuration-boundary.md` §2 |
| 架构决策与替代方案 | `config-center-adr.md` D1–D12 |
| API、状态机、错误码、幂等 | `mvp-api-contract.md` §1–§6 |

---

## 8. 审计范围声明

- **基线固定：** `f42065e4c38a94f4d1acd81f7cdbe15ad9c7f683`。`ui` 分支 tip `6ae633b8` 是其祖先，已包含。
- **有条件通过：** 本结论只对上述固定基线成立。**不得据此宣称「未来集成后的配置与模型调用链路已全部审计」**；任何集成分支合入后，必须在其新基线上重跑 CFG-AUDIT-01/02。
- **未纳入：** `feat/iris21-multiagent-integration`（`6ba65478`，与基线分叉 533 文件 / +68,725 行）只做了模型调用与配置键的定点扫描（`model-callsite-inventory.md` §4.2），未做全量配置盘点。合并前补审是集成门禁（P1-12），不是可选项。
- **未纳入：** 生产部署件（nginx / systemd / 环境变量清单）不在仓库内，无法从代码证明线上实际取值。
- **未纳入：** gitignored 的 `application-local.yml` / `application-dev.yml` / `application-server.yml` 不在工作树；主检出目录中的内容只用于确认「存在真实凭据字面量」这一事实，未复制其值。
- **凭据处置：** 主检出 `application-local.yml` 含真实凭据字面量（P1-06）。应改为环境变量或受控密钥来源；如存在暴露可能，应轮换相关凭据。本审计文档与提交历史均不得包含其内容。
- **UI 冻结：** 本审计只读，未修改任何前端文件；`AdminNav` / `index.html` 的解冻**尚未获得授权**。
