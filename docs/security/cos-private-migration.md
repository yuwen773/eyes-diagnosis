# COS 私有化与对象级访问控制（P1 安全整改）

> 状态：**代码已改（本 PR）+ 待云侧切换（owner/管理员执行）**。
> 在云侧确认「匿名直链不可读」之前，**不得**宣称 COS 安全整改关闭。

## 0. 背景

G3-7 真实验证发现：`/api/agent/image/view/{file}` 的 `@AuthCheck` + 40100 归属门，可被**直接拿 COS 对象 URL** 绕过——因为桶是公有读，且视图 302 跳转到的是**未签名**的 `host/{key}`。这是应用层鉴权与存储层边界不一致：门在应用层，存储层没有门。

## 1. 桶用途审计（不整桶一刀切的前提）

同一 COS 桶承载多种资源，敏感度与访问需求不同：

| 前缀 / key 形态 | 写入方 | 内容 | 敏感度 | 当前访问方式 | 目标 |
|---|---|---|---|---|---|
| `agent-chat/{uid}/{file}` | `AgentImageUploadService.uploadImage` | Agent 眼科影像 | **高（PHI）** | 视图 302 → 裸公有 `host/{key}`（**可绕过**） | **对象级 Private + 5 分钟签名视图（本 PR）** |
| `public/{uid}/{file}` | `DiagnosisServiceImpl`（判读影像）、`UserServiceImpl`（头像） | 判读影像是**医疗图像**；头像非敏感 | 判读图 高 / 头像 低 | URL 落库，前端 `<img src>` 直连公有 | **Phase 2**：判读影像另立鉴权视图端点后私有；头像可公开或签名（同前缀混用，需拆分） |
| `news/{uid}/…`、`cover/{uid}/…` | `NewsController`、`NewsServiceImpl` | 新闻封面 | 低（公开内容） | 直链公有 | 可保留公开：上传时对象级 `PublicRead`，使桶私有后仍可公开展示 |
| 桶根 `{uuid}_{原名}` | `KnowledgeBaseServiceImpl` | 知识库文档 | 中 | 预览走 10 分钟签名 URL；**但对象本身在公有桶下仍可直链读** | 随桶私有化一并收敛（对象级 Private） |
| 诊断任务存储（调用方传 key） | `CosDiagnosisTaskStorage` | 病程任务数据 | 待复核 | `putObject` 未设 ACL | **Phase 2 复核** |

> 结论：**不能直接改整桶 ACL**——会打断新闻封面、头像、判读影像的直链展示。必须按上表分类处置。

## 2. 访问模型：对象级 ACL（覆盖桶默认），而非一次性整桶切换

腾讯 COS 的对象级 ACL 优先于桶默认 ACL：给**敏感对象**设 `Private`，即使桶仍公有读，匿名直链也读不到。这让我们可以**逐个前缀收敛**，不必一次性动整桶，也不会连带打断公开资源。

## 3. 本 PR 的代码改动（仅 `agent-chat/`）

- `CosManager` 新增 `putObject(key, file, CannedAccessControlList)`。
- `AgentImageUploadService.uploadImage`：写入时 **显式 `Private`**。
- `AgentImageUploadService.resolveViewTarget`：返回 **5 分钟签名 URL**（复用 `CosManager.generatePresignedUrl`），不再返回裸 `host/{key}`。
- 保留：`resolveOwnedImageId` 的归属 + 活跃状态校验（跨用户/已删除/越权一律拒绝）；控制器 `Cache-Control: no-store` + `Referrer-Policy: no-referrer`。
- 回归：`EyeImageAnalyzerTool` 仍走服务端 `getObject`（不受签名影响）。

## 4. 关键限制（必须知悉）

1. **对象级 ACL 只对「之后写入」的对象生效**。**已经存在的 `agent-chat/` 对象在本次代码上线后仍是公有读**。要真正关闭，需要：
   - 云侧把桶改为私有 / 移除公有读桶策略 **（会同时影响其它前缀，见 §1，需按分类处理）**；或
   - 对历史 `agent-chat/` 对象做一次 **ACL 回填为 Private**（批量 `PUT Object-acl`）。
2. **桶策略优先于 ACL 的场景**：若桶上存在显式 `GetObject` 允许 `*` 的**桶策略**，对象级 `Private` **不一定能覆盖**——ACL 是"允许"集合，策略可能另行授予。必须检查并移除公有读桶策略。
3. **CDN / 自定义域名**：若对象经 CDN 回源并被缓存，即便源站转私有，**CDN 侧缓存仍可能继续对外**。需检查 CDN 缓存与鉴权配置。

## 5. 签名 URL 泄漏面与缓解

- **日志**：不要把签名 URL 写进应用日志（当前未记录）。
- **浏览器历史 / Referer**：视图端点是 `302`，历史里保留的是**站内 view URL**，不是签名目标；已加 `Referrer-Policy: no-referrer`，且响应 `Cache-Control: no-store`，避免中间缓存留存签名 URL。
- **有效期**：5 分钟短时，过期即失效；页面重新渲染会重新换取。

## 6. 腾讯云控制台变更步骤（owner / 授权管理员执行）

> 我不操作云账号或真实桶；以下为可执行清单，先在隔离/测试桶演练。

1. **只读盘点**：控制台 → 存储桶 → 权限管理，记录当前「访问权限」（是否"公有读私有写"）、「桶策略」JSON、是否绑定 CDN。
2. **核对对象 ACL**：抽查若干 `agent-chat/`、`news/`、`public/`、知识库根对象，确认各自 ACL。
3. **（演练桶）** 先把测试桶置私有 + 移除公有读策略，用隔离环境跑 §7 验证矩阵；确认新闻/头像/判读影像/知识库预览分别按 §1 方案处置后仍可用。
4. **（生产）** 按 §1 分类处置后再切：
   - 敏感前缀（agent-chat / 判读影像 / 知识库）→ Private；
   - 公开资源（新闻封面、头像）→ 上传时对象级 `PublicRead`（或保留在独立公开桶/前缀）；
   - 历史 `agent-chat/` 对象 → ACL 回填 Private。
5. **移除**公有读桶策略（若有）。
6. **CDN**：若启用，关闭对敏感前缀的回源缓存或改为签名回源。

## 7. 验证矩阵（关闭前必须全过）

| # | 场景 | 手段 |
|---|---|---|
| 1 | 当前用户合法访问成功 | 登录后 `/api/agent/image/view/{file}` → 302 → 签名 URL → 200 |
| 2 | 跨用户经业务接口访问失败 | 他人 session 取他图 → 40100 / 拒绝 |
| 3 | 未登录直连**未签名**对象 URL 失败 | 匿名 `GET host/agent-chat/{uid}/{file}` → **403** |
| 4 | 签名 URL 有效期内成功、过期失败 | 5 分钟内 200；过期后 403 |
| 5 | 已删除对象不可读 | 删除后 view/直链均失败 |
| 6 | 前端预览/历史附件/模型分析不回归 | 上传→预览、历史回放、Agent 分析 |
| 7 | 对象级 ACL / 桶策略 / CDN 无绕过 | 抽查 ACL、策略 JSON、CDN 回源 |

> 单元测试已覆盖 1/2/4/5 的可测部分（`AgentImageUploadServiceTest`、`AgentAttachmentTrustTest`）；3/6/7 属基础设施/集成，需 §6 切换后在隔离环境验证。

## 8. 回滚

- 应用层：回退本 PR 即恢复旧视图（裸 URL）——**但旧视图对私有桶不可用**，故应用回退必须与云侧回滚同步，否则取图失败。
- 云侧：恢复桶为原访问权限 / 恢复原桶策略 / 还原被回填对象 ACL。
- 因涉及"签名视图 + 私有对象"成对生效，**应用与云侧回滚必须同批次**。
