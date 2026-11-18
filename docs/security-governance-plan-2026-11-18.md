# 安全遗留治理计划（2026-11-18）

> **本文档只做计划与核查口径，不改代码、不改密码策略、不动线上数据。**
> 来源：代码库考古报告 §5.1 与 §8-5（`docs/architecture/codebase-archaeology-2026-11-17.md`，
> 在 `feat/system-config-center` 线上）明确要求「给安全遗留制定治理计划，
> 而不是仅登记」。三条遗留：MD5→BCrypt 存量迁移、细粒度权限与配置中心安全边界、
> CSRF / Same-Origin 评估。

## 0. 结论摘要

| 遗留 | 现状（代码事实） | 缺口 | 结论状态 |
|---|---|---|---|
| A. MD5 → BCrypt 存量迁移 | 双校验 + 登录时即时升级，路径在役，有单测覆盖 | **存量数据未知**：还有多少 MD5 账号、多少永不升级、升级失败有没有监控 | 需要 DBA 只读查询后才能定退出条件 |
| B. 权限模型与配置中心安全边界 | `@AuthCheck` 实际只有「登录级 / ADMIN」两档 | 配置中心要管 Provider / API Key / 模型开关，缺权限矩阵、操作审计、密钥保护 | 三条是**上线门禁**，不是遗留优化 |
| C. CSRF / Same-Origin | 无 CSRF / SameOrigin 过滤器；CORS 精确白名单；会话是 Cookie + Redis | 会话 Cookie 的 SameSite 未显式配置，安全与否取决于浏览器默认行为 | **不宣称存在漏洞，也不宣称安全**——需要按载体实测 |

下面每一节都给「已核实的代码事实」和「还没拿到的证据」，两者分开写，避免把推测当结论。

---

## A. MD5 → BCrypt 存量用户迁移

### A.1 已核实

- `security/PasswordService.java`：新密码统一 BCrypt **cost 12**（`:21`）；`verify()`（`:27`）
  对 `$2` 开头走 BCrypt，对 32 位 hex 走 legacy MD5，盐是硬编码 `"yuwen"`（`:20`，`:36`）；
  命中 legacy 返回 `needsUpgrade=true`（`:45`）。
- `service/impl/UserServiceImpl.java`：登录时 `passwordService.verify(...)`（`:142`），
  `needsUpgrade()` 为真则**即时**重写为 BCrypt（`:148-151`）。注册/改密走 `encode()`（`:100`、`:359`）。
- 覆盖：`PasswordServiceTest` 断言 cost 12 生效（`:17`）与 legacy 命中要求升级（`:25-30`）。

### A.2 还没拿到的证据（本计划的第一个动作）

1. 存量分布：MD5 / BCrypt / 其它格式各多少账号。
2. 长期不登录因而**永不升级**的账号量。
3. 升级写库失败有没有记录（今天是登录主流程内同步 `updateById`，异常会被登录流程吞还是抛出，未测）。
4. 是否已有强制重置策略（当前代码里没有）。

### A.3 只读审计 SQL

在**从库**执行；`diagnosis.t_user` 的列名是小驼峰（见 `V15__baseline_legacy_tables.sql`）。

```sql
-- 1) 哈希格式分布
SELECT CASE
         WHEN userPassword LIKE '$2%'                     THEN 'bcrypt'
         WHEN userPassword REGEXP '^[0-9a-fA-F]{32}$'     THEN 'legacy_md5'
         ELSE 'other'
       END AS hashKind,
       COUNT(*) AS accounts
FROM diagnosis.t_user
WHERE isDelete = 0
GROUP BY hashKind;

-- 2) 仍是 MD5 的账号有多久没动静（updateTime 只是近似：改资料也会更新它，
--    但在没有 lastLoginTime 列的前提下，它是唯一可用信号）
SELECT CASE
         WHEN updateTime >= NOW() - INTERVAL 30 DAY  THEN '0-30d'
         WHEN updateTime >= NOW() - INTERVAL 180 DAY THEN '30-180d'
         WHEN updateTime >= NOW() - INTERVAL 365 DAY THEN '180-365d'
         ELSE '>365d'
       END AS lastActivityBucket,
       COUNT(*) AS accounts
FROM diagnosis.t_user
WHERE isDelete = 0
  AND userPassword REGEXP '^[0-9a-fA-F]{32}$'
GROUP BY lastActivityBucket;
```

> 不要把 `updateTime` 说成「最后登录时间」——**登录本身不写这个字段**，
> 只有升级密码或改资料才会。报告与本文都按「最后活动」表述。

### A.4 退出条件（建议值，需 owner 拍板）

| 条件 | 建议阈值 | 为什么 |
|---|---|---|
| MD5 账号占比 | < 0.5% | 剩下的都是长尾，维护 salt 硬编码分支的收益低于风险 |
| 连续窗口 | 连续 30 天无新登录命中 legacy | 避免「刚好没人登录」被误判为已迁完 |
| 超期账号 | 最后活动 > 180 天的 MD5 账号强制重置（重置链接/临时密码） | 这些账号永远不会自然升级，只能人工推 |
| 升级可观测 | 升级次数 / 升级失败数有指标或日志 | 没有它，退出条件无法验证 |

达标后的收尾（**单独 PR，本文不做**）：删除 `LEGACY_SALT` 与 hex 分支、删掉对应的
`needsUpgrade` 路径、保留 `PasswordServiceTest` 里对「非 BCrypt 一律拒绝」的用例。

### A.5 监控建议（不实现，登记待做）

- `password.upgrade.success` / `password.upgrade.failure` 两个计数器；
- legacy 命中率（按天），用于判断 A.4 的连续窗口；
- 强制重置任务的执行结果与剩余量。

---

## B. 细粒度权限与配置中心安全边界

### B.1 已核实

- `annotation/AuthCheck.java` 只有一个 `mustRole` 属性；`aop/AuthInterceptor.java`
  的实际语义是：
  - `mustRole` 为空 / 解析不出角色 → **直接放行**（不放行的是方法体自己再调 `getLoginUser`）；
  - `mustRole="user"`（`AuthConstant.DEFAULT_ROLE`）→ 只要求角色字段能解析成已知角色（user 或 admin 都行）；
  - `mustRole="admin"` → 必须是 `ADMIN`。
  也就是说：**只有「登录级」和「管理员」两档**，没有资源级权限。
- 角色枚举只有 `user` / `admin`（`model/enums/UserRole.java`）。
- 现状里的角色分布并不均匀：知识库上传是 `@AuthCheck`（无 mustRole）+ 方法内 `getLoginUser`，
  即任意登录用户可上传；新闻附件/封面是 `admin`；诊断上传是 `user`。
- `config/` 与 `security/` 下没有 CSRF / Same-Origin 过滤器（目录清单即证据）。

### B.2 配置中心的三条上线门禁

配置中心（`feat/system-config-center` 线的 PRD / ADR，未合入）将管理 Provider、API Key、
模型开关。这些是高价值目标，**在 WP-00 PASS 不等于可以上线**。上线前必须各自有实证：

| 门禁 | 最小可接受形态（MVP） | 完成判据 |
|---|---|---|
| **权限矩阵** | 部署期 yml 白名单授予 userId 列表，区分「可查看 / 可编辑 / 可发布回滚」 | 越权用例：非白名单用户对每个写接口都拿到拒绝，且有测试 |
| **操作审计** | 每次写操作落一行：谁、何时、改了哪个键、前后值（密钥只记是否存在，不记明文）、回滚链 | 能从审计表还原任意一次变更为可重放的操作序列 |
| **密钥保护** | `SECRET_REF` 只允许 `env:NAME` 引用，永不落明文；有轮转流程 | 全表扫描证明确实没有明文密钥；轮转后旧值失效有验证 |

### B.3 不做的事

- 不为了「补齐」而在现有 `@AuthCheck` 上硬加角色档位——细粒度权限的载体是配置中心自己的
  权限矩阵，抢跑会制造第二套真源。
- 不把本文档当作门禁通过的证据；门禁由各 WP 的验收用例证明。

---

## C. CSRF 与 Same-Origin 评估

### C.1 判定口径：先看载体，再看缺少什么

考古报告已经批评过「只看缺注解就下结论」的做法。当前载体的已核实事实：

| 载体 | 事实 | 对 CSRF 的影响 |
|---|---|---|
| 会话 | Cookie 承载（Spring Session + Redis，`pom.xml:123-125`；cookie 名与属性均未显式配置） | Cookie 会自动随跨站请求发出**除非** SameSite 挡住 |
| SameSite | `application.yml:1-9` 只配置了 `max-age`，**没有 `same-site`** | 依赖 Tomcat 默认（不加属性）+ 浏览器默认 Lax ⇒ 跨站 POST 不携带 Cookie。**但这是默认行为，不是显式声明** |
| CORS | 精确 Origin 白名单 + `allowCredentials(true)`（`CorsConfig.java:18,27,28`） | 挡住跨域读响应；挡不住「表单直发」这类简单请求 |
| 写接口形态 | 存在 multipart 写接口：知识库上传（`KnowledgeBaseController:51`）、诊断上传（`DiagnosisController:78`）、新闻附件/封面（`NewsController:231,347`） | multipart/form-data 属于 CORS 简单请求内容类型，不需要预检 ⇒ 风险只能由 SameSite 兜住 |
| CSRF 过滤器 | 无 | 这一层是空的 |

结论：**风险是否存在，完全取决于「浏览器实际收到的 Set-Cookie 是否带 SameSite」这一条**。
它今天没有被显式配置，所以不能声称安全。

### C.2 待实测清单（谁做、怎么做）

1. **部署环境响应头实测**（只读，一次就够）：
   ```bash
   curl -si -X POST https://<host>/api/user/login \
        -H 'Content-Type: application/json' \
        -d '{"userAccount":"__probe__","userPassword":"__probe__"}' | grep -i '^set-cookie'
   ```
   看有没有 `SameSite=Lax|Strict`。没有属性就说明靠浏览器默认兜底。
2. **回归口径**：若实测确认无属性且团队不接受默认行为，最小改动是在
   `application.yml` 显式写 `server.servlet.session.cookie.same-site: lax`，
   并补一条断言该属性的测试——**这一步单独 PR，不在本文范围**。
3. **简单请求清单核对**：本仓库复查结果为「无 `consumes` 限定；写接口里只有 multipart（`multipart/form-data`）这一种非 JSON 形态，没有 urlencoded / text-plain 写接口」，
   以后新增写接口时把这条当评审项。
4. **与多 Agent 线的重复逻辑收敛**：`#87` 带来 `SameOriginFilter`（未合入）。
   合入后必须确认不出现两套同源校验，配置中心 PRD 的 ADR D11 也是同一件事。

---

## D. 执行清单

| # | 动作 | 责任 | 前置 | 完成判据 |
|---|---|---|---|---|
| 1 | 跑 A.3 两条只读 SQL，把数字填回 A.2 | DBA / owner | 从库访问 | 本文 A.2 四条都有数据 |
| 2 | 定 A.4 阈值并登记成 Issue | owner | #1 | 阈值写死在 Issue 里，可复查 |
| 3 | 补齐升级成功率日志 / 指标 | 后端 | owner 批准 | 指标出现在监控里，能按天查 |
| 4 | C.2-1 响应头实测 | 运维 / owner | 部署环境可访问 | 截图或 curl 输出贴进 Issue |
| 5 | 配置中心三条门禁拆成 WP 验收项 | 配置中心 owner | PRD 推进 | 每门禁有对应验收用例 |
| 6 | 达标后删除 legacy MD5 分支 | 后端 | #2 阈值达成 | 单独 PR，`PasswordServiceTest` 同步收紧 |

## E. 关联文档

- 考古报告 §5.1 / §8-5：`feat/system-config-center` 线 `3c302504`（未合入 `ui`）。
- 配置中心 PRD 与 ADR D1 / D11：同线 `docs/config-center/`。
- 多 Agent 集成线的 `SameOriginFilter`：PR #87（未合入）。
- 本次逐项清理的其余 PR：#104–#112。
