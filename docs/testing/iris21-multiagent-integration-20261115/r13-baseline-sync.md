# R1.3 · UI 基线同步与游标修复

日期：2026-11-15。此文承接 R1.2，区分当前修复与历史证据，不重写历史失败为通过。
**夜间交接当前状态以文末追加为准**；前面表格记录 `01098ccb` 交付时的提交与验证范围。

## 交付与后续开发基线

| 项 | 当前证据 |
|---|---|
| Parent PR | #86，已按用户授权以 merge commit 合入 `ui` |
| Parent SHA | `b5f37e5cbbe66b440b2f907746735174ff817533` |
| UI 候选来源 | `chore/agent-env-retro`，`a7fbe265ec95c58aa0afb10fd57899548d0fde7b` |
| 多 Agent 分支 / PR | `feat/iris21-multiagent-integration` / #87（保持 Draft，不合并） |
| 本轮代码提交 | `ba29a9606b6157763e4856c8b625f8c61474dfc8`；本报告及截图为随后文档增量 |
| UI 同步提交 | `4edba92a` 合入最新候选；`0abc3da4` 继承正式 UI merge commit |
| Git ancestry | `git merge-base --is-ancestor ui HEAD` exit 0；已继承上述两个 UI 提交 |
| 提交与文件数 | 代码提交相对 Parent 为 103 个提交、426 文件；本报告与三张新截图加入后为 104 个提交、430 文件 |
| 来源完整性 | 保留原 PR #68 与工作台合并历史；没有 squash、force push 或改写冻结 tag |

后续多 Agent 开发从本分支的最新已验证 HEAD 继续，在 `iris21-multiagent` 工作树中开发。
新任务以本候选为 parent；不要从旧 `ui` SHA、`master` 或 PR #68 原线重开而漏掉本轮成果。
`ui` 保留 UI 成果，多 Agent 功能在 #87 交付；两个分支代表上下游关系，不要求提交树完全相同。

## 修复

1. **创建游标竞态**（`4f3645a`）：在创建事务持锁期间生成快照，提交后才调度，返回原受理水位；幂等重放仍读取已有任务的授权快照。确定性 MySQL 回归让恢复器在事务提交后、创建响应返回前启动真实 coordinator，原实现返回 seq 4 而非 1；修复后游标为 1，回放含 `run.started`。协作精确数量门禁 32 → 33，未放宽断言。
2. **前端再次越过早期事件**（同提交）：新建任务把受理快照交给 hook；首次流从该游标开始，StrictMode 重建连接保留已应用水位。已有任务与深链仍 GET 鉴权；手动重试、取消确认及投影修复仍重新读取快照。身份/角色变化清空整个受保护子树。
3. **测试上下文串扰**（`127b5c2`）：旧 `contextLoads` 的缓存 Spring 上下文留下活跃 worker，抢走后续完整应用验收的任务。诊断日志确认实际读取者是 `CosDiagnosisTaskStorage`，而非验收内存替身。两个应用测试类在类结束后关闭上下文；未禁用产品调度器。
4. **steering 漏扫与前缀误匹配**（`df0777e`）：递归扫描后端包的 Controller，按完整端点 token 比较；补 `/api/agent/image/*` 独立行。新增嵌套 Controller 和相似前缀负例，均先红后绿。
5. **UI 集成**（`4edba92a`）：继承 #86 的四条 smoke 修复、0 fixme 预算、严格计数/路径与 SHA 分级门禁、规则入口和样式索引。冲突仅涉及 `CLAUDE.md`、e2e README、package scripts；保留 V28、全部端点、双端开关和协作专项命令，去掉重复 stats 行与过期 openapi 条目。
6. **浏览器显式路径兼容**（`ba29a960`）：独立合并审查发现旧环境变量可能被自动回落覆盖；新增真实配置回归复现后统一为“新名 → 旧名 → 匹配版本 → 本地回落”。CI 仍不自动选择其他修订号，只有一处 `launchOptions` 赋值。

## 验证与失败记录

| 检查 | 结果 | 范围 |
|---|---|---|
| 首次 `scripts/verify.sh` | FAIL：第一遍 612 条、6 失败、303 跳过 | 后续五条依赖首次任务就绪，不能按独立产品缺陷计数 |
| 受控上下文串扰复现 | 8 条、6 失败 | 按字母顺序跑两个 Spring 测试类，普通上下文轮询 50 ms；日志确认错误存储读取者 |
| 生命周期修复后的同一命令 | 8/8、零跳过 | `mvn -o test -Dtest=EyeDiagnosisApplicationTests,FullApplicationAcceptanceTest -Dsurefire.runOrder=alphabetical` |
| 修复后完整 `scripts/verify.sh` pass 1 | PASS：612 条、0 失败、0 错误、303 跳过 | 包含 contextLoads 与完整应用 7 例；跳过项待第三遍执行 |
| pass 2 | PASS：7/7、零跳过 | 一次性 MySQL，迁移与 Mapper/审计门禁 |
| pass 3 | PASS：303/303、零跳过 | 真实 Docker、12 个隔离库套件；本次退出 0，`verify green` |
| 协作 / Graph 精确数量门禁 | PASS：33 / 37，均零跳过 | 读取本轮 Surefire 报告；不是只看 Maven 退出码 |
| 合并后 Vitest | 66 文件、637/637 | UI 与多 Agent 的合并内容 |
| build / lint / 最终 typecheck | PASS | 既有大包体积提示仍在；不将提示写为失败 |
| Python 文档门禁回归 | 39/39 | 设计 / steering / 概率契约同步核对 |
| Node 门禁与配置回归 | 6/6 | 包含缺原因、非法例外、坏计数、显式路径及 CI 回落负例 |
| 合并后 smoke | 4/4、零跳过 | 真实 Spring 登录；记录、资讯、SSE 为合成夹具 |
| 协作浏览器契约 | 29/29、零跳过 | 合成 HTTP/SSE；多宽度、双主题、身份边界、受理、取消与断线 |
| 默认关闭构建预览 | 1/1 | 无受保护协作请求，普通聊天入口独立 |

后端源码与测试在 `df0777e` 后未改变；之后的 UI 合并、配置修复及本文不会改变本轮后端测试对象。
`0abc3da4` 与其前一个集成提交 `4edba92a` 的 tree 同为 `f62faa6163934ff70eb149a7503ca451044427d8`，正式 UI 同步只补提交继承关系。
Hosted CI 必须按完整提交与运行链接读取；UI 候选 `a7fbe265` 的 [verify #220](https://github.com/yuwen773/eyes-diagnosis/actions/runs/43727806603) 为 7/7 success。多 Agent 最终提交的 CI 结果记录在 [PR #87](https://github.com/yuwen773/eyes-diagnosis/pull/87) 验证段，不能用旧 SHA 的绿灯替代。

## 浏览器证据

Playwright 1.65.0；本地 Chromium 修订号 1234，版本 151.0.7922.34。
协作套件会在旧目录写截图与读数；本轮保留下面三张新截图，随后恢复旧目录，历史证据未被提交覆盖。
已实际打开检查浅色桌面、深色桌面与窄屏。这里是浏览器契约与视觉检查，不是逐像素比较或真实模型验收。

- [浅色 1440](r13-browser/light-1440.png)
- [深色 1440](r13-browser/dark-1440.png)
- [浅色 390](r13-browser/light-390.png)

## 独立增量审查

| 固定范围 | Standards | Spec |
|---|---|---|
| `c254e74a..4f3645a` 游标与首次订阅 | PASS | PASS |
| `4f3645a..df0777e` 上下文生命周期与 steering | PASS | PASS |
| `1fca4e00..b9659a4` UI 修复（#86） | PASS | PASS |
| `df0777e..0abc3da` 合并四文件专项 | 发现显式路径覆盖 P2 | 同一 P2 |
| `0abc3da..ba29a960` 该 P2 修复 | PASS | PASS |

每个范围由两个独立只读审查员判断；未在同一范围反复重审，未以 CI 全绿推定审查通过。

## 保留边界

- #87 不合并、不部署；生产医疗协作仍 **BLOCKED**。默认开关未变。
- `AgentPage.tsx`、`tokens.css` 对冻结 tag 的 diff 均为空；冻结 tag 仍指向 `80f53f7f`。没有恢复旧图标、旧页面或旧令牌。
- #81 的三条隔离已修复，但不自行关闭 Issue。#68 原开发分支与本次初始工作区的并行文档未改。
- R1.2 历史时钟域失败与 WP-C 现场 **UNEXPLAINED** 仍保留原结论；本次全绿不构成对历史现场的新归因。
- R1.2 已披露的 `SameOriginFilter` 未比较 scheme 的 MINOR 仍保留；本轮未改变其白名单或鉴权语义，不能据此解除生产 BLOCKED。

## 夜间接力追加（当前状态）

用户随后要求只做本地提交与文件交接，禁止继续推送、正式合并或部署。
在该指令到达前，#86 已按先前授权合入 UI，远端多 Agent 提交已到 `01098ccb8d89afa464904489b6d2b1c268d56e83`。
此后没有远端写入；[该历史提交的 verify #223](https://github.com/yuwen773/eyes-diagnosis/actions/runs/43729169948) 经只读核对为 **20/20 success**。
夜间最终本地 SHA 以共享目录 `codex-ready.json` 与 `codex-final-report.md` 为准，不能将历史 CI 绿灯写成该本地 SHA 已过 Hosted CI。

按新增“真实业务行为”要求，`d8bc8f8` 删除了记录、资讯的浏览器 API 替换。
登录、本人记录列表/详情、公开资讯列表/详情均走真实 Spring Controller / Service / Mapper 与 MySQL；
仅普通 Agent 的 SSE 和自动标题使用明确标识的本地源，不调用外网模型。
两份 SQL 只向专用 `diagnosis_ci` 中指定合成账号插入数据，受账号前缀及 schema 约束，不改已有数据。

新增实跑：

| 项 | 结果 |
|---|---|
| 真实应用 + 已发布资讯种子 + 无本人记录的账号 | **PASS 4/4**，其中记录测试实际走空态 |
| 加入属于该账号的合成记录，再跑记录测试 | **PASS 1/1**，实际列表 → 详情 id → 记录纸 |
| 缺少账号环境变量 | **SKIP 4**，不计 PASS |
| typecheck / lint / fixme 预算 | **PASS**，fixme 0/0 |
| Node 门禁及配置回归 | **PASS 6/6** |
| `01098ccb..d8bc8f8` 独立 Standards / Spec | **PASS / PASS**，两位只读审查员 |
| 新本地 SHA 的 Hosted CI、真实模型与临床验收 | **NOT_RUN**；用户禁止推送，生产协作继续 BLOCKED |

种子首次因会话变量与列排序规则冲突而未插入；当时 smoke 为 **3 PASS / 1 FAIL**，
资讯测试明确报“专用测试库需至少一条已发布资讯”，没有改成 skip。
将种子账号比较改为二进制精确比较后，在同一测试条件下种入数据，得到上述 4/4。
本追加没有改产品代码、`run.started` 断言、冻结 tag 或 `AgentPage.tsx`。

前述后端三阶段、637 条 Vitest 与 29+1 条协作浏览器证据仍限于其已说明的源代码范围；
夜间增量只有 smoke、种子与说明文档，后端和产品前端源码与历史 CI 提交相同。
