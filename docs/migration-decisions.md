> 当前登录态：完整迁移工单 02 使用 Python/Redis 独立会话，匿名业务错误仍为 HTTP 200/code 40100；工作流保持 HTTP 401/403/500。旧 Spring Cookie 不复用。

# Phase 0 裁定记录

> 2026-10-12 issue 01 更新：会话必须逐请求向 Java 验证，取消 Python 正身份缓存；默认转发 Spring Session 的 `SESSION`，兼容部署中的 `JSESSIONID`。前门 Nginx 8081、Java 8082、Python 8080。FastAPI 角色通过位置参数固定绑定，不能暴露为 `must_role` query 参数。详见 `docs/fastapi-baseline.md`；本文下方早期 TTL/端口描述仅保留为历史裁定。

重写前置决策，每条给出证据来源与影响面。**Python 侧实现必须与本文件一致。**

> **本文件只记录"Python 侧怎么复刻 Java"**——为达成行为一致而做的选择。
> 迁移过程中发现的**系统本身的缺陷**（含 Java 待修项、凭据欠账、死代码）另见
> [`docs/rewrite-findings.md`](./rewrite-findings.md)，那里带分诊标签与处理优先级。

---

## 裁定 1：Chroma collection = `diagnosis-knowledge`

**证据**：

| 来源 | 值 |
|---|---|
| `VectorStoreConfig.java:24` 默认值 | `eye-diagnosis-knowledge`（死代码，从不触发） |
| `application-server.example.yml:35`（唯一 tracked 的真实配置） | `diagnosis-knowledge` |
| `application-dev.yml:35`（gitignored，真实运行） | `diagnosis-knowledge` |

**裁定**：`diagnosis-knowledge`。

Java 默认值从未生效——`application-dev.yml` 在 `spring.profiles.active: local,dev` 下必然加载，覆盖了 `@Value` 的默认值。这不是"两个集合并存"，是**一个从未使用的遗留默认值**。

**影响**：Python 的 Chroma 写入端必须写 `diagnosis-knowledge`。

**遗留问题**：`VectorStoreConfig.java:24` 的默认值仍有误导性。若将来删除 `spring.ai.vectorstore.chroma.collection-name` 配置，会静默切到一个空集合（检索全部返回空，无报错）。建议在 Phase 2.4 一并修正默认值——但**该文件属 Java，本次重写不改**，仅记录。

---

## 裁定 2：日期序列化为字符串 `"yyyy-MM-dd HH:mm:ss"`

**证据链**：

1. `application-server.example.yml:8-11` 与 `application-dev.yml:8-11` 均设：
   ```yaml
   spring:
     jackson:
       date-format: yyyy-MM-dd HH:mm:ss
       serialization:
         write-dates-as-timestamps: false
   ```
2. `User.createTime` 声明为 `java.util.Date`（`model/entity/User.java:64`），受 `spring.jackson.date-format` 支配 → 输出字符串。
3. `config/JsonConfig.java:31` 另注册 `LocalDateTimeSerializer("yyyy-MM-dd HH:mm:ss")`，覆盖 `LocalDateTime` 类型。
4. **真实对照（issue 01）**：同一条 MySQL `DATETIME` 记录，现有 JDBC `serverTimezone=Asia/Shanghai` 配合 Jackson 默认 UTC，使 `java.util.Date` 输出比数据库墙上时间少 8 小时；`LocalDateTime` 不做这个转换。Python 按字段类型分别复刻。缓存中的日期字符串已是 UTC 表示，读取时不得再减 8 小时。

**裁定**：日期输出格式化字符串。分页 Long 的 `Number(...)` 转换合理；前端对格式化日期调用 `Number(...)` 则是既有缺陷，会产生 `NaN`。

**影响**：Python 侧使用 `JavaDateTimeStr` 复刻 Java `Date` 的 UTC 输出，`DateTimeStr` 保留 `LocalDateTime` 及 Java 登录响应已格式化的值。原前端 `dayjs(Number(record.createTime))` 对现有日期字符串显示 `Invalid Date`，本票记录该旧缺陷并保持前端不变；不能以页面日期显示成功代替协议对照。

---

## 裁定 3：`Long` / `long` 序列化为字符串

**证据**：`config/JsonConfig.java:36-38`
```java
simpleModule.addSerializer(Long.class, ToStringSerializer.instance);
simpleModule.addSerializer(Long.TYPE, ToStringSerializer.instance);
```
`@JsonComponent` 注解使其自动注册进 Spring Boot 的 Jackson builder。

**裁定**：所有 64 位整数（`id`、`total`、`userId`、`docId` 等）在 JSON 中是**字符串**。

**影响**：
- Pydantic 侧需对每个 Long 字段挂 `PlainSerializer(str)`
- `total`/`size`/`current`/`pages` 也是 Long → 分页对象四个字段全是字符串
- 前端已有 `Number()` 补偿，但 `NewsPage.vue:155` 的 `total > (searchParams.pageSize ?? 12)` 是直接比较——字符串与数字比较依赖 JS 隐式转换，Python 侧必须与 Java 行为一致而非"修正"为数字

---

## 裁定 4：`session.store-type: redis` + 登录态权威在 Java

> 已于完整 Python 项目迁移工单 02 取代。下方原裁定保留历史身份；当前 Python 自建独立 Redis 登录态，见 [Python 登录鉴权](python-session-auth-evidence.md)。

**证据**：`application-server.example.yml:12-14` 与 `application-dev.yml:12-14` 均设 `store-type: redis`。
项目从未配置 `RedisSerializer`（`git log --all -S"RedisSerializer"` 无任何提交），Spring Session 3.5 默认 `JdkSerializationRedisSerializer`。

**裁定**：Python 不自建登录态。`/user/login`、`/user/logout`、`/user/get/login` 由 Nginx 路由到 Java；Python 每个需鉴权请求转发 `Cookie: JSESSIONID` 取 `LoginUserVO`。

**注意**：CI 的 `application-ci.yml:7-8` 设 `store-type: none`——CI 跑测试时无 Redis session，鉴权走内存。Python 侧 CI 测试需同样处理或自建桩。

---

## 裁定 5：凭据泄漏范围

| 凭据 | 位置 | 是否进过 git 历史 | 动作 |
|---|---|---|---|
| MySQL `eyeuser/123456` | `application-dev.yml:5-6` | **是**（`de92197f` 才移除） | **必须轮换** |
| COS `secretId`/`secretKey` | `application-local.yml:4-5` | **否**（`git log --all -- application-local.yml` 无记录，该文件始终 gitignored） | 无需扫历史；建议改纯环境变量 |
| DashScope `sk-...` ×3 处 | `application-local.yml:19,25,53` | **否**（同上） | 同上 |

---

## 裁定 6：Redis database index = 8

**证据**：`application-server.example.yml:20` 与 `application-dev.yml` 均设 `spring.data.redis.database: 8`。项目用非默认库，不是 db 0。

**裁定**：`WebConfig.redis_db` 默认 8。Python 侧缓存（登录态缓存、新闻列表缓存）与 Java 侧缓存必须落在同一库，否则 Phase 3 切流后缓存行为分叉。

---

## 裁定 7：CORS 参数逐项对齐 `CorsConfig.java`

**证据**：`config/CorsConfig.java:24-33` 是硬编码的，没有配置项：

| 项 | 值 |
|---|---|
| mapping | `/**` |
| allowCredentials | `true` |
| allowedOrigins | `List.of()` 默认空（读 `app.cors.allowed-origins`） |
| allowedMethods | `GET, POST, PUT, DELETE, OPTIONS` |
| allowedHeaders | `Content-Type, X-Requested-With, Authorization` |
| exposedHeaders | 空 |
| maxAge | `3600` |

**裁定**：`WebConfig` 的 CORS 五项全部按上表写死为默认值，只把 origins 开放为环境变量。`CorsConfigTest.configDoesNotUseWildcard`（`src/test/java/.../config/CorsConfigTest.java:39`）断言禁用通配，`WebConfig.__init__` 同样对 `"*"` 抛 `ValueError`。

**注意**：Phase 3 用 Nginx 同域分流后，同源请求根本不过 CORS 预检。这套参数只是为了开发期 `:5173` 直连 Python `:8080` 时可用。

---

## Phase 0 交付物

| 文件 | 内容 |
|---|---|
| `algorithm/web/__init__.py` | 空文件。**内部禁用 `from ..` 相对导入** —— 会把 `algorithm` 变成真包，与 CI 的 `working-directory: algorithm` 冲突 |
| `algorithm/web/config.py` | `WebConfig` + `from_env()`，对齐 `mcp_server/config.py` 的构造器默认值 + `__init__` 校验风格。`__repr__` 对 COS 凭据脱敏（启动可安全打印） |
| `algorithm/requirements-web.txt` | 不含 torch/numpy/Pillow（留在 `requirements.txt`），使 `python-web` CI job 可在无 GPU 环境安装并跑 import smoke test |

**未完成**：裁定 5 的 MySQL 密码轮换需要运维配合，无法在代码层完成。

---

## 裁定 8：成功 `msg` 是 `"ok"`，不是 `""`

**证据**：`common/BaseResponse.java:35-37` 有一个两参构造器把 `msg` 默认为 `""`，但全仓库 50 处调用点无一例外走 `ResultUtils.success()`，后者显式传 `"ok"`（`ResultUtils.java:22`）。`grep "new BaseResponse"` 确认两参构造器从未被调用——**它是死代码**。

**裁定**：成功响应 `msg == "ok"`。

原实施方案写的是 `""`，据此更正。

---

## 裁定 9：所有已处理的错误都是 HTTP 200

**证据**：`grep -rn "ResponseStatus" src/main/java/` 无任何命中。`GlobalExceptionHandler` 是 `@RestControllerAdvice`，两个 `@ExceptionHandler` 返回的 `BaseResponse` 以默认 200 状态序列化。

**裁定**：Python 侧 `BizError` / 校验失败 / 未捕获异常一律 `JSONResponse(status_code=200, ...)`。

**为什么这是硬约束**：前端 `request.ts:38` 在**成功**响应拦截器里判断 `data.code === 40100` 并跳转登录页。若后端返回 HTTP 401/500，请求会进入 rejection 分支，登录跳转与"请先登录"提示全部失效。

**例外保留**：未匹配路由仍返回真正的 404 —— 那是 Spring `BasicErrorController` 的行为（返回 `timestamp/status/error/path` 而非 `BaseResponse`），属于框架属性而非本项目约定。前端把它当传输故障处理，对真正不存在的路径是正确的。

---

## 裁定 10（有意偏离）：参数校验失败返回 40000 而非 50000

**证据**：全仓库 `@Valid`/`@Validated` **零命中**，控制器不校验请求体。参数非法时 Java 抛 `MissingServletRequestParameterException` 一类的 `ServletRequestBindingException`，它没有被 `GlobalExceptionHandler` 单独处理，落入兜底的 `handleException`，最终返回 **`code=50000, msg="系统错误"`** —— 把客户端错误报成服务端故障。

**裁定**：Python 侧 `RequestValidationError` → `ErrorCode.PARAMS_ERROR`（40000，`"请求参数错误"`），这是 Java **服务层**用 `ThrowUtils.throwIf(..., PARAMS_ERROR)` 表达的真实意图。

**理由**：复刻这个行为会让"前端发错参数"在后端日志和监控里显示成 5xx 故障。字段级信息（`loc`/`msg`）也一并带上，便于定位。

**影响面**：前端任何非零 `msg` 都原样弹窗，因此可见变化仅是错误文案更准确，无结构变化。

这是整个重写中**唯一一处**不逐字节复刻 Java 的行为。后续如有偏离，须同样登记在本文件。

---

## 裁定 11（有意偏离）：`GET /user/get` 不返回 `userPassword`

**证据**：`UserController.java:137` 的 `getUserById` 直接 `return ResultUtils.success(user)`，返回**含密码哈希**的完整实体。另有 `/user/get/vo` 返回脱敏版 `UserVO`。

**核查**：`grep -rn "user/get" frontend/src/` 显示 `/user/get` 只出现在自动生成的 `api/userController.ts` 里，**没有任何页面或组件调用它**（`request.ts:41` 的字符串匹配针对的是 `user/get/login`）。

**裁定**：Python 侧 `/user/get` 与 `/user/get/vo` 均返回脱敏视图。

**理由**：复刻一个无人调用的端点去泄漏 BCrypt 哈希，没有兼容性收益。该端点需要鉴权且为 admin 角色，暴露哈希只会扩大攻击面。

---

## Phase 2.1 历史交付状态（user 领域；会话归属已于工单 02 取代）

`UserController.java` 的 **14 个端点已全部裁定归属**：3 个留 Java（`login` / `logout` / `get/login`），11 个由 Python 承接。

| 检查项 | 结果 |
|---|---|
| Java 端点未迁移（除 session） | **0** |
| Python 端点 Java 侧不存在 | **0** |
| Python 承接 session 端点 | **否** |
| `mvn -o -q compile -DskipTests` | **exit 0 / 185 classes** |
| `git diff --stat HEAD`（tracked） | **空** |
| `algorithm/web/tests/` | **40 passed**（23 基座 + 17 user） |

`src/` 与 `pom.xml` 零改动，这是"不污染原代码环境"的机器可验证判据。

### 当前端点归属表（完整迁移工单 02 后）

| 端点 | 归属 | 契约要点 |
|---|---|---|
| `POST /user/login` | **Python** | 原密码校验；轮换 EYE_SESSION |
| `POST /user/logout` | **Python** | 撤销 Redis key 并清 Cookie |
| `GET /user/get/login` | **Python** | 每请求读取 Redis 和当前 t_user；不缓存身份/角色 |
| `POST /user/register` | Python | 唯一免鉴权端点；返回**字符串** id |
| `POST /user/add` | Python | admin |
| `GET /user/get` | Python | admin；**裁定 11**：脱敏 |
| `GET /user/get/vo` | Python | admin |
| `POST /user/update` | Python | admin；显式写 `updateTime` |
| `POST /user/list/page/vo` | Python | admin；`current` + `pageSize` |
| `POST /user/list/page/vo/cache` | Python | admin；key 前缀 `…:v2` |
| `POST /user/delete/{id}` | Python | admin；**逻辑删除** |
| `POST /user/update/userCenter` | Python | 任意登录用户 |
| `POST /user/upload/avatar` | Python | 任意登录用户；multipart 字段名 `file` |
| `POST /user/diagnosis/reexamine` | Python | 任意登录用户；校验归属 |

### 三处值得记录的复刻细节

**缓存 key 加了 `v2`。** Java 的 `listUserVOByPageWithCache` 用 Hutool 序列化的 JSON 存 `diagnosis:listUserVOByPage:{md5}`。Python 用 Pydantic 序列化，字节形态不同但**语义等价**；加 `v2` 前缀是为了避免 Python 读到 Java 写的旧条目而误解析。缓存未命中无害，误解析有害。

**`updateTime` 必须显式赋值。** Java 依赖 MySQL 列的 `ON UPDATE CURRENT_TIMESTAMP` 自动更新；SQLAlchemy 的普通 `UPDATE` 不触发它，因此 `update_user` / `update_user_center` / `upload_avatar` 都显式 `user.update_time = datetime.now()`。漏掉这一处，前端的"最近更新"列会永远显示注册时间。

**密码 72 字节截断。** Java 的 BCrypt 静默截断超长密码；Python 若改为抛错，会把 Java 接受的超长口令用户锁在门外。故 `security.encode` 显式截断到 72 字节（见 `test_password_longer_than_bcrypt_limit_is_truncated_not_rejected`）。

---

## R6 核查（Phase 2.2 前置）：权重缺失，`allow_sha256: []` 是准确的而非遗漏

原计划把 `registry.json` 的空 `allow_sha256` 记为"待填入实际权重 SHA-256"。核查后需要修正这个判断：

```
algorithm/checkpoints/
└── registry.json      160 B    ← 目录里没有别的文件
```

`ModelRegistry.resolve_current()` 的**第一个**检查就是权重存在性：

```python
if not self.weights_path.is_file() or self.weights_path.stat().st_size == 0:
    raise RuntimeError(f"Model weights missing: {self.weights_path}")
```

因此当前状态下服务**在 SHA 放行检查之前就抛出** `Model weights missing`，`allow_sha256` 的空数组根本没被读到。空数组是**如实反映"没有任何权重通过放行"**，不是漏填——把它补上一个 SHA 只会让失败发生在更靠后、更难诊断的地方。

**裁定**：Phase 2.2 的推理层照常实现 fail-closed 语义（权重缺失 / SHA 不在放行列表 → 拒绝启动），但**不修改 `registry.json`**。理由：

1. 权重是训练产物（P2-02A 阶段产出），不是本次重写的交付物；仓库里没有权重是预期状态。
2. 擅自写入 SHA 会绕过"权重必须由训练流程登记"的约束，把一个人工填的值伪装成流程产物。
3. CI 的 `python-web` job 本就不装 torch（见裁定 12），无权重也能跑冒烟测试。

**运行时前提**：本地要真正起推理服务，需先完成 P2-02A 的训练并把权重落到 `checkpoints/`，再由流程计算 SHA-256 写入 `allow_sha256`。在权重就位前，`/diagnosis/upload` 在部署环境会 fail-closed——这是**正确的**行为，不是缺陷。

**注**：`AgentController` 下另有 `/agent/image/upload`（`@PostMapping("/image/upload")`），它属于 Agent 子系统，**不在这 8 个端点内，仍留 Java 一行不改**。

---

## 裁定 12：推理层与 web 层的关系（Phase 2.2 前置调研结论）

调研推翻了方案里的若干条假设，逐条记录。

### `eye_disease_model` 是**模块**不是包

方案写的是 `from eye_disease_model import EyeDiseaseModel`。这个 import 目标**确实存在**，但它是 `algorithm/eye_disease_model.py`（564 行平铺文件），不是包，全仓库无 `eye_disease_model/` 目录。

**后果**：该 import 只有在 `algorithm/` 位于 `sys.path` 时才成立。从仓库根启动会失败。`web/` 下已用绝对导入（`from web.x import y`），因此 web 层必须**显式把 `algorithm/` 加入 `sys.path`**，不能依赖 cwd。

### torch / numpy / PIL 在默认解释器里全缺

`D:\environment\python.exe`（3.13.15）里 `import torch` → `ModuleNotFoundError`，numpy 与 PIL 同样缺失。

**这推翻了 `requirements-web.txt` 注释里的一句假设**——注释说"web 层只在推理进程内化后才需要 torch"，暗示现状不需要。实际上现状连 numpy 都没有，而 `eye_diagnosis/quality.py`、`calibration.py`、`ood.py`、`metrics.py` 四个模块**在 module scope 就 import numpy/PIL**。

**裁定**：推理层（含上面四个模块 + `eye_disease_model`）**一律延迟导入**，`create_app()` 在无 torch 环境下必须照常成功。这既是 Phase 4 CI 冒烟测试的前提，也是生产环境 CPU-only 回退的需要。

### 推理环境变量归入 `WebConfig`

`grpc_server.py` 用裸 `os.getenv` 读 6 个变量：`MODEL_WEIGHTS_PATH` / `MODEL_WEIGHTS_SHA256` / `MODEL_REGISTRY_PATH` / `MODEL_CALIBRATION_PATH` / `INFERENCE_POLICY_VERSION` / `QUALITY_GATE_MODE`。

**裁定**：迁入 `WebConfig.from_env()`，沿用既有 `from_env()` 风格（构造器显式默认值 + 体��校验 + classmethod 读环境变量）。

**陷阱**：`mcp_server/config.py:2` 在 module scope `import torch` 并在构造器默认值里调 `torch.cuda.is_available()`。这正是 `WebConfig` 至今没有任何模型设置的原因。新增 `model_weights_path` 等字段时**不得**照抄这个写法——否则 `web/config.py` 会把 torch 拉进 CI。

**注意命名冲突**：MCP 用 `MODEL_PATH`，gRPC 用 `MODEL_WEIGHTS_PATH` 指同一概念。迁入 `WebConfig` 时统一为 `MODEL_WEIGHTS_PATH`（语义更明确，且 gRPC 的 fail-closed 逻辑以它为准）。

### `t_inference_cache` 属于 diagnosis 领域，**不是** Agent 表

Phase 1 的 `db.py` / `models/__init__.py` 注释把 `t_inference_cache` 列进了"Agent 拥有、不建模"的清单。**这是错的**，已更正。

**证据**：

```
grep -rl "InferenceCache" src/main/java/
  → mapper/InferenceCacheMapper.java
  → model/entity/InferenceCache.java
  → service/impl/DiagnosisServiceImpl.java     ← 唯一的写入方
```

其余 5 张表（`t_agent_session` / `t_agent_message` / `t_chat_session` / `t_chat_history` / `t_upload_task`）则确实只被 Agent 代码引用，归类正确。

**后果**：Phase 2.2 需要为 `t_inference_cache` 写 ORM 类。其 DDL 见 `schema.sql:226-249`，唯一键 `uk_inference` 是 5 列 `(imageHash, modelVersion, weightSha256, preprocessVersion, inferencePolicyVersion)`，经 V2→V7→V9 三次变更而来。注意 Java 实体用 `IdType.ASSIGN_ID`（雪花），而 DDL 是 `AUTO_INCREMENT`——**以实体为准**，Python 侧用雪花 ID。

### 复用 `EyeDiseaseModel` 的三个副作用

进程内 import 意味着模型对象活在 web 进程里。`eye_disease_model.py:82-117` 的构造函数有三处不宜照单全收：

| 副作用 | 位置 | 影响 |
|---|---|---|
| `set_seed()` 改全局 RNG | `:82` → `:31-38` | 污染进程内 `random`/`np`/`torch` 种子，影响其他并发请求 |
| 建 `AdamW` + `CosineAnnealingLR` | `:110-117` | 推理不需要，为 ~20M 参数分配优化器状态 |
| `torch.backends.cudnn.deterministic = True` | `:36` | 全局关闭 cudnn benchmark，影响吞吐 |

**裁定**：进程内复用 `EyeDiseaseModel` 本身（不复写模型定义），但**在 lifespan 里只加载一次并复用**，且记录上述副作用为已知项。是否改造 `__init__` 属于 `algorithm/` 既有代码，本次重写不改动，留待训练流程回归时一并处理。

### 已存在的缺陷（非本次引入，记录以免误判为迁移事故）

`eye_diagnosis/frozen_eval.py:30` 调用 `model.predict_batch(image_paths)`，但**全仓库没有 `predict_batch` 方法**（grep 仅此一处命中）。`EyeDiseaseModel` 只有单图的 `predict_logits(image_path)` / `predict(image_path)`，且参数是**文件系统路径**不是 bytes。

**对 web 层的约束**：`/diagnosis/upload` 走内存 bytes，必须先落临时文件再调 `predict_logits`，不能假设有批量 API。这是设计约束，不是可选项。

---

## 裁定 13：修正方案里关于 COS 降级的错误描述

**方案原文**：「COS 上传失败要降级（`DiagnosisServiceImpl` 现有行为：图片 URL 为 null 但结果照常入库）。」

**这条是错的。** 逐步核实：

```java
// DiagnosisServiceImpl.java:204-212
String imageUrl = null;
try {
    imageUrl = detail.getUrl();
} catch (Exception e) {
    log.error("COS upload failed", e);      // 只记日志，不重新抛出
}
```

此后 `imageUrl` 保持 null → `vo.setUrl(null)` `:216` → `voToObj` 拷贝 null → `if (imageUrl != null)` 守卫跳过写入 `:221-223` → MyBatis Plus 的 `FieldStrategy.NOT_NULL` 把 null 字段**整个从 INSERT 里剔除** → 但列定义是：

```sql
-- db/schema.sql:28
url VARCHAR(512) NOT NULL COMMENT '图片 url'      ← 无 DEFAULT
```

`grep -rn "url" db/migration/` 无任何把它改成可空的迁移。

**结论**：COS 失败 ⇒ INSERT 因 NOT NULL 违约而抛异常 ⇒ 被 `:249` 的兜底 catch 捕获 ⇒ 客户端收到 `code=50000 "系统错误"`，**且该行根本没有入库**。不是"url 为 null 但结果入库"。

**裁定**：Python 侧复刻现状——COS 失败不重新抛出，INSERT 仍因 `url` 为 NULL 而失败，整体抛 `SYSTEM_ERROR`。

**为什么明知会失败还要复刻**：这是当前线上行为。改成"降级入库"会让前端从"上传失败"变成"诊断成功但图片 404"，是**更糟的静默故障**。若要修（让 `url` 可空或存占位符），应作为独立缺陷单独提出并同步改前端，不夹带在迁移里。

**对照**：`/diagnosis/upload` 端点的策略**相反**——`FileManager.java:85-90` 把 COS 失败抛成 `BusinessException(SYSTEM_ERROR, FAIL_UPLOAD)`，压根不碰数据库。同一个 service 里两种策略并存，迁移时不要想当然统一。

---

## 裁定 14：`severity` 恒为 `"NOT_ASSESSED"`，不是中文低/中/高

**方案原文**：「`severity` 是中文字符串 `'低'/'中'/'高'`」

**这也是错的**。`DiagnosisServiceImpl.java:445` 唯一一处赋值是硬编码常量：

```java
vo.setSeverity("NOT_ASSESSED");
```

Java 侧**从不根据概率或类别推断严重程度**，也没有 `DiagnosisSeverityEnum`。前端两处渲染：

| 位置 | 期望值 |
|---|---|
| `components/diagnosis/DiagnosisResult.vue:356-365` | `normal`/`mild`/`moderate`/`severe`/`NOT_ASSESSED`（英文，含 `NOT_ASSESSED`） |
| `components/user/DiagnosisReportDetail.vue:244-260` | `低`/`中`/`高`（中文）—— **死分支**，后端永不产出 |

**裁定**：Python 侧同样硬编码 `"NOT_ASSESSED"`。契约测试断言 `severity ∈ {"NOT_ASSESSED"}`（当前唯一可能值），而不是方案里写的 `{低,中,高}`。

顺带记录契约表里另外两条容易写错的：

- **`humanReviewStatus`** 是 5 值 `PENDING_AI`/`AI_ONLY`/`AWAITING_REVIEW`/`REVIEWED`/`OVERRIDDEN`（`constant/HumanReviewStatus.java:15-19`，是 String 常量接口而非 enum）。
- **`recommendations`** 是多行中文建议、`\n` 拼接的**字符串**（`DiagnosisRecommendationEnum.java:9-38`），存进 `VARCHAR(512)`。Python 侧**不得重新折行**，否则列溢出。

---

## Phase 2.2 需照抄的 Java 行为陷阱（不改）

调研列出的陷阱中，以下几条若在移植时被"顺手修好"，行为会静默变化：

| # | 陷阱 | 若"修好"的后果 |
|---|---|---|
| 1 | `sortField` 为空时不加 `ORDER BY`（`DiagnosisServiceImpl:137`） | 加了默认排序 → 分页结果顺序变化 |
| 2 | `sortField` 原样拼进 SQL | 加白名单 → 拒绝 Java 原本接受的请求 |
| 3 | `getDiagnosisQueryWrapper:134` 条件标志用 `id` 而列名是 `userId`（死守卫） | "修正"后语义改变 |
| 4 | `doDiagnosis` 无 `@Transactional` | 加事务 → 崩溃时残留状态不同 |
| 5 | `getDiagnosisManageVOList` 逐行查用户（N+1） | 改批量 → 用户行缺失时的行为不同（Java 会 NPE） |
| 6 | `t_diagnosis.image_hash` 列存在但**实体无对应字段**（死列） | 加映射 → 改变缓存语义 |
| 7 | `DiagnosisManageVO.status = "已完成"` 是常量，**非 DB 列** | 改成读库 → 该字段永远为空 |
| 8 | `DiagnosisResultVO.disclaimer` 声明但全仓库从未赋值 | 填充它 → 前端多出内容 |

---

## 裁定 15：ORM 与 DDL 的默认值分歧（由契约测试抓出）

写 `test_diagnosis_models.py` 时对账发现：Phase 1 建的 `Diagnosis` ORM 把 `reexamineStatus` 声明成 `default=0`，而真实 DDL 是：

```sql
-- db/callback/beforeMigrate__bootstrap_legacy_flyway_schema.sql:27
reexamineStatus INT NOT NULL DEFAULT 1,
```

**0 根本不是合法状态**。`ReexamineConstant` 只定义三个值：`1` undone / `2` waiting / `3` done。

**为什么之前没炸**：当前所有 INSERT 路径都显式赋值（`recordHumanReview` 写 3、`reexamineDiagnosis` 写 2），默认值从未被读取。属于潜伏 bug——一旦有代码路径依赖默认值，新建的诊断记录会带上无法被任何状态过滤识别的 0。

**已修正**为 `default=1`，并补测试 `test_orm_default_matches_ddl_default_for_reexamine_status` 钉住 ORM 默认值必须等于 DDL 默认值。

**顺带修正的认知错误**：`t_diagnosis` 的 DDL **不在 `schema.sql` 里**——它由 Flyway 遗留基线 `db/callback/beforeMigrate__bootstrap_legacy_flyway_schema.sql` 创建。对账脚本必须去 callback 目录找，否则会把"找不到列"误判成"列不存在"。

---

## Phase 2.2 当前进度

| 产物 | 状态 |
|---|---|
| `web/models/diagnosis.py` + `web/models/inference_cache.py` | 完成，列与 DDL 一一对账通过 |
| `web/inference.py`（进程内推理，替代 gRPC） | 完成，延迟导入，fail-closed |
| `web/schemas/diagnosis.py` | 完成，6 个 DTO/VO |
| `web/routers/diagnosis.py`（8 端点） | 完成 |
| `web/tests/test_diagnosis.py` | 完成 |
| 全量测试 | **183 passed / 5 skipped**（skipped = 默认解释器无 numpy 的数值测试） |
| Java 基线 | `git status --porcelain -- src pom.xml frontend` 空；`mvn -o -q compile` exit 0 |

---

## 裁定 16：`sortField` 是列名，不是 ORM 属性名

`QueryWrapper.orderBy(boolean, boolean, String... columns)` 把列名**原样拼进 SQL**。前端发的是 camelCase 的列名（`createTime`），不是 Python 属性名（`create_time`）。

Phase 2.1 的 `web/routers/user.py` 写的是 `getattr(User, query.sortField, None)` —— **永远取不到**。查询照样成功，只是静默丢掉 `ORDER BY`，分页结果顺序变成数据库默认顺序。这正是"测试全绿但线上行为不对"的典型形态。

**修正**：两个 router 都改成查表列映射：

```python
column = User.__table__.columns.get(query.sortField)
if column is not None:
    stmt = stmt.order_by(column.asc() if is_ascending(query.sortOrder) else column.desc())
```

副作用是好的：Java 那边 `sortField` 是 SQL 注入面（拼接进 ORDER BY），Python 侧查不到列就退化成"不排序"，最坏情况从注入变成排序失效。列名不匹配时行为仍与 Java 一致（无 ORDER BY）。

**测试**：`test_sort_field_is_a_column_name_not_a_python_attribute`、`test_unknown_sort_field_cannot_reach_sql`。

---

## 裁定 17：启动时权重加载失败**不**中止应用

`grpc_server.py` 的 `__main__` 构造 servicer，模型加载失败就进程退出。这对"这个进程只干推理"是对的。

但 web 层有 8 个端点，其中 **7 个不需要模型**（三个列表、delete、get、update、upload）。若照搬"加载失败即退出"，本仓库**默认状态**（`checkpoints/` 下没有任何 `.pth`）就会让整个 diagnosis 域下线。

**裁定**：`lifespan` 里 `_build_inference_engine()` 无论成败都返回 engine，失败只记 warning。`POST /diagnosis/diagnosis` 通过 `_require()` fail-closed，调用方拿到 `50000`/`系统错误`，**不写任何行**。

这与裁定 12 的推理层 fail-closed 不矛盾：*请求*层面严格拒绝，*进程*层面保持可用。

---

## 裁定 18：COS 失败后的 null url 显式抛错，而非等数据库拒绝

裁定 13 记录了 Java 的真实行为：COS 失败被 `catch` 吞掉 → `imageUrl` 保持 null → `setUrl` 被 `if (imageUrl != null)` 跳过 → INSERT 撞 `url NOT NULL` → 整个方法 catch-all → `50000`/`系统错误`，**行不入库**。

Python 侧选择**显式抛出同样的信封**而不是依赖驱动报错：

```python
if image_url is None:
    raise BizError(ErrorCode.SYSTEM_ERROR, SYSTEM_ERROR_MESSAGE)
```

理由：`t_diagnosis.url` 是 NOT NULL，行为上必然失败；显式抛让失败点确定、与驱动无关、且可被测试钉住。线上的 `{code, msg, data}` 与 Java 逐字节相同。**承诺不变：COS 故障不会留下一条图片不可达的诊断记录。**

---

## 裁定 19：`DiagnosisResultDTO` 无 AI 字段是结构性保证

`recordHumanReview` 只把 `human*` 四个字段拷到实体上。Python 侧更进一步：`DiagnosisResultDTO` **根本不声明** `result`/`probability`/`details`/`aiRejected` 等字段（`extra="ignore"`）。

于是"管理员不能通过复诊接口改写 AI 结论"不是靠逐字段过滤，而是**没有字段可写**。前端本来就会连同 AI 字段一起 POST，所以必须是 `ignore` 而不是 `forbid`。

---

## 裁定 20：news 领域**没有建档入口**

7 个端点全是读、改、删。唯一的 INSERT 路径有两条，都走不通：

1. **`/uploadCover` 不带 id** → 构造的 `News` 只有 `title`/`userId`/`coverImg`，而 `content` 和 `publishTime` 是 `NOT NULL` 且无默认值（`schema.sql:57,61`）→ INSERT 必然失败 → `50000`/`系统错误`。
2. **`/edit`** → `saveOrUpdate` 在 id 非空时走 `updateById`，**不是** insert。id 不存在就是 0 行受影响 → `操作失败`。

前端同样没有建档路径：`NewsEditPage.vue` 的 `id: Number(route.params.id)` 在 `/news/edit/:id` 上没有 id 时得到 `NaN` → JSON `null` → `PARAMS_ERROR`。

**结论：news 记录只能由数据库迁移脚本或手工插入产生。** 这是现状，Python 侧原样复刻（`/uploadCover` 无 id 分支显式抛 `SYSTEM_ERROR`，`/edit` 只做 UPDATE）。没有"顺手加个 create 端点"——那会让 Nginx 切流后出现一个 Java 侧不存在的入口。

---

## 裁定 21：`/edit` 忽略 `coverImage`，`/uploadCover` 覆盖标题与作者

两个字段名不一致导致的连锁问题：

| 位置 | 字段 |
|---|---|
| `NewsUpdateDTO` / `NewsVO` | `coverImage` |
| `News` 实体 / `t_news` 列 | `coverImg` |

`BeanUtils.copyProperties` 按属性名匹配，名字不同就**静默丢弃**。`NewsServiceImpl:97` 的 `newsVO.setCoverImage(news.getCoverImg())` 就是为读路径打的补丁——**写路径没有补丁**，所以 `/edit` 从来改不了封面。

前端之所以没暴露这个问题：它分两步。`NewsEditPage.vue:73` 先调 `uploadCover` 落盘封面，`:105` 再调 `/edit` 传回同一个 URL（被忽略也无妨，库里已经是它了）。

**而 `/uploadCover` 本身是破坏性的**（`NewsServiceImpl:124-135`）：

```java
news.setTitle("");                          // 标题被清空
news.setUserId(loginUser.getId());          // 作者被改成上传者
news.setCoverImg(url);
```

MyBatis Plus 默认 `NOT_NULL` 字段策略**跳过 null 但写入空串**，所以这两列真的会被覆盖。正常流程下 `/edit` 会把标题补回来；但用户传完封面直接关掉浏览器，标题就没了，作者也变了。

**裁定：忠实复刻**（`/edit` 忽略 `coverImage`；`/uploadCover` 写 `title=""` 和 `userId`）。理由是这个两步流程今天是可用的，不存在需要修的崩溃；删掉那两列虽然对所有调用方都不可见且更安全，但那是**行为变更**而不是移植，应当由 Java 侧同步修掉再一起切。

**建议**：在 Java 侧把 `NewsServiceImpl:125-126` 两行删掉，或让 `NewsUpdateDTO` 的字段名对齐为 `coverImg`，两边同一次发布。

---

## 裁定 22：公开新闻列表不过滤 `status`，草稿对外可见

`t_news.status` 定义为 `0草稿 / 1已发布 / 2下架`，但：

- `getNewsQueryWrapper` 没有 status 谓词；
- `NewsVO` 不声明 `status` 字段，前端拿不到，也无从过滤。

`POST /news/list/page/vo` 与 `/news/get/{id}` 都**没有 `@AuthCheck`**，匿名可读。结果是 0（草稿）和 2（下架）的文章与正常文章一起出现在公开列表里。

**裁定：复刻**。加过滤会改变公开 API 的返回内容，而前端没有任何地方假设"列表里都是已发布的"——它拿到的就是全量。加过滤属于行为变更，需要 Java 侧同批发布。

---

## 裁定 23：news 的删除是**物理删除**

`t_news` 没有 `isDelete` 列，`News.java` 也没有 `@TableLogic`，所以 `removeById` 发出的是真 `DELETE FROM t_news`。这与 `/user/delete/{id}`（逻辑）和 `/diagnosis/delete/{id}`（逻辑）相反。

后果：`t_paragraph` / `t_attachment` 引用该新闻的孤儿行不会被清理（`schema.sql:71-77` 声明的 `newsId` 没有外键约束）。

**裁定：复刻**，并在测试 `test_news_entity_has_no_logic_delete_field` 里钉死，防止后来者"为了保持一致"给 news 也加个 `isDelete` 过滤。

---

## 裁定 24：新闻缓存 key 是**空格分隔且无版本号**

```java
String redisKey = String.format("diagnosis:listNewsVOByPage %s", hashKey);  // :87
```

对比另外两个域：

| 域 | key |
|---|---|
| user | `diagnosis:listUserVOByPage:v2:{md5}` |
| diagnosis | `diagnosis:v2:listDiagnosisVOByPage:{md5}` |
| **news** | **`diagnosis:listNewsVOByPage {md5}`**（空格，无 v2） |

**裁定：逐字复刻**，且不打算"顺手"加 `v2`。规范化会让 Redis 里现存条目全部失效。三个域互不共享条目，且 Nginx 把该路径整条路由到单一后端，跨服务读到对方缓存本来就不可能。

另外，news 的缓存 key **不含用户维度**——这与 user/diagnosis 相反，但是正确的：新闻是公开数据，没有可泄漏的东西。

---

## 裁定 25：重复保存未修改的文章会返回"操作失败"

`updateById` 返回受影响行数，MySQL 默认返回**变化行数**（不是匹配行数），所以一次空写 = 0 → `ThrowUtils.throwIf(!result, OPERATION_ERROR)` → 前端弹"保存失败"，而文章其实保存正确。

这条**无法在 SQLite 上验证**（SQLite 的 `changes()` 数的是匹配行），所以测试 `test_no_op_save_outcome_depends_on_the_driver_and_is_left_to_it` 只钉住规则（`rowcount <= 0` 失败），把"空写算不算失败"留给驱动决定，并写明放宽它会影响每一次幂等重存的响应。

---

## Phase 2.3 交付说明

| 产物 | 状态 |
|---|---|
| `web/schemas/news.py` | 完成，4 个 DTO/VO |
| `web/routers/news.py`（7 端点） | 完成 |
| `web/tests/test_news.py` | 完成，41 个测试 |
| 全量测试 | **224 passed / 5 skipped**（skipped = 默认解释器无 numpy） |
| Java 基线 | `git status --porcelain -- src pom.xml frontend` 空；`mvn -o -q compile` exit 0 |

关键设计约束（来自裁定 12/13/14，写码时必须遵守）：

1. 推理层**一律延迟导入**——`eye_disease_model`、`quality`、`calibration`、`ood` 都在 module scope 依赖 numpy/torch，默认解释器里全缺。`web/inference.py` 与 `web/config.py` 都有"导入时不拉 torch"的测试（子进程 + AST 双证）。
2. `severity` 恒为 `"NOT_ASSESSED"`，不是中文低/中/高。
3. COS 失败**不**降级入库（裁定 18）。
4. `predict_logits` 只吃**文件系统路径**，`/diagnosis/upload` 的内存 bytes 必须先落临时文件。
5. `t_inference_cache` 写入语义是 `ON DUPLICATE KEY UPDATE id = id`（插入即忽略，**从不刷新**），不得改成会覆盖的 upsert。已在 ORM 上补 `uk_inference` 唯一约束，让这条语义可测。
6. `probability` 是 **0-100 百分比**；`decide_abstain` 的阈值（0.7 / 0.15）在 **0-1 空间**评估。混用会静默关掉 abstain 门。
7. `DiagnosisManageVO.reexamineStatus` 是原始 `int` → JSON **数字**；`id` 是 `Long` → JSON **字符串**。别用 `LongStr` 标注前者。

---

## Phase 2.2 交付说明

上面第 1–7 条同样适用于 news 领域，另加两条 news 专属约束：

8. news 的删除是**物理删除**（无 `isDelete` 列、无 `@TableLogic`），与 user/diagnosis 相反（裁定 23）。
9. 三个域的缓存 key **各不相同**，news 的是空格分隔无版本号（裁定 24）。不得统一。

---

## Phase 0.2 的遗留说明

`application-dev.yml` 与 `application-local.yml` 是 gitignored 文件，仓库里查不到，只能在本地检出目录读到。裁定 2/3/4 均已由 **`application-server.example.yml`（tracked 的生产模板）独立佐证**，因此结论可靠——不依赖本地未提交文件。

`application.yml` 本身**没有任何 jackson 配置**，全部依赖 profile 覆盖。若将来 `spring.profiles.active` 变更，日期格式会退回 Jackson 默认（epoch 毫秒）而前端行为随之改变。建议把 `spring.jackson` 提升到 `application.yml` 基线——属 Java 侧改动，本次记录不改。
