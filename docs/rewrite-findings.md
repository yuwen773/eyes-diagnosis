# 重构过程问题清单

迁移过程中发现的**缺陷、隐患与运维欠账**，集中在此处待统一处理。

与 `docs/migration-decisions.md` 的分工：

- `migration-decisions.md` 记录**"Python 侧怎么复刻 Java"** 的裁定——每条都是为了让行为一致而做的选择。
- 本文记录**"系统本身哪里不对"**——这些不是移植决策，是需要单独排期的真实问题。

截至 Phase 2.4（user / diagnosis / news / knowledge 四域，25 端点）的完整清单。

---

## 分诊规则

| 标签 | 含义 | 谁来修 |
|---|---|---|
| `J` | Java 侧真实缺陷。Python 已忠实复刻，**改 Java 就是行为变更**，需两侧同批发布 | 后端 |
| `F` | 前端缺陷 | 前端 |
| `O` | 配置 / 凭据 / 运维欠账 | 运维 |
| `B` | 阻塞迁移的部署前提，未解则切流后功能不可用 | 运维 + 算法 |
| `D` | 死代码 / 误导性命名，无功能影响 | 后端（择机） |
| `P` | 只在 Python 移植过程中出现、已自行修掉的坑。**列出来是为了防止重犯**，无需后端动作 | — |

严重度：🔴 影响正确性或安全性 / 🟡 影响可用性或可维护性 / 🟢 债务。

---

## 🔴 安全与凭据

### O-1 MySQL 密码曾进 git 历史，**必须轮换**

- **位置**：`application-dev.yml:5-6`（已被 `de92197f` 移除）
- **事实**：`eyeuser/123456` 提交进过仓库。即使文件已删，历史里仍在，任何拿到仓库的人都能拿到。
- **动作**：轮换该账号密码。若该库不止本项目使用，全部下游一起换。
- **状态**：未做

### O-2 COS / DashScope 密钥在 gitignored 文件里，建议改纯环境变量

- **位置**：`application-local.yml:4-5`（COS `secretId`/`secretKey`）、`:19,25,53`（三处 DashScope `sk-...`）
- **事实**：`git log --all -- application-local.yml` **无任何记录**，该文件始终被 gitignore，**密钥从未进入 git 历史**，无需清理历史。
- **风险**：不在 git 里 ≠ 安全。依赖一个"记得别提交"的约定，任何一次 `git add -f` 就泄漏。
- **动作**：改为纯 `env` 读取，与本项目 Python 侧 `WebConfig` 的 `cos_secret_id` / `dashscope_api_key` 保持一致。
- **状态**：未做

> 本文档不记录任何密钥的实际值。需要时请直接查看本地 gitignored 文件。

---

## 🔴 正确性缺陷

### J-1 gRPC 推理失败会写入一条**伪造的诊断记录**

- **位置**：`grpc_server.py:161-166`（Python 侧）+ `DiagnosisServiceImpl.java:182-245`
- **事实**：推理 servicer 在任何异常上返回**默认构造的空 `DiagnosisResponse`**，而不是抛错。Java 侧不检查，直接走完流程并 `save(diagnosis)`：

  | 列 | 值 |
  |---|---|
  | `predictedLabel` / `result` | `""` |
  | `rejected` | `false` |
  | `requiresReview` | `false` |
  | `humanReviewStatus` | `AI_ONLY` |

  即：**推理挂了，患者看到的是一条"AI 已诊断、结论为空、无需复审"的记录。**
- **影响**：最严重的一类问题。失败被伪装成成功，且 `rejected=false` 让它绕过所有拒识展示逻辑。
- **Python 侧**：`web/inference.py` 已改为抛 `InferenceUnavailable`，失败即 `50000` 且**不写任何行**（裁定 12）。
- **建议**：Java 侧同样 fail-closed。gRPC 进程退役后该路径自动消失，但**在退役前它是活的**。
- **状态**：Python 已修 / Java 待修

### J-2 `/news` 领域**没有建档入口**

- **位置**：`NewsController.java` 全 7 个端点
- **事实**：唯一的 INSERT 路径有两条，都走不通：
  - `POST /news/uploadCover` 不带 `id` → `NewsServiceImpl:124-137` 构造的实体只有 `title`/`userId`/`coverImg`，而 `content`/`publishTime` 是 `NOT NULL` 无默认值（`schema.sql:57,61`）→ INSERT 必失败 → `50000`/`系统错误`
  - `POST /news/edit` → `saveOrUpdate` 在 id 非空时走 `updateById`，**不是** insert；id 不存在即 0 行受影响 → `操作失败`
- **前端同样建不了**：`NewsEditPage.vue:106` 的 `id: Number(route.params.id)`，在无 id 时得到 `NaN` → JSON `null` → `PARAMS_ERROR`。
- **结论**：news 记录只能由数据库迁移脚本或手工插入产生。
- **建议**：补一个 `POST /news/add`（或让 `/edit` 在 id 缺失时 insert）。**两侧同批发布**，否则切流后会出现 Java 侧不存在的入口。
- **状态**：Python 忠实复刻（裁定 20）/ 待产品确认是否补建档入口

### J-3 `POST /news/edit` 的 `coverImage` **静默失效**

- **位置**：`NewsUpdateDTO.coverImage` vs `News.coverImg` / `t_news.coverImg`
- **机制**：Spring `BeanUtils.copyProperties` 按属性名匹配，名字不同就**静默丢弃**，不报错、不警告。
- **读路径有补丁**：`NewsServiceImpl.java:97` 显式 `newsVO.setCoverImage(news.getCoverImg())`。**写路径没有。**
- **为什么没暴露**：前端分两步——`NewsEditPage.vue:73` 先调 `/uploadCover` 落盘封面，`:105` 再调 `/edit` 传回同一个 URL（被忽略也无妨，库里已经是它了）。
- **建议**：把 DTO 字段名对齐为 `coverImg`，或显式映射。别依赖调用方"刚好分两步"。
- **状态**：Python 忠实复刻（裁定 21）/ Java 待修

### J-4 `POST /news/uploadCover` **覆盖标题与作者**

- **位置**：`NewsServiceImpl.java:125-126`

  ```java
  news.setTitle("");                  // 标题被清空
  news.setUserId(loginUser.getId());  // 作者被改成上传者
  ```

- **机制**：MyBatis Plus 默认 `NOT_NULL` 字段策略**跳过 null 但写入空串**，所以这两列真的会被 UPDATE 覆盖。
- **影响**：用户上传封面后直接关掉浏览器 → 文章标题变空、作者变成最后一个传图的管理员。正常两步流程会由随后的 `/edit` 补回标题，但补不回作者。
- **建议**：删掉这两行。这两个字段与"上传封面"这个动作毫无关系，是构造临时实体的副作用。
- **状态**：Python 忠实复刻（裁定 21）/ Java 待修

### J-5 公开新闻列表**不过滤 `status`，草稿对外可见**

- **位置**：`NewsServiceImpl.getNewsQueryWrapper:54-72` + `NewsVO`
- **事实**：`t_news.status` 定义为 `0草稿 / 1已发布 / 2下架`，但查询无 status 谓词，且 `NewsVO` **不暴露** `status` 字段（前端无从过滤）。
- **影响**：`POST /news/list/page/vo` 与 `GET /news/get/{id}` 都**无 `@AuthCheck`**，匿名可读 → 草稿与下架文章对所有人可见。
- **建议**：列表与详情加 `status = 1` 过滤；VO 补上 `status` 供管理端使用。**注意**：这会改变公开 API 返回内容，属破坏性变更，需同步前端。
- **状态**：Python 忠实复刻（裁定 22）/ 待产品确认

### J-6 `t_news` 是**物理删除**，且留下孤儿行

- **位置**：`News.java`（无 `@TableLogic`，无 `isDelete` 字段）+ `schema.sql:52-66`（无 `isDelete` 列）
- **对比**：user / diagnosis 两个域都是逻辑删除。news 是唯一的例外。
- **影响**：`removeById` 发出真 `DELETE FROM t_news`。`t_paragraph` / `t_attachment` 的 `newsId` 声明**没有外键约束**（`schema.sql:71-77`），删除后子表留下指向不存在 id 的孤儿行。
- **建议**：二选一——补逻辑删除列，或给子表加外键并在删除时级联清理。
- **状态**：Python 忠实复刻并在测试中钉死（裁定 23）/ Java 待定

### J-7 重复保存未修改的新闻返回"操作失败"

- **位置**：`NewsController.java:161-162`
- **机制**：`updateById` 返回**变化行数**（MySQL 默认，不开启 `CLIENT_FOUND_ROWS`），空写 = 0 → `ThrowUtils.throwIf(!result, OPERATION_ERROR)`。
- **影响**：用户点"保存"但没改任何东西 → 弹"保存失败"，而数据其实是对的。编辑页不会误改内容，但会误导用户以为没保存成功而重复操作。
- **注意**：**这条无法在 SQLite 上验证**（SQLite 的 `changes()` 数的是匹配行）。需要真 MySQL 确认。
- **建议**：`saveOrUpdate` 的返回值语义对"更新"场景不合适，应改为先 `selectById` 判断存在性，或改判 `rowcount >= 0`。
- **状态**：Python 忠实复刻（裁定 25）/ Java 待修

### J-8 `POST /news/edit` 对短于 30 字的正文**崩溃**

- **位置**：`NewsController.java:156` — `newsUpdateDTO.getContent().substring(0,30)`
- **机制**：内容不足 30 字 → `StringIndexOutOfBoundsException` → 被 catch-all 吞成 `50000`/`系统错误`，**正文丢失**。管理端编辑器对长度无下限要求，必然可触发。
- **附注**：`getContent()` 为 null 时先 NPE，结局相同。
- **Python 侧**：已改用安全切片 `content[:30]`，短文正常保存（裁定见 `migration-decisions.md`）。
- **建议**：Java 侧改 `StrUtil.sub(content, 0, 30)`（Hutool 对超长/过短都安全）。
- **状态**：Python 已修 / Java 待修

### J-9 `VectorStoreConfig.java` 的 collection 默认值**与所有真实配置不符**

- **位置**：`VectorStoreConfig.java:24` = `eye-diagnosis-knowledge`
- **实际生效值**：`diagnosis-knowledge`（`application-server.example.yml:35`，以及 gitignored 的 `application-dev.yml:35`）
- **为什么危险**：Java 默认值**从未触发**（`spring.profiles.active: local,dev` 下 yml 必然加载）。但一旦有人删掉那行配置，就会静默切到一个空集合——**检索全部返回空，无任何报错**。
- **建议**：把 Java 默认值改成 `diagnosis-knowledge`，与配置对齐。
- **状态**：未做（本次重写不改 Java，见裁定 1）

---

## 🟡 可用性与部署前提

### J-12 Chroma 检索**无任何可见的失败信号**（knowledge 域最危险的一条）

- **位置**：`agent/tools/DocumentSearchTool.java` + `agent/config/VectorStoreConfig.java`
- **事实**：Python 侧写入端与 Java 侧读取端之间没有任何契约校验。以下任一不一致，Java 的检索都返回**空结果集**，`DocumentSearchTool` 如实返回 `"未找到相关文档。"`——**不报错、不告警、不记日志**：

  | 项 | 必须一致 | 不一致的后果 |
  |---|---|---|
  | collection 名 | `diagnosis-knowledge` | 读到另一个集合 |
  | tenant / database | `default_tenant` / `default_database` | 同上 |
  | embedding 模型与维度 | DashScope `text-embedding-v3` 默认维度 | Chroma 拒绝写入（**这一项至少是响亮的**） |
  | `ownerUserId` metadata | **整数** | 字符串 → 过滤类型不匹配 → **所有用户都搜不到任何文档** |
  | chunk id | `doc_{docId}_chunk_{i}` | 删除时按 id 删，id 不符则留下无法回收的孤儿向量 |

- **`ownerUserId` 存成字符串是唯一完全静默的失败**：它不影响写入、不影响 `chunkCount`、不影响 `/list/page` 的返回，只是让检索恒为空。而这正是多租户隔离的那道闸门。
- **测试**：`test_knowledge.py` 里每个常量都锚定到 Java 源文件行（`assert 'metadata.put("ownerUserId", ...)' in PROCESSING_JAVA`），Java 那边一改就红。
- **建议**：Phase 3 之后做一次**端到端验证**——Python 写入一份文档，然后用 Java 的 Agent 问一个只该命中它的问题。这是整个迁移里唯一必须真实验证、无法靠单测覆盖的路径（见计划书 4.2）。
- **状态**：Python 已严格对齐 / **待端到端验证**

### J-13 Chroma 删除失败会留下**永久孤儿向量**

- **位置**：`KnowledgeBaseServiceImpl.deleteDocument:139-146`
- **机制**：向量删除失败只 `log.warn` 然后继续删数据库行。行没了，`chunkCount` 也就没了，而向量只能按 id 删——**没有任何补偿任务能找到它们**（代码注释提到的"will retry via compensation"在本仓库中不存在）。
- **影响**：Chroma 抖动一次，就有一批向量永久残留。它们会继续被检索命中（如果 `ownerUserId` 对得上），内容却已经没有任何页面可以管理。
- **建议**：把删除顺序反过来——先删向量，成功才删行；或加一个对账任务扫 `t_knowledge_document` 找不到的 `doc_{id}_chunk_*`。
- **状态**：Python 忠实复刻 / Java 待修

### J-14 知识库上传把**服务器临时文件路径**写进了向量 metadata

- **位置**：`DocumentProcessingService.java:69` — `String fileUrl = file.getAbsolutePath()`，随后进入 `buildMetadata` 的 `"source"`
- **影响**：向量库里长期保存着形如 `/tmp/upload_12345678报告.pdf` 的路径，而这份 metadata 会被 `DocumentSearchTool.formatDocuments` **读出来展示给模型，模型可以照着复述给用户**。属于低危信息泄露（暴露服务器目录结构与并发量）。
- **Python 侧**：已改为写 COS object key（稳定且无泄露）。**这是一处有意偏离**。
- **建议**：Java 侧同样改用 `doc.getFileUrl()`。
- **状态**：Python 已修 / Java 待修

### J-15 `TextChunkerService` 把触发换段的段落**写入两次**

- **位置**：`TextChunkerService.java:41-57`
- **机制**：溢出分支内 `:48` 追加一次 `trimmed`，然后**穿透**到 `:55-57` 的无条件追加，再写一次。
- **影响**：每个 chunk 的首段重复出现。检索质量下降（嵌入向量被重复内容稀释），且 chunk 变长使实际有效内容少于配置的 800 字。
- **为什么 Python 复刻**：chunk **数量**变了，而 `deleteDocument` 用 `chunkCount` 重建 `doc_{id}_chunk_{i}` 去删向量。修好它 = Java 切换前写入的向量永远删不掉。
- **建议**：Java 侧修复后，需**先重新切分已有文档**（或接受一次性孤儿向量）再切流。
- **状态**：Python 忠实复刻并钉死（测试断言精确到拼接结果）/ Java 待修（**有切换顺序依赖**）

### J-16 `.doc`（旧版二进制 Word）无法上传（Python 侧能力收窄）

- **位置**：`KnowledgeBaseServiceImpl.ALLOWED_TYPES` 含 `doc`，Java 靠 Apache Tika 支持
- **事实**：Python 侧 `pypdf` + `python-docx` 都打不开旧版 `.doc`，且没有可用的纯 Python 解析器。上传 `.doc` 会返回明确错误「暂不支持 .doc 旧版二进制格式，请转换为 .docx 后重新上传」。
- **有意为之**：不返回空文本。空文本会被 ETL 判成"文档内容为空"（status=2），把**能力缺失**报告成**文档损坏**，用户会反复重传。
- **附带收窄**：`python-docx` 不提取表格与页眉页脚，Tika 提取。**内容以表格为主体的 `.docx` 会解析为空**，同样落到 status=2。
- **建议**：Java 侧从 `ALLOWED_TYPES` 移除 `doc`（前端上传白名单同步收窄），或为 Python 引入 LibreOffice 转换。
- **状态**：有意收窄，需产品确认

### J-17 鉴权可用性依赖 Java 的 Spring Session

- **位置**：`web/auth.py::get_login_user`，逐请求转发默认 `SESSION` 或兼容 `JSESSIONID` 到 Java 的 `/user/get/login`。
- **issue 01 更新**：已删除 Python 正身份缓存，避免 Java 登出后仍接受旧 cookie。Python 不再直接读 Redis 登录缓存；Java 仍依赖 Redis Spring Session。
- **失败边界**：Java 无法连接或返回异常响应时 Python 拒绝鉴权，不接受无法验证的 cookie。实际 Redis 故障及恢复过程未由本票演练。
- **测试**：`test_baseline.py` 的会话转发、撤销与 cookie 隔离 HTTP 测试，以及隔离真实服务的登出重放验证。
- **状态**：旧缓存描述已被当前实现替代；真实 Redis 故障演练待做。

### J-18 mcp-server 查不到记录时返回 **50000 而非 40400**

- **位置**：`McpServerServiceImpl.getByCodeAndUser` 用 `selectOne`，找不到返回 `null`；`updateMcp`/`deleteMcp`/`getMcp` 三个调用点都**直接解引用**，没有 null 检查 → `NullPointerException` → 兜底 `50000`/`系统错误`。
- **影响**：用户传错 `mcpServerCode`，或用别人的 code（越权），都得到同一个毫无信息量的"系统错误"。前端无法区分"不存在"和"无权访问"。
- **为什么不改**：单边改成 `40400` 会让两套服务行为不一致。**注意顺序**：Java 是先查再解引用，所以"不存在"和"无权"在这里本来就无法区分——要真正修好需要先查存在性、再查归属两步。
- **状态**：Python 忠实复刻（`_require()` 显式抛 `SYSTEM_ERROR`）/ 两侧同批修

### J-19 `deployConfig` 是合法 JSON 但不是对象时返回 50000

- **位置**：`McpServerController.java:91` — `(ObjectNode) objectMapper.readTree(...)`
- **机制**：`catch` 只接 `JsonProcessingException`。`"[]"` 或 `"42"` 能解析成功，然后 `ClassCastException` **不是** `JsonProcessingException`，直接逃到兜底 → `50000`/`系统错误`，而不是预期的 `40000`/"deployConfig is not valid JSON"。
- **Python 侧**：已改为返回 `40000`，并**在消息里写明实际类型**（"got list" / "got int"），比 Java 的笼统提示更可定位。属有意偏离。
- **建议**：Java 侧改 `readTree` 后先 `instanceof` 判断。
- **状态**：Python 已修 / Java 待修

### J-20 MCP 远程连接白名单**默认为空**，等于全部拒绝

- **位置**：`McpConnectionPolicy` + `${mcp.remote.allowed-origins:}`
- **事实**：策略要求目标 origin 出现在白名单里，而白名单默认是空字符串 → **任何**远程 MCP 服务器都创建不了，返回 `40101`/"MCP 远程地址未获授权"。
- **判断**：这是**有意的 fail-closed**，不是配置缺失 —— 用户提供的配置决定服务器往哪发起出站连接，白名单正是为此存在。
- **但要注意**：默认部署下这个功能等于不可用，而错误消息（"未获授权"）不会提示运维去配 `mcp.remote.allowed-origins`。建议在该变量为空时启动即 WARN 一次。
- **状态**：已复刻 + 已记录 / 建议加启动告警

### B-1 **无权重文件**，推理服务必然 fail-closed（阻塞项）

- **位置**：`algorithm/checkpoints/` —— 只有 `registry.json`（160 B），**没有任何 `.pth`**
- **事实**：`ModelRegistry.resolve_current()` 的**第一个**检查就是权重存在性：

  ```python
  if not self.weights_path.is_file() or self.weights_path.stat().st_size == 0:
      raise RuntimeError(f"Model weights missing: {self.weights_path}")
  ```

  服务在读 `allow_sha256` 之前就抛 `Model weights missing`。**当前 `allow_sha256: []` 是如实反映"无权重放行"，不是漏填**——补一个 SHA 只会让失败发生在更靠后、更难诊断的地方。
- **影响**：这是**默认状态**。权重就位前，`POST /diagnosis/diagnosis` 在部署环境返回 `50000`/`系统错误`，且**不写任何行**（正确行为）。
- **解除条件**：完成 P2-02A 训练 → 权重落到 `checkpoints/` → 由流程计算 SHA-256 写入 `allow_sha256`。
- **状态**：未解除。**这是切流前唯一的硬阻塞**（其余 7 个 diagnosis 端点不受影响）

### O-3 `spring.jackson` 只在 gitignored 的 profile yml 里

- **位置**：`application.yml` **没有任何 jackson 配置**，全部依赖 `application-dev.yml:8-11` / `application-local.yml`
- **风险**：若 `spring.profiles.active` 变更或配置文件缺失，日期格式可能改变，破坏当前格式化字符串契约。不能用原前端的显示作为格式依据：它对现有格式化日期调用 `Number(...)` 已产生 `Invalid Date`，而合法 epoch 毫秒可以被该表达式解析。
- **建议**：把 `spring.jackson.date-format` 与 `write-dates-as-timestamps: false` 提升到 `application.yml` 基线。
- **缓解**：`application-server.example.yml`（tracked）已独立佐证了正确值，所以 Python 侧按其复刻，结论可靠。
- **状态**：未做

### J-10 MCP 工具列表缓存 5 分钟，跨服务**不失效**

- **位置**：`MCPManager.java:29` — `TOOLS_CACHE_PREFIX = "mcp:tools:"`，TTL 5min
- **影响**：Phase 2.5 后，`t_mcp_server` 由 Python 写、Java Agent 读。管理员在 Python 侧改了 MCP 配置，Java Agent **最长 5 分钟后**才感知到。
- **缓解**：`web/auth.py` 已预留 `MCP_TOOLS_CACHE_PREFIX`，Python 写入后主动 `DEL mcp:tools:{userId}:{code}`。
- **状态**：Phase 2.5 实现时落地

### J-11 `mcp-server` 分页参数是 `size`，其余域是 `pageSize`

- **位置**：`McpServerController.java:75` — `@RequestParam(value = "size", defaultValue = "10")`
- **影响**：写错直接 400。已在计划中标注，Phase 2.5 实现时注意。
- **状态**：待 Phase 2.5

### F-1 前端 Agent 流式请求硬编码后端地址，且**环境变量名与别处不一致**

- **位置**：
  - `frontend/src/composables/useAgentStream.ts:85` — `import.meta.env.VITE_APP_API_BASE_URL`
  - `frontend/src/config/env.ts:5` — `import.meta.env.VITE_API_BASE_URL`
- **事实**：两个**不同**的环境变量名。设了其中一个，另一个读不到，静默回落到硬编码的 `http://localhost:8081`。
- **风险**：Vite 只暴露 `VITE_` 前缀的变量，`VITE_APP_` 同样能读到，但两处名字不同意味着只能配一个。
- **缓解**：Phase 3 的 Nginx 同域分流会**掩盖**这个问题（请求变成同源相对路径），但配置项依然是坏的。
- **建议**：统一为一个名字。
- **状态**：未做

### F-2 前端对格式化日期调用 `Number(...)`，显示 `Invalid Date`

- **位置**：`pages/admin/UserManagePage.vue:123`、`pages/admin/DiagnosisManagePage.vue:265`、`pages/userCenter/DiagnosisHistory.vue:135`、`pages/user/DiagnosisTrendChart.vue:65` 等
- **背景**：`id`、`total` 等 Long 输出数字字符串，用 `Number(...)` 解析有效。`createTime` 则由独立日期序列化器输出 `yyyy-MM-dd HH:mm:ss`，`Number(...)` 得到 `NaN`；两者不能混为一种补偿。
- **实测**：issue 01 的合成历史记录在原页面显示 `Invalid Date`，同时实际 Java/Python 的该行日期值逐字一致。相关路径还包括 `components/user/DiagnosisTable.vue` 与 `useDiagnosisExport.ts`。
- **建议**：独立修前端日期解析并同步生成类型；本票保持原前端及 Java 不变。
- **状态**：旧业务缺陷未修；Python 时区迁移差异已修并补 HTTP 缓存回读回归。

---

## 🟢 死代码与技术债

| # | 位置 | 问题 |
|---|---|---|
| D-1 | `DiagnosisServiceImpl.java:134` | `eq(isNotNull(id), "userId", userId)` —— **条件测 `id`，列名却是 `userId`**，死守卫。`:138` 的无条件 `eq` 已覆盖同样语义 |
| D-2 | `schema.sql:181-182` | `t_diagnosis.image_hash` 列存在且**建了索引**，但 Java 实体无对应字段，Python 也未映射。缓存逻辑早已迁到 `t_inference_cache` |
| D-3 | `DiagnosisUploadDTO.id` | 字段存在但 `uploadDiagnosisPicture:90-113` 根本不读它（新建实体无 id → 走 insert）。前端照样在传 |
| D-4 | `DiagnosisResultVO.disclaimer` | 字段声明，**全仓库从未赋值**。前端展示的免责声明是 Vue 组件里硬编码的 |
| D-5 | `DiagnosisManageVO.status` | `:66` 在字段声明处初始化为常量 `"已完成"`，**不是 DB 列**，也不跟随 `reexamineStatus`。已复审的文章仍显示"已完成"。字段名极易误导 |
| D-6 | `DiagnosisQueryDTO.DiagnosisTime` / `userRole` | 接受但 `getDiagnosisQueryWrapper` 从不读取 |
| D-7 | `eye_diagnosis/ood.py` | 构造**全零**的探测器，从不参与判定（`grpc_server.py:118-120` 硬编码 `is_ood=False`）。是未完成的功能，不是可用的拒识机制 |
| D-8 | `NewsServiceImpl.java:118` | `System.err.println(newsId)` —— 生产代码里的调试残留 |
| D-9 | `NewsServiceImpl.java:116` | 抛出 `NOT_FOUND_ERROR` 却配 `"参数为空"` 文案，错误码与文案矛盾 |
| D-10 | `DiagnosisQueryDTO` 三个列表端点 | `:130` 的 `DiagnosisQueryDTO.setUserId(...)` 看起来是静态调用（会编译失败），实为**参数名遮蔽了类名**（JLS 6.5.2）→ 普通实例调用。极易误读为 bug |
| D-11 | `sortField` 注入面 | `QueryWrapper.orderBy(cond, isAsc, String... columns)` 把列名**原样拼进 SQL**。三个域全都有。Python 侧已改为查表列映射（裁定 16），**Java 侧未修** |
| D-12 | `t_paragraph` / `t_attachment` | 两张表无任何 Java/Python 代码读写；`attachments` 字段在 `NewsUploadDTO` 里被注释掉。前端用 `uploadAttachment` 拿到裸 URL 字符串自行拼接 |

---

## 🟢 Python 移植过程中自己踩的坑（已修，留档防重犯）

### P-1 `sortField` 用 ORM 属性名匹配列名 → **静默丢失 `ORDER BY`**

- **现象**：Phase 2.1 的 `web/routers/user.py` 写 `getattr(User, query.sortField, None)`。前端发的是**列名** `createTime`，Python 属性名是 `create_time` → **永远取不到** → 查询照样成功、测试全绿，只是没有排序。
- **教训**：这是"测试全绿但线上行为不对"的典型形态。改为查 `Model.__table__.columns`，顺带消掉了 Java 侧的注入面。
- **检测方式**：断言编译后的 `_order_by_clauses` 非空，而不是断言函数返回值。

### P-2 手抄 8 条中文疾病描述，抄错 7 条

- **现象**：`web/inference.py` 首次编写时手工抄录 `grpc_server.py:23-32` 的 `DISEASE_DESCRIPTIONS`，只有 `other` 一条碰巧正确。
- **教训**：中文常量**永不手抄**。改为写测试用 AST 解析 Java 源文件直接比对，任何一个字符对不上就红。
- **同类风险**：裁定 12 涉及的 `DiagnosisCategoryEnum` / `DiagnosisRecommendationEnum` 同样用 AST 对账（`web/tests/test_diagnosis_constants.py`）。

### P-3 `t_inference_cache` ORM 漏了 `uk_inference` 唯一约束

- **现象**：Java 的"插入即忽略、从不刷新"语义只活在 `ON DUPLICATE KEY UPDATE id = id` 里。ORM 没声明唯一约束，导致 SQLite 测试下重复写**不会报错**，这条语义根本无法测试。
- **修法**：ORM 补 `UniqueConstraint(*CACHE_KEY_COLUMNS)`，语义变得可测。

### P-4 模块级 `pytest.importorskip` 连带跳过无关测试

- **现象**：`test_inference.py` 写了 `np = pytest.importorskip("numpy")`，导致默认解释器（无 numpy）下连上面 25 个**不需要 numpy** 的 fail-closed 测试也全被跳过。
- **修法**：改成 per-test 的 `@pytest.mark.skipif(importlib.util.find_spec("numpy") is None)`。

### P-5 `ast.walk` 区分不出模块级与函数内 import

- **现象**：验证"导入时不能拉 torch"时用 `ast.walk` 扫全树，把 `InferenceEngine.load()` **函数体内**的延迟 import 也报成违规——恰好把让文件可用的东西判成了错。
- **修法**：只扫 `tree.body`（模块作用域）。运行时证明仍由子进程测试负责。

### P-7 camelCase VO + snake_case ORM → **四个域的所有列表端点都会 500**

- **现象**：`VO.model_validate(row, from_attributes=True)` 抛 `Field required`。Pydantic 按**字段名**去 `getattr`，而字段是 `userAccount`、ORM 属性是 `user_account`，两边对不上。
- **影响面**：`/user/list/page/vo`、`/diagnosis/list/page/*`、`/news/list/page/*`、`/knowledge/list/page` —— 每个域的每一个列表接口都返回 HTTP 200 + `code=50000`。
- **为什么三个阶段的测试都没抓到**：测的都是**投影函数**（`_to_vo(row)`、`_to_manage_vo(row)`），而它们是**按关键字构造** VO 的，不经过 `model_validate`。**测了被测函数，而不是它服务的边界。**
- **修法**：`response.EntityVO` 基类，validation alias → snake_case、serialization alias → 原样（`AliasGenerator`）。两者必须分开：共用一个 `alias_generator` 会把出线字段名也变成 snake_case，把一个静默 bug 换成另一个。
- **补测**：`test_entity_vo.py` 对每个 VO 都喂**真 ORM 实例**，三个方向各一遍：投影得值、出线仍是 camelCase、关键字构造仍可用。
- **残留**：`NewsVO.coverImage` ↔ 列 `coverImg` 不是机械转换能跨的（裁定 21 的读路径同款），需显式 `validation_alias`。

### P-8 FastAPI 0.143 的 `include_router` **不再展平路由**

- **现象**：`create_app().include_router(...)` 之后，`app.routes` 里只有 5 个 `_IncludedRouter` 包装对象，`getattr(route, "path", "")` 全是空。按 `app.routes` 遍历去找路由依赖的代码（测试里的鉴权 override、任何启动期自检）会**静默地一个都找不到**。
- **暴露方式**：契约测试要 override 鉴权依赖才能走通 HTTP，结果全部请求返回 50000——查下去才发现 override 根本没生效。
- **正确写法**：遍历各域模块自己的 `web.routers.<域>.router.routes`，或用 `app.openapi()` 的 `paths`。
- **同源陷阱**：`dependency_overrides` 的 key 必须是 `functools.partial` 对象本身（`require_admin`/`any_user` 在 import 期构造并被端点签名捕获）。按函数名或按 `require_role` 本身去 key，会**静默覆盖不到任何东西**。

### P-9 `sqlite://` 内存库的每个连接是**独立数据库**

- **现象**：fixture 里 seed 数据用 session A，请求处理用 session B，A 提交成功、B 查出来是空。
- **修法**：`poolclass=StaticPool` + `connect_args={"check_same_thread": False}`，让所有连接共享同一个内存库。
- **症状极具误导性**：表现为"路由 50000"、"ORM 投影失败"、"数据不更新"，看起来像应用 bug，实际是测试夹具问题。

### P-6 `LongStr` 只在 JSON 序列化时变字符串

- **现象**：测试里直接断言 `vo.id == "1"` 失败——`PlainSerializer(when_used="json")` 不影响 Python 属性值。
- **修法**：断言走 `model_dump(mode="json")`。这条对写契约测试的人很容易反复踩。

---

## 处理建议顺序

| 优先级 | 项 | 理由 |
|---|---|---|
| **P0，切流前必做** | **B-1** | 唯一的硬阻塞。权重与 `allow_sha256` 就位前，`/diagnosis/diagnosis` 不可用 |
| **P0，切流前必做** | **O-1** | 已泄漏的凭据，与切流时间无关，应立即处理 |
| **P0，切流后立即验证** | **J-12** | Chroma 跨语言一致性**无法靠单测覆盖**。必须实跑一次：Python 写入 → Java Agent 检索命中 |
| **P1，切换同期** | J-1 J-2 J-3 J-4 J-5 J-7 | 都是 Python 已忠实复刻的行为。**必须两侧同批发布**，否则切流瞬间行为分叉 |
| **P1，knowledge 域有顺序依赖** | **J-15** | 修 chunker 重复追加会改变 `chunkCount`，而删除按它重建向量 id。**必须先修再切流**，否则 Java 侧已写入的向量永远删不掉 |
| **P1** | J-14 J-16 O-2 O-3 J-9 | 配置卫生 + 能力收窄确认，改动小、风险低 |
| **P2** | J-8 J-13 F-1 F-2 J-10 J-11 | 可独立排期 |
| **P3** | D-1 ~ D-12 | 纯债务。建议逐条在触碰相关文件时顺手清理，不要单独立项 |
| — | P-1 ~ P-7 | 无需动作，仅留档 |

> **一条原则**：标 `J` 且 Python 侧已复刻的问题，**修 Java 就等于改变线上行为**。所以每一条都要两侧同批发布，绝不能只改一边。
