# Iris Roundtable 3.0 · #87 最终集成报告

- **日期**：2026-11-18
- **分支**：`feat/roundtable-final-integration`（单一正式集成分支；未 force push、未 rebase 共享分支、未直接推 `ui`）
- **目标基线**：`origin/ui` @ `b805377f`
- **集成 HEAD**：见文末 §8（本报告与代码同批入库）
- **状态**：**MERGE_READY_WITH_FOLLOWUPS**（应用侧改动与验证全绿；协作开关保持默认关闭；生产开放与临床启用另需审批）

---

## 1. 范围与基线

本轮做一件事：把 Roundtable 3.0（#87）、医学语义修复（#100）、R5 已验证联合修复与产品负责人批准的
E-09 Fusion 首屏，一次性集成到最新 `ui`，并落地区块任务书 §4.1–§4.4 的四项最小必要整改。

| 来源 | 提交 | 处理 |
|---|---|---|
| PR #87 Roundtable 3.0 | `9a6dbcb6` | 已是集成 HEAD 祖先（未重复 cherry-pick） |
| PR #100 医学语义 | `18126256` | 已是集成 HEAD 祖先 |
| 历史修复 | `3a2ad688` / `990559d8` / `7fc98733` | 均已是祖先，**未二次应用** |
| R5 联合候选 | `local/r3-joint-20261118-v2` | 起点 `4138b545` 已包含其全部提交 |
| E-09 候选 | `local/e09-hero-compare-20261118` | 同上；本轮只做接入与复验，不重做 A/B/C |

- 复用 `.worktrees/r5-joint-v2`，没有新建重复工作树；本地 R5 / E-09 候选历史未被改写。
- 相对 `origin/ui` 领先 141 个提交（集成提交另计），历史线性，无 merge commit。

## 2. 四个改造点的落地

### 2.1 §4.1 正式临床复核写入安全关闭

- 新增 `service/ClinicalReviewQualification.java`：资质判定**恒为 false**，理由常量对外返回。
  故意不提供按角色放行的分支——任何 `role == admin/doctor` 的放行都会重新引入 D-01b 越权路径。
- `DiagnosisServiceImpl#recordHumanReview` 用该门禁替换原 `ADMIN_ROLE` 判定，抛
  `NO_AUTH_ERROR` + 安全关闭文案；门禁在**读取记录之前**执行，响应不随记录是否存在而变化。
- 复核路由与 DTO 形状保留（历史前端/文档可追溯），写入由服务层拒绝。
- 历史 `REVIEWED` 与 `t_diagnosis_audit` **原样保留**；展示层一律标「资质未核验」，
  **不按 `reviewerRole` 豁免**——账号角色可被改派，拿它当资质证明等于把角色当资历。
- 管理端移除复核弹窗与「人工复核」写入入口，改为禁用项 + 安全关闭说明；
  新增只读 PROVENANCE 区块（来源 / 草稿审核 / 患者授权 / 复核人角色 / 影像归档）。
- 未做：医生资质平台、排班/派单、数据库大改。

### 2.2 §4.2 来源、回执与时间契约

- `DIRECT` 与 `COLLABORATION_DRAFT` 保持分离；来源与患者授权仍是两个字段。
- `DiagnosisSourceProjection` 增加第 9 个组件 `authorizationDetailsRestricted`；
  `DiagnosisSourceProjectionService` 增加 3 参重载：
  - 本人：`false`，回执前缀 / 授权时间 / 任务 id 照常下发；
  - 非本人（管理端复核视角）：`true`，三者不下发；**粗粒度 `authorizationState` 仍下发**，
    界面显示「患者已授权保存 · 详情按最小权限不展示」，与「没有授权」可区分。
- `authorizedAt` 的 8 小时偏移在 SQL 边界修掉：`DATE_FORMAT(authorizedAt,'%Y-%m-%dT%H:%i:%sZ')`
  直接产出 UTC 字面量，绕开 JDBC `Timestamp.toString()` 的时区重解释。
  前端 `formatAuthorizedAt` 按显式时区格式化；无时区的历史值原样回显并标「未标注时区」。
- 投影读失败时（全空 + `UNKNOWN`）：患者端与**管理端**都只说「这次没有读到」，
  不写成「未记录 / 无授权记录」。
- 未做：完整回执入口（当前只给 8 位前缀 + 省略号），已登记为后续项。

### 2.3 §4.3 Agent 工具状态

- 保留既有 SSE `toolCallId` / 回执 / 投递机制，**没有第二套状态机**。
- `ThoughtLine` 把「已用时长」挂到**每一步自己**身上（`RunningElapsed` 子组件）：
  并发/连续工具各算各的起点，换步即卸载归零；只报真实已过去的时间，不编造百分比或「预计剩余」。
- 失败 / 取消 / 待确认 / 未知（刷新后）语义不变：「未确认」仍是问号而不是「执行中」。

### 2.4 §4.4 E-09 Fusion R2-b 接入

- `LandingHero` 主视觉由 Prism 换成 `HeroFusion`（全幅环境光 + 壳内受控光学主体），
  顶栏 / 标题 / 双 CTA / 信息卡 / 入口行保持原样；5 秒可见时间窗后定格、`prefers-reduced-motion`、
  WebGL 回退、单渲染循环均保留。
- 修掉接入后发现的一处档位缺陷：`≤1024` 时 Fusion 把光学主体挪到左侧/下半区，旧横向遮罩
  （`brand.css` 的 `.landing-hero__flow`）正好压在最亮的主体上（实测 820 亮色档棱镜与底色
  R 通道差仅 2–22，低于 18 门槛）。改为竖向渐隐后在**最终生产构建**上复测：820 亮色档
  ΔR = 106（(250,745) R=120 vs 局部底色 (250,690) R=226），390 亮色档 ΔR = 133
  （(105,795) R=117 vs (118,745) R=250）。
- `/design/hero-compare` 只在 `import.meta.env.DEV || VITE_DESIGN_PREVIEW === "true"` 下注册
  （`web/src/App.tsx:82`）；生产构建产物 `grep hero-compare dist/` 为 0 命中。
- `DESIGN.md` §3.6 / §7、`docs/README.md`、`docs/reviews/iris-hero-fusion-r2-review.md`
  同步记录放行与接入位置。

## 3. 测试与验证证据

### 3.1 后端

| 项 | 命令 | 结果 |
|---|---|---|
| 编译 + 全量单测 + MySQL 门禁 + 隔离库套件 | `scripts/verify.sh` | **全绿**：pass 1 跑 654 例（303 skip，均为需要外部凭据的用例）/ pass 2 新 schema 上的 MySQL 集成门禁 7 例 / pass 3 隔离库协作·草稿·复核 303 例，0 失败 |
| 文档契约门禁 | `check_design_doc.py` / `check_steering_docs.py` / `check_probability_scale.py` | 3/3 通过 |
| 报告门禁单测 | `python -m unittest discover -s scripts/tests -p "test_check_*.py"` | 39 项通过 |
| 协作线契约 | `check_collaboration_fixture.py` | 16 事件类型 / 12 快照字段通过 |

权限与医学语义正反例（`FullApplicationAcceptanceTest`，真实 MySQL）：

- 本人：`authorizationDetailsRestricted=false`，`authorizedAt` 以 `Z` 结尾；
  期望值由 `Timestamp.toInstant()` 独立还原，不再与生产 SQL 用同一条表达式（避免同义反复）。
- 管理员：`restricted=true`，`authorizedAt` / `authorizationReceipt` / `patientTaskId` 为 null，
  响应体不含回执前缀与内部对象键。
- 管理员写正式复核：非 0 code、文案含「安全关闭」、`humanReviewStatus` 不变、无审计行。
- 授权 + 草稿批准都齐，`humanReviewStatus` 仍为 `AI_ONLY`。

### 3.2 前端

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `node node_modules/typescript/bin/tsc -b` | 通过 |
| ESLint | `node node_modules/eslint/bin/eslint.js .` | 0 error / 0 warning |
| 单元测试 | `node node_modules/vitest/vitest.mjs run` | 85 文件 / 903 用例全过 |
| 生产构建 | `node node_modules/vite/bin/vite.js build` | 通过 |
| e2e 门禁 | `check:e2e-fixme` / `check:gate-tests` | 0 fixme；6/6 通过 |

### 3.3 浏览器 E2E

前端：`vite` dev（`:5174`，`VITE_COLLABORATION_ENABLED=true`）与生产构建预览（`:4173`）。
真实后端：本工作树产物（`mvn package`）跑在 `:18081`，数据源为 MySQL 8.0.26 独立库
`diagnosis_e2e`（Flyway 全量迁移），Session 内存、COS / DashScope 占位。
协作真实链路：`CollaborationBrowserServer`（`:18085`，测试 classpath）+ 独立库
`collaboration_test`，存储/推理/模型为合成夹具。

| 场景 | 用例 | 结果 |
|---|---|---|
| 登录 / 判读槽 / 记录纸（真实 + 合成链）/ 资讯详情 / Agent 回复与「未确认」 | `smoke.spec.ts` | 9/9 |
| 协作工作台夹具（契约、投影、终态、截图、触控与焦点） | `collaboration.spec.ts` | 43/43 |
| 管理端列几何 / 送达对比度 / 系统状态 / 冻结 UI 版式 | `admin-columns` / `agent-delivery` / `system-states` / `ui-freeze-regression` | 13/13 |
| 协作真实后端：上传 → 增量事实 → 复核 → 刷新 → 取消 → 撤回 | `collaboration-backend.spec.ts` | 1/1 |
| 协作安全：患者/医生隔离、批准读、显式保存、撤回后回执不可变、停受理、驳回阻断发布 | `collaboration-safety.spec.ts` | 4/4 |
| 生产构建默认关闭协作 | `collaboration-default-off.spec.ts`（`:4173`） | 1/1 |
| 折叠导航：协作开启档（8 例）/ 协作关闭档（1 例） | `nav-breakpoint.spec.ts` | 8/8 + 1/1 |

> `nav-breakpoint` 的两组用例分别依赖**构建期开关**，必须各在对应构建下跑：开关开启档跑
> dev（`:5174`），关闭档跑生产预览（`:4173`）。单构建里同时跑两组会各红一半——这是用例
> 设计使然，不是回归。

### 3.4 E-09 真实首页复验

`web/scripts/evidence/hero-landing.mjs` 对**最终生产构建的 `/`** 复验（报告与截图同批入库），
8 张截图入库于 `docs/reviews/assets/iris-roundtable-final-integration/`
（390 / 820 / 1440 / 1920 × 浅/深）：

- 8/8 组合 `data-mode=settled`，定格后 2 秒内 WebGL draw 次数 **0**（真停，不是只改属性）；
- 横向溢出 0；失败的静态资源请求 0；
- 每档都有标题、双 CTA（`探索影像分析` / `探索 AI 协作`）、信息卡、3 个入口、canvas 与光学 SVG；
- `landing-report-summary.json` 入库了上述逐档读数，可独立复核（不依赖不入库的 `target/`）。

### 3.5 口径声明

以上全部是**在真实应用上运行的合成数据验收**：模型、影像存储、算法推理均为受控替身，
权限与投影断言使用合成记录。**不构成真实临床验证**，也不代表真实模型推理性能。

## 4. 三条独立评审线

三条线各自独立读代码与产物（不共享我的结论），报告分别落在
`target/review-permissions.md` / `target/review-integration.md` / `target/review-ui.md`（不入库）。

| 线 | 结论 | P0 | P1 | 处置 |
|---|---|---|---|---|
| 权限与医学语义 | MERGE_READY_WITH_FOLLOWUPS | 无 | 1（`reviewerRole=doctor` 时丢掉「资质未核验」） | **已修**：删除角色分支，患者端与端内一律标「资质未核验」；补测试 |
| 全栈集成与可靠性 | MERGE_READY_WITH_FOLLOWUPS | 无 | 2（管理端抽屉把「读不到」显示成「未记录」；ThoughtLine 计时跨步串值） | **已修**：抽屉复刻「读不到 ≠ 没有」守卫并区分授权状态；计时改为按步骤独立 |
| UI 与浏览器回归 | MERGE_READY_WITH_FOLLOWUPS | 无 | 3（820/390 亮色档棱镜对比度不足；计时并发残余；报告未入库） | **已修**：换竖向遮罩并重拍复测；计时改为每步一个组件并补并发用例；报告同批入库 |

评审提出的 P2 中，**已顺手修掉**：非本人视角仍显示粗粒度授权状态、REVIEWED 在各端口径统一、
管理端不再漏英文枚举、`formatAuthorizedAt` 补纯函数用例、投影服务加 restricted 单测、
集成断言改成独立还原、审计测试留恢复指针、`docs/README.md` 与 `DESIGN.md` 的旧状态、
入库摘要补上「标题/CTA/卡片/入口/canvas」读数、`submitReview` 标 `@deprecated`、
计时读数改 11px + `--fg-2` + 可访问名。

登记为**非阻塞后续项**（见 §6）：`NO_AUTH_ERROR(40101)` 同时表达「策略关闭」、
`project(id,url)` 两参重载的「默认不限制」、管理端抽屉新 UI 的浅/深截图、
`.admin-diagnosis__drawer-facts` 末行底线死规则、复核 Modal 的孤儿 CSS。

## 5. 合并门槛判定

| # | 条件 | 判定 |
|---|---|---|
| 1 | 最新 HEAD 的 CI 全绿 | 见 §8（推送后回填） |
| 2 | 本地全栈 + E2E 通过 | ✅ §3.1–§3.4 |
| 3 | 无未决的权限 / 医学语义阻断项 | ✅ 三条评审线 P0 = 0，P1 全部整改 |
| 4 | 独立评审通过 | ✅ 三条线均 MERGE_READY_WITH_FOLLOWUPS，整改后复测 |
| 5 | 分支保护 / 评审 / 权限满足 | 见 §8（需仓库权限与评审） |
| 6 | 协作相关开关仍默认关闭 | ✅ `eye-diagnosis.collaboration.*` 五项全 `false`；React `VITE_COLLABORATION_ENABLED` 未设置即关闭；生产构建实测无协作入口 |
| 7 | 最终 PR 树 == 已测树 | 见 §8 |

## 6. 残余风险与后续项（登记，不阻塞本次集成）

1. **正式复核能力整体不可用**：系统没有资质数据源，写入安全关闭。积压的
   `AWAITING_REVIEW` 只会增加；需要产品侧决定资质平台或另一种复核路径。
   恢复写入时必须同时：改 `ClinicalReviewQualification`、恢复 `DiagnosisHumanReviewAuditTest`
   的审计用例（文件里已留指针）、解除管理端禁用项。
2. **`NO_AUTH_ERROR(40101)` 语义不精确**：「策略关闭」被客户端读成「你没权限」。
   当前无调用方，属交互债；建议换 `OPERATION_ERROR` 或新增码。
3. **协作 admin 投影**：管理员看医生投影依赖运维显式打开 `clinician-detail-enabled`
   （默认 false），影像字节仍读不到（`CollaborationImages` 只接受 `v1:patient` / `v1:doctor:`），
   `operations` 只返回聚合读数。登记：真开协作临床使用前，评估「admin 读取医生投影」是否需要审计留痕。
4. **完整回执入口未建**：当前只展示 8 位前缀；「本人凭额外鉴权查看完整回执」需单独设计。
5. **管理端抽屉新 UI 缺截图**：功能与冻结版式门禁都过了，但没有 1440 浅/深的抽屉截图；
   建议随 Issue #84 一并补。
6. **孤儿样式**：`.admin-diagnosis__review*`（复核 Modal）已无消费者；
   `.admin-diagnosis__drawer-facts` 的末行底线规则对 `display: contents` 的行无效。都属样式债。
7. **`GraphExecutionTest.databaseLeaseSurvivesHostClockSkew` 是环境时钟漂移敏感的 flaky 自助检查**：
   先读 `SELECT CURRENT_TIMESTAMP(6)`（MySQL 容器 = WSL2 VM 时钟），再读主机 `Clock.systemUTC()`，
   然后断言 `|measured − seconds×1000| < 1000`。本机两次触发：
   - 早先一次 `measuredSkew 7329`（期望 `6000±1000`），孤立复跑即绿；
   - 最终一轮两个参数同时红：`-4834` / `+4834`，即容器时钟滞后主机约 1.17 秒（该轮失败耗时仅 0.275 s，不是负载超时）。
   独立探针（`docker run --rm --entrypoint sh mysql:8 -c 'date -u +%s%3N'` 与主机时钟三点对齐）当时测得 +50 / +193 / +218 ms，
   说明这是 WSL2 侧时钟漂移的瞬时窗口，不是本分支引入的回归：该文件不在本分支 diff 内，
   最近三次改动都是 `4138b545` 的祖先。建议把两次取样合并到同一往返（`SELECT CURRENT_TIMESTAMP(6), ?`），
   或把这条**自助检查**的容差放宽到 2000ms——但不要用它掩盖真实的时序断言；
   断言之后的 lease / fencing 用例本身在每轮都是绿的。
8. **`project(id, url)` 两参重载是「默认不限制」的不安全默认值**：目前只剩降级与测试路径在调用。
   投影降级分支里 `authorizationDetailsRestricted` 写 `false`，但同一目标对象的 `recordSource`
   为 `null`，前后端都把「读不到」判在前面，不会退化成「没有授权」。建议后续删掉两参重载，
   强制调用方显式表达视角，并把降级标记为 `true`。
9. **协作 E2E 夹具服务器启动方式**：`scripts/run_task05_browser_server.ps1` 在 PowerShell
   `$ErrorActionPreference='Stop'` 下会把 JVM 的 stderr（Mockito self-attach 提示）当成
   `NativeCommandError` 终止。本次改为直连 `java -cp`（classpath 取自 surefire XML）启动并跑通。
   建议脚本改为重定向到文件或把 `$ErrorActionPreference` 降到 `Continue`。

## 7. 明确未做（非目标）

- 医生资质认证平台、自动排班 / 派单；
- 存储对账与自动删除、COS → MinIO/S3 迁移；
- 真实模型临床性能验证；
- 生产部署与协作开关开启；
- 全站 UI 重设计、大架构重构。

## 8. 合并后核对与状态

（推送、PR、CI 与合并后回填：HEAD、Merge Commit、Tree SHA、冻结 tag 不变、旧 PR 链接。）
