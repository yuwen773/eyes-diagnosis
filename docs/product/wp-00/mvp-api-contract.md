# MVP API 契约（建议稿）

**基线：** `f42065e4`　**日期：** 2026-11-16　**状态：** 待 WP-01 实现前定稿
**依赖：** `configuration-boundary.md`、`config-center-adr.md`

> 路径以现有 `server.servlet.context-path: /api` 为前提；下表写的是 Controller 映射，实际 URL 前缀为 `/api`。
> 所有响应沿用 `BaseResponse<T>`：`{ "code": 0, "data": ..., "msg": "ok" }`。
> **业务错误一律 HTTP 200 + 非 0 `code`**（现有 `GlobalExceptionHandler` 行为），客户端按 `code` 分支。

---

## 1. 通用约定

| 项 | 约定 |
|---|---|
| 认证 | Spring Session Cookie（`credentials: include`） |
| 授权 | `@AuthCheck(mustRole="admin")` + 新增 `@ConfigPermission(action)`（服务端策略，见 ADR §5） |
| 写操作防护 | Same-Origin 校验 + `X-CSRF-Token` 双防护，覆盖全部状态改变请求（本分支目前**没有** CSRF/Origin 过滤器，规则见 ADR D11 与 §6） |
| 并发控制 | 所有写请求带 `revision` / `expected*` 字段；不匹配返回 `40900` |
| 幂等 | 发布/回滚必须带 `requestId`；服务端按 `(actorId, requestId)` 持久化结果。同 ID 同内容 → 返回首次结果；同 ID 不同内容 → `40908`；不同 ID + 过期版本 → `40900`（ADR D12） |
| 时间 | ISO-8601（`yyyy-MM-dd'T'HH:mm:ssXXX`）；`BaseResponse` 内时间沿用 Jackson 全局格式 |
| 分页 | `page`（从 1 起）、`pageSize`（上限 100），返回 `{records,total,size,current,pages}` |
| 敏感字段 | 任何响应不得包含明文密钥；Provider 只返回凭据状态 |

---

## 2. 公开接口

### `GET /system/brand`

匿名可访问。返回**当前已发布**的品牌展示字段；读取失败时返回内置默认值（`source: "BUILTIN"`）。

```json
{
  "code": 0,
  "data": {
    "siteName": "Iris",
    "shortName": "Iris",
    "logo": { "light": "/brand/iris-optical-light-96.png", "dark": "/brand/iris-optical-dark-96.png" },
    "favicon": { "light": "/brand/iris-favicon.ico", "dark": "/brand/iris-favicon.ico" },
    "releaseVersion": 12,
    "source": "PUBLISHED",
    "updatedAt": "2026-11-16T10:00:00+08:00"
  },
  "msg": "ok"
}
```

约束：

- `source` ∈ `PUBLISHED` / `BUILTIN`；`BUILTIN` 时 `releaseVersion` 为 `null`。
- 不得返回草稿、资产内部 ID、存储路径、审计信息。
- 响应必须可缓存但**不阻断首屏**：前端先用内置值渲染，到达后替换。
- 缓存：`PUBLISHED` → `Cache-Control: no-cache` + 弱 `ETag`；`BUILTIN` → `Cache-Control: max-age=30, stale-while-revalidate=300`，且代理不得把回退值当发布配置长期缓存（ADR D8）。

### `GET /system/brand/assets/{assetId}`

公开只读，返回位图。**访问范围是「任一已发布 release 引用过的资产」**，不只是当前活跃版本——保证历史页面与旧 URL 不失效（ADR D5）。草稿专用、从未被任何 release 引用的资产返回 `40400`。

缓存：`Cache-Control: public, max-age=31536000, immutable` + 强 `ETag`（内容按 sha256 寻址）。资产永不原地覆盖。

---

## 3. 管理接口（`/admin/control-center`）

### 3.1 注册表与当前版本

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/registry` | `CONFIG_READ` | 强类型配置定义（含默认值、校验规则、敏感级、可变性） |
| GET | `/active` | `CONFIG_READ` | 当前发布版本 + 草稿状态摘要 |
| GET | `/draft` | `CONFIG_READ` | 当前草稿（不存在时 `data: null`） |

`/active` 响应：

```json
{
  "activeRelease": { "id": 12, "releaseVersion": 12, "schemaVersion": 1, "digest": "sha256:…", "publishedAt": "…", "publishedBy": 3 },
  "draft": { "id": 7, "revision": 4, "status": "VALIDATED", "updatedAt": "…", "updatedBy": 3, "validation": { "revision": 4, "validatedAt": "…" } },
  "hasUnpublishedChanges": true
}
```

### 3.2 草稿

| 方法 | 路径 | 权限 | 请求 | 说明 |
|---|---|---|---|---|
| POST | `/drafts` | `CONFIG_EDIT` | `{values, baseReleaseId}` | 创建草稿；已存在活跃草稿时返回 `40900` |
| PUT | `/drafts/{id}` | `CONFIG_EDIT` | `{revision, values}` | 全量覆盖草稿值；`revision` 必须匹配，否则 `40900` |
| POST | `/drafts/{id}/validate` | `CONFIG_VALIDATE` | `{revision}` | 校验并写入校验结果；失败返回字段级错误，草稿仍可编辑 |

规则：

- 任一 `values` 修改成功后 `status` 回到 `DRAFT`，此前校验结果作废。
- `values` 中不得出现未注册键（`40904`）、部署保护键（`40905`）、错误类型（`40000` + `fieldErrors`）。
- 校验失败写入审计（`CONFIG_VALIDATE_FAILED`），但不产生发布。

### 3.3 发布与回滚

| 方法 | 路径 | 权限 | 请求 |
|---|---|---|---|
| POST | `/drafts/{id}/publish` | `CONFIG_PUBLISH` | `{revision, expectedActiveReleaseId, validationRevision, requestId}` |
| GET | `/releases` | `CONFIG_READ` | 分页列表（`page/pageSize`） |
| GET | `/releases/{id}` | `CONFIG_READ` | 单版本快照（不可变） |
| GET | `/releases/{id}/diff` | `CONFIG_READ` | 与当前活跃版本的差异 |
| POST | `/releases/{id}/rollback` | `CONFIG_ROLLBACK` | `{expectedActiveReleaseId, requestId, reason}` |

发布前置校验（任一不满足即拒绝）：

1. `revision == draft.revision`（`40900`）
2. `validationRevision == draft.revision` 且草稿状态为 `VALIDATED`（`40901` / `40902`）
3. `expectedActiveReleaseId == 当前活跃版本 id`（`40900`）
4. 草稿引用的每个 Provider 修订，若与当前活跃版本不同，必须存在**绑定该 `revisionId`** 的成功测试（`AC-08-07/08`）；未修改的修订不阻塞
5. `requestId` 幂等检查通过（见下）
6. 事务内：写 `ConfigRelease` → 更新活跃指针 → 写 `ConfigAuditEvent` → 写 `t_config_request`，四者同事务

回滚语义：基于目标快照生成**新** `ConfigRelease`，`rollbackFromReleaseId` 指向来源，原历史不变；快照里的 Provider 修订引用原样复制，因此连接元数据被准确恢复。

#### 幂等响应

发布/回滚的响应体固定包含 `requestId` 与结果版本：

```json
{
  "code": 0,
  "data": { "requestId": "req-7f3a…", "releaseId": 13, "releaseVersion": 13, "replayed": false },
  "msg": "ok"
}
```

| 重试情形 | 结果 |
|---|---|
| 同 `(actorId, requestId)`、同请求指纹 | `code: 0`，返回首次结果，`replayed: true` |
| 同 `(actorId, requestId)`、不同请求指纹 | `40908 CONFIG_IDEMPOTENCY_MISMATCH` |
| 不同 `requestId`、`expectedActiveReleaseId` 已过期 | `40900 CONFIG_VERSION_CONFLICT` |
| 缺 `requestId` | `40000`（发布/回滚必填） |

### 3.4 Provider 连接（只经草稿修改）

**没有直接修改生效连接的写路径。** Provider 的新增与修改都发生在草稿里，随配置版本发布；发布快照保存不可变的修订引用。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/providers` | `CONFIG_READ` | **当前活跃版本**的连接视图（含 `credentialStatus`、`revisionId`） |
| GET | `/drafts/{id}/providers` | `CONFIG_READ` | **草稿**的连接视图（含未发布的草稿修订） |
| POST | `/drafts/{id}/providers` | `CONFIG_EDIT` | `{revision, values}`；在草稿中新增连接，返回 `{connectionId, revisionId}`；`secretRef` 必须是注册枚举 |
| PUT | `/drafts/{id}/providers/{connectionId}` | `CONFIG_EDIT` | `{revision, values}`；在草稿中生成**新的修订行**；旧修订不变 |
| POST | `/drafts/{id}/providers/{connectionId}/test` | `CONFIG_TEST_CONNECTION` | 测试指定 `{revisionId}`；结果绑定该修订 |
| GET | `/providers/secret-refs` | `CONFIG_READ` | 允许的 `secretRef` 枚举（不含值） |

规则：

- 任何 Provider 草稿修改都会使 `draft.revision + 1`，并作废此前的草稿校验结果。
- 连接测试必须显式指定 `revisionId`；对旧修订的测试结果不能用于发布新修订。
- 草稿里被删除/替换的连接以「不再出现在草稿引用列表」表达；历史 release 的引用不受影响。
- `GET /providers` 永远反映活跃版本，不会因为草稿编辑而变化。

连接测试响应：

```json
{
  "code": 0,
  "data": {
    "connectionId": 5,
    "revisionId": 12,
    "result": "SUCCESS",
    "checkedAt": "…",
    "latencyMs": 412,
    "checks": [
      { "name": "URL_ALLOWED", "status": "PASS" },
      { "name": "SECRET_RESOLVED", "status": "PASS" },
      { "name": "AUTH_RESPONSE", "status": "PASS" }
    ]
  },
  "msg": "ok"
}
```

`result` ∈ `SUCCESS` / `INVALID_URL` / `SECRET_MISSING` / `AUTH_FAILED` / `RATE_LIMITED` / `TIMEOUT` / `PROVIDER_ERROR` / `UNSUPPORTED`。

约束：固定超时、响应大小上限、并发上限、按用户限流；不得发送患者数据；结果只代表**当次检查**。

### 3.5 品牌资源

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/assets` | `CONFIG_EDIT` | `multipart/form-data`，字段 `file` + `kind`（`LOGO`/`FAVICON`） |
| GET | `/assets` | `CONFIG_READ` | 已上传资产列表（分页） |

上传响应：`{assetId, kind, contentType, width, height, byteSize, sha256, createdAt}`。

规则：

- 内容按 `sha256` 去重：相同内容复用同一 `assetId`，不产生新对象。
- 资产不可原地覆盖；任何修改都是新 `assetId`。
- **上传成功 ≠ 发布成功**：只被草稿引用的资产对公开接口不可见。
- 已被任一 release 引用过的资产**永久保留且可公开读取**，历史页面与旧 URL 不失效（ADR D5）。

### 3.6 审计

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/audits` | `CONFIG_AUDIT_READ` | 分页 + 过滤 `action` / `actorId` / `from` / `to` / `result` |

审计字段固定为：`eventId`、`actorId`、`action`、`targetId`、`requestId`、`beforeVersion`、`afterVersion`、`result`、`reasonCode`、`occurredAt`。只读，无写/删接口。

---

## 4. 草稿状态机

```
         创建/编辑                校验通过
  ∅ ──► DRAFT ──────────────► VALIDATED
          ▲  │                     │
          │  └── 编辑（校验作废）◄──┘
          │                        │
          │                        ├── 发布成功 ──► PUBLISHED（草稿归档，活跃指针切换）
          │                        └── 发布失败 ──► FAILED（活跃指针不变）
          └── 校验失败 ──► DRAFT（记录失败原因）
```

| 状态 | 含义 | 可转换到 |
|---|---|---|
| `DRAFT` | 可编辑；无有效校验 | `VALIDATED`、`FAILED` |
| `VALIDATED` | 该 `revision` 已通过校验 | `PUBLISHED`、`FAILED`、`DRAFT`（再次编辑） |
| `PUBLISHED` | 已生成不可变版本 | 终态 |
| `FAILED` | 校验或发布失败 | `DRAFT`（继续编辑） |

**发布版本（`ConfigRelease`）没有状态机**：一旦生成即不可变，只能被回滚「超越」，不能被修改或删除。

---

## 5. 错误码

沿用 `ErrorCode` 现有段位；新增：

| code | 名称 | 场景 |
|---|---|---|
| `40000` | `PARAMS_ERROR` | 类型错误、字段校验失败（附 `fieldErrors`） |
| `40100` | `NOT_LOGIN_ERROR` | 未登录 |
| `40101` | `NO_AUTH_ERROR` | 非管理员 |
| `40300` | `FORBIDDEN_ERROR` | 已登录但无该动作权限 |
| `40301` | `CONFIG_PERMISSION_DENIED` | 缺少 `CONFIG_*` 动作权限（与 40300 区分，便于审计） |
| `40400` | `NOT_FOUND_ERROR` | 草稿/版本/资产不存在 |
| `40900` | `CONFIG_VERSION_CONFLICT` | revision / expectedActiveReleaseId 不匹配 |
| `40901` | `CONFIG_NOT_VALIDATED` | 草稿未通过校验即发布 |
| `40902` | `CONFIG_STALE_VALIDATION` | 校验结果与当前 revision 不一致 |
| `40903` | `CONFIG_SCHEMA_UNSUPPORTED` | Schema 版本不兼容 |
| `40904` | `CONFIG_UNKNOWN_KEY` | 提交未注册键 |
| `40905` | `CONFIG_DEPLOY_PROTECTED` | 尝试修改部署保护键 |
| `40906` | `CONFIG_SECRET_REF_INVALID` | 未注册的密钥引用 |
| `40907` | `CONFIG_ASSET_INVALID` | 文件类型/大小/像素超限或内容伪造 |
| `40908` | `CONFIG_IDEMPOTENCY_MISMATCH` | 同 `requestId` 但请求内容不同 |
| `42900` | `CONFIG_TEST_RATE_LIMITED` | 连接测试触发限流 |
| `50000` | `SYSTEM_ERROR` | 未预期异常（不得携带内部细节） |

`fieldErrors` 统一形状：`[{ "key": "brand.siteName", "reasonCode": "TOO_LONG", "message": "…" }]`。

---

## 6. 写操作安全检查清单（每个写端点）

1. 会话有效且角色为 `admin`。
2. `@ConfigPermission` 动作权限通过（服务端策略，不读前端状态）。
3. Same-Origin 校验通过：按 ADR D11 的九条规则执行——`Origin`/`Referer` 都缺失时拒绝、`Origin: null` 拒绝、严格比较 scheme+host+port、代理后只认部署白名单。
4. `X-CSRF-Token` 存在且与会话绑定 token 一致（double-submit）。
5. `revision` / `expected*` 匹配。
6. `requestId`：发布/回滚必填；其余写操作可选。幂等记录与业务写入同事务（ADR D12）。
7. 请求体只含已注册键。
8. 审计写入与业务写入同事务（发布/回滚）；其余操作至少保证审计不丢（失败则拒绝请求）。

> 3 与 4 的失败统一返回 `40300`，审计记录 `reasonCode`（`ORIGIN_MISSING` / `ORIGIN_MISMATCH` / `ORIGIN_NULL` / `CSRF_MISSING` / `CSRF_MISMATCH`），不记录请求体。

---

## 7. 兼容与版本

- API 自身不带版本号；破坏性变更通过新路径或新字段提供。
- `ConfigRelease.schemaVersion` 与 API 版本解耦；不兼容 Schema 由服务端拒绝（`40903`），不静默忽略字段。
- 公开品牌接口字段只增不减；前端必须容忍未知字段。

---

## 8. 与现状的差距（必须在 WP-01 前解决）

| 差距 | 现状 | 需要做的事 |
|---|---|---|
| 细粒度权限 | 只有 `UserRole.USER/ADMIN`，`@AuthCheck` 只判 admin | 新增 `@ConfigPermission` + 服务端策略 |
| CSRF/Origin | 无任何过滤器 | 配置中心自带 Same-Origin + CSRF Token（ADR D11），覆盖 `/admin/control-center/**` 全部写端点 |
| 幂等/并发 | 现有 Controller 无 revision / requestId 概念 | 全部写端点引入 revision；发布/回滚引入 requestId 幂等记录（ADR D12） |
| Provider 语义 | 无现成模型；ADR 初稿允许直改 | 改为草稿内修订 + 发布快照引用（ADR D7），移除直接写路径 |
| 资产访问/缓存 | 无 | 历史已发布资产可读、内容哈希寻址、三类资源分开缓存（ADR D5/D8） |
| 审计同事务 | `t_news_audit` 是业务事务内写入，可作先例 | 配置发布复用该模式 |
| 错误码 | 无 409 段 | 新增 §5 错误码 |
