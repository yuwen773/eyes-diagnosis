# Iris R5 · 最终就绪报告

> 口径：本文件只写**已经跑出来的证据**。没跑过的写「未验证」，需要负责人点头的写 BLOCKED。
> 所有 SHA 为 2026-11-18 实测值；`ui` 未被本轮回写（仍为 `6893a5d1f4471c246bfa9d768986c7bf5c4f6853`）。
>
> 本轮**没有**合并任何 PR 到 `ui`、没有部署、没有启用生产协作、没有 force push、
> 没有使用真实患者数据、没有改生产数据库。所有联调均为合成数据。

---

## 1. 分支与 PR 拓扑

| PR | 分支 | Base | HEAD | 状态 |
|---|---|---|---|---|
| #98 | `fix/r3-agent-send-rollback` | `ui` | `5e27d37a` | Draft，CI 绿 |
| #99 | `feat/r5-storage-privacy` | `ui` | `fcba25d4` | Draft，CI 绿 |
| #100 | `feat/r5-clinical-semantics` | `feat/iris21-multiagent-integration` | `b52ad844` | Draft，CI 绿 |
| #87 | `feat/iris21-multiagent-integration` | `ui` | `9a6dbcb6` | Draft，`DIRTY`（ui 已前进，未处理） |
| #92–#97 | — | `ui` | — | 已合并 |
| —（本地） | `local/r5-joint-20261118` | `ui` + #87 + 三支整改 | `9bff3ef5` | **仅本地，未推送** |

冻结 tag `iris-ui-v2.1-freeze-20261115` → `80f53f7f…`，**未移动**。

## 2. HEAD / Base / Merge base

| 分支 | HEAD | Base | Merge base（与 `ui`） |
|---|---|---|---|
| `fix/r3-agent-send-rollback` | `5e27d37a` | `ui` | `6893a5d1` |
| `feat/r5-storage-privacy` | `fcba25d4` | `ui` | `6893a5d1` |
| `feat/r5-clinical-semantics` | `b52ad844` | `feat/iris21-multiagent-integration` | `b5f37e5c`（#87 的旧 ui 基点） |
| `local/r5-joint-20261118` | `9bff3ef5` | 本地 | `6893a5d1` |

联合候选相对 `ui`：141 个提交，485 个文件，+71089 / −237。

## 3. 已完成的修复及提交

### Phase A · Agent 可靠性（PR #98）

| 提交 | 内容 |
|---|---|
| `25dd31cf` | 流已受理后失败不再撤回用户提问；切换身份清空会话列表 |
| `70e4379e` | 用受理信号（2xx + `text/event-stream`）代替「有没有助手内容」判断发送结果 |
| `b36bd05a` | 审查整改：收窄受理语义（2xx = 已入队，≠ 已落库）、历史核对只读不重发、送达四态 |
| `7d2d5db2` | 审查整改：送达读数改用 `--signal-text`；`--fg-1`（未定义）→ `--fg`；去掉重复 live region |
| `9bff3ef5`（#98 上为 `5e27d37a`） | 新增 `e2e/agent-delivery.spec.ts`：真实浏览器里量送达读数的实际对比度（明暗 × 三档视口） |

### Phase B · 医疗语义（PR #100）

| 提交 | 内容 |
|---|---|
| `30d7c7c0` | `GET /diagnosis/get/{id}` 增 `data.source` 只读投影（三事实分开陈述） |
| `537438ba` | 收窄归档/来源断言口径；补 controller 层契约测试 |
| `b52ad844` | **真实 MySQL 往返**：应用级验收里断言投影真从四张表读出 |

### Phase C · 存储与隐私（PR #99）

| 提交 | 内容 |
|---|---|
| `bdd1f326` | 落库结果未知时不删影像（C-12）；`userPassword` 不序列化（D-03）；判读响应 `no-store`（D-04） |
| `e4c48e49` | 更正「孤儿对象可回收」的说法；补「确实没落库才删」的回归 |
| `fcba25d4` | 补「对象已写入、回包解析失败」的漏删路径；`uploadDiagnosisPicture` 0 行补删；回查事务前提守卫 |

## 4. 审查问题关闭证据

「编号」一列只用于维度 D/E，取自对应审查报告自己的问题表；维度 A/B/C 只按主题陈述，不编号。

| 维度 | 编号 | 级别 | 结论 | 证据 |
|---|---|---|---|---|
| A 医疗语义 | 归档/来源的断言口径 | P1 | **CLOSED（后端）** | `537438ba`：`ARCHIVED_NOT_PUBLIC` 不再暗示对象可回放；查询失败 → `UNKNOWN`，不退化成「未授权 / 未归档」 |
| A 医疗语义 | 越权读投影 | P1 | **CLOSED（后端）** | 投影只在 `getOwnedDiagnosis` 之后下发；列表接口不带；`b52ad844` 在真实 MySQL 上断言他人不可读 |
| B 隐私 | 落库结果未知时误删影像 | P1 | **CLOSED** | `bdd1f326`：按主键回查，回查失败按「可能存在」处理，不删 |
| B 隐私 | 密码哈希序列化 | P1 | **CLOSED** | `User.userPassword` 加 `@JsonIgnore`；`DiagnosisPrivacyTest` 3 例 |
| B 隐私 | 判读响应可缓存 | P2 | **CLOSED** | `@ModelAttribute` 统一 `no-store`；响应头断言 |
| B 隐私 | 「孤儿可自动回收」的错误说法 | P2 | **CLOSED** | `e4c48e49`：注释与正文改为「`public/` 无常驻对账，需人工排查」 |
| C Agent SSE | 2xx 被当成「已落库」 | P2 | **CLOSED（口径）** | 2xx 只证明「已入队」（`SessionMessageQueue.submit` 丢弃 Future）。PR 正文与代码注释已改；`api.auth.test.ts` 钉住 `onAccepted` 发射点 |
| C Agent SSE | 受理后失败撤回气泡 | P1 | **CLOSED** | `b36bd05a`：保留气泡 + 「送达未确认」；`AgentPage.test.tsx` 断言 |
| C Agent SSE | 历史晚到覆盖新消息 | P1 | **CLOSED** | 序号 + 线程 + 身份 + 「期间有无新用户轮次」四重校验 |
| D 后端 | R5-01 | P1 | **CLOSED** | 对象已写入、回包解析失败 → 删除刚写入的 key；`FileManagerTest` +2 |
| D 后端 | R5-02 | P1 | **CLOSED（部分）** | `uploadDiagnosisPicture` 明确 0 行补删；`public/` 无常驻对账仍是登记风险（见 §11） |
| D 后端 | R5-03 | P2 | **CLOSED（守卫）** | `readbackMustStayOutsideTheWriteTransaction` |
| D 后端 | R5-04 | P2 | **CLOSED** | `FullApplicationAcceptanceTest` 真实 MySQL 往返（该类 8 例全绿） |
| D 后端 | R5-05 | P3 | 接受现状 | `@ModelAttribute` 覆盖不到 413/405（早于 controller），这些响应不含患者数据；改 Filter 留待后续 |
| D 后端 | R5-06 | P3 | 登记 | `t_diagnosis_task.taskId` 与其余三表 collation 不一致；当前单表点查都走 PK，加 JOIN 前需新迁移统一 |
| E 用户端 | #1 | P1 | **CLOSED** | `--signal`（3.70:1）→ `--signal-text`（4.81:1）；静态检查 3 条 + `agent-delivery.spec.ts` 6 例运行时测量，变异验证会红 |
| E 用户端 | #2 | P2 | **CLOSED** | `--fg-1`（全仓未定义）→ `--fg`；悬空 `var()` 静态检查已加 |
| E 用户端 | #3 | P3 | **CLOSED** | 读数去掉 `role="status"`，播报归 `FaultToaster` |
| F 证据 | PR #98 正文事实错误 | P2 | **CLOSED** | 原称「2xx = 已同步落库」，与实现不符，已改写 |
| F 证据 | 测试是否被削弱 | P2 | **CLOSED** | 无删除的测试文件；无新增 `.skip`/`.only`/`@Disabled`；两处「被删」用例是搬家（`agentSteps.test.ts` 扩写）与替换（撤回 → 保留 + 未确认） |

## 5. D-01 / D-06 / D-01b 最终状态

| 项 | 状态 | 说明 |
|---|---|---|
| **D-01** 患者授权 ≠ 临床复核 | **后端 CLOSED，前端未做** | 投影把三件事分开陈述，`authorizationState` 不再冒充 `humanReviewStatus`；记录纸渲染未接 |
| **D-06** 影像归档来源 | **后端 CLOSED，前端未做** | 四态 `ARCHIVED / ARCHIVED_NOT_PUBLIC / NOT_ARCHIVED / UNKNOWN`；`ARCHIVED_NOT_PUBLIC` 只陈述「按策略不给公开地址」，**不**陈述对象可回放 |
| **D-01b** 谁能写 `REVIEWED` | **BLOCKED（医学 / 产品）** | 系统没有 `doctor` 角色开通制度（C-08）。`/diagnosis/update` 只需 `ADMIN_ROLE` 却写「医生已完成人工复核」语义 —— 授予临床复核资格不是我能在夜间决定的。最小方案：保留写路径，把枚举语义改成「已由具备复核权限的账号完成人工复核」，资质制度单列门禁 |

## 6. C-12 可靠性与补偿测试结论

判定：**按主键回查**——查到 → 保留对象；明确查不到 → 补偿删除；回查本身失败 → 按「可能存在」处理，**不删**。

| 场景 | 测试 | 结果 |
|---|---|---|
| 落库抛异常但提交已生效 | `commitSucceededButDriverThrewKeepsTheReferencedObject` | 通过 |
| 回查也失败 | `unknownCommitStateKeepsTheObjectWhenEvenTheReadbackFails` | 通过 |
| 分配了 id 但回查为空 | `insertFailedWithAllocatedIdAndEmptyReadbackDeletesTheObject` | 通过 |
| 插入 0 行 | `zeroRowInsertIsTreatedAsFailureAndDeletesTheOrphanObject` | 通过 |
| 回包解析失败（对象已写） | `uploadsObjectThenParsingTheReplyFailsDeletesTheWrittenObject` | 通过 |
| 事务前提被破坏 | `readbackMustStayOutsideTheWriteTransaction` | 通过（守卫） |

**未做**：outbox / 幂等键 / 迁移；`public/` 前缀**没有**常驻对账器（`UploadCompensationService` 只扫 `agent-chat/`）。
**未验证**：真实 COS 驱动层的提交超时（只有替身）。

## 7. Agent 发送 / 历史 / 账号隔离

| 项 | 机制 | 证据 |
|---|---|---|
| 受理语义 | `onAccepted` 在 `onopen` 通过状态码 + content-type 校验后回调 | `api.auth.test.ts`（2 例） |
| 四态送达 | `sending / accepted / unconfirmed / failed` | `agentStream.hook.test.tsx`、`AgentPage.test.tsx` |
| 未确认核对 | `getChatHistory` 核对**只读不重发**，只升不降 | `AgentPage.test.tsx`（核对到即消失） |
| 账号切换竞态 | 会话列表：序号 + 身份；历史：序号 + 线程 + 身份 + 「期间有无新用户轮次」 | 同上 |
| 历史晚到 | 不整表覆盖，保留本轮已推的用户气泡 | 同上 |

已知未覆盖：真实网络中断后的恢复（只有 mock）；`onAccepted` 在真实 Spring SSE 上的端到端行为未单独做浏览器级验证（后端 SSE 契约由应用级验收覆盖）。

## 8. 完整联合候选

`local/r5-joint-20261118` @ **`9bff3ef5`**，**仅本地**，不推送、不部署。

内容 = `origin/ui`（`6893a5d1`）+ #87 集成线 + #98/#99/#100 的全部整改。

## 9. CI 与 E2E 测试矩阵

| 层 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b --noEmit` | 通过 |
| Lint | `npx eslint src --max-warnings=0` | 通过（0 warning） |
| 前端单测 | `npx vitest run` | **82 文件 / 850 例通过** |
| 前端构建 | `npm run build` | 通过 |
| 后端全量 | `scripts/verify.sh` | 一次性 MySQL 8 + Redis；pass1 单元 **647**（303 依赖真库跳过，含应用级验收 8 例）、pass2 集成门禁 7 例、pass3 隔离库套件 303 例 —— **三遍全部 BUILD SUCCESS，`VERIFY_EXIT=0`** |
| Playwright（flag **关闭**，:5173） | `admin-columns / nav-breakpoint / system-states / ui-freeze-regression / collaboration-default-off` | **13 passed / 4 failed**：4 条全是「协作开启」组，该服务器没开 flag |
| Playwright（flag **开启**，:5181） | 同上 + `collaboration / collaboration-safety` | **51 passed / 3 failed**：3 条是「协作关闭」组 + `collaboration-safety` 需要真后端 |
| Playwright（flag 无关，:5173） | `agent-delivery.spec.ts`（**本轮新增**） | **6 passed**：明暗 × 390/768/1440，读浏览器算出的 `computed color` 与第一个不透明祖先背景，实际对比度 ≥ 4.5:1；顺带断言窄屏无横向溢出。**已做变异验证**：`--signal-text` 改回 `--signal` → light · 390 立刻变红 |

两次失败**互补**，全部是「服务器构建与用例预期不一致」：同一批用例在与其预期一致的构建上全绿。

**未运行**（如实登记）：
- `smoke.spec.ts`（需 `E2E_USER/E2E_PASSWORD` + :8081 真后端）；
- `collaboration-backend.spec.ts`、`product-real-provider-r5.spec.ts`、`collaboration-safety.spec.ts`（需瘦启动的 Java HTTP/SSE + MySQL）。

验证层级标注：前端单测 = **合成**（mock）；Playwright 前端类 = **真实应用 + 合成 API**；
`FullApplicationAcceptanceTest` = **真实 Spring Boot + 真实 MySQL + 真实 HTTP**，推理/存储/模型为确定性替身；
**没有任何一项是临床验证**。

## 10. 浏览器截图目录

**本轮没有截图归档。** 唯一的图像产物是失败用例的自动截图与 trace，位于 `web/test-results/`
（已 gitignore，按一次性调试产物对待）。

替代证据：`web/e2e/agent-delivery.spec.ts` 用**运行时断言**（computed color + 祖先背景 + WCAG 对比度）
代替「人眼看截图」，覆盖明暗 × 390/768/1440 六格，并做过变异验证确认它会红。

Phase D 要求的「截图目录」本身仍未产出，是已知缺口；其余断点覆盖来自用例断言
（390 / 1024 / 1099 / 1280 / 1440，以及 `reducedMotion: reduce` 一条）。

## 11. 未关闭的 P0 / P1 / P2

| 级别 | 项 | 现状 |
|---|---|---|
| **P0** | — | **无** |
| P1 | D-01b 复核主体资格 | BLOCKED（医学 / 产品） |
| P1 | `public/` 前缀无常驻对账 | 已把「我们知道的 key」都清掉；「提交结果未知」仍可能留对象，需人工排查或后续接 ADR |
| P1 | D-01 / D-06 前端渲染 | 后端就绪，记录纸未接 |
| P2 | 浏览器截图证据缺失 | 见 §10 |
| P2 | 后端依赖型 Playwright 未跑 | 见 §9 |
| P2 | B-04' 刷新后工具五态退化 | 未改；当前展示「未确认」，不虚构 |
| P2 | C-08 `doctor` 角色无开通路径 | 未改 |
| P3 | `@ModelAttribute` 覆盖不到 413/405 | 接受现状 |
| P3 | `t_diagnosis_task.taskId` collation 不一致 | 加 JOIN 前用新迁移统一 |

## 12. 是否建议 #98 合并

**建议合并（Draft → 可评审状态）。** 前端门禁全绿，受理语义已按真实实现收窄，三处审查问题关闭，
没有引入新协议、没有动后端合同。

## 13. 是否建议医疗语义专项（#100）合入 #87

**暂不建议。** 后端切片已用真实 MySQL 验证，但前端渲染未接、D-01b 仍 BLOCKED。
建议顺序：#100 先作为 #87 的可评审切片存在，#87 合入 `ui` 前再决定是否带上前端渲染。

## 14. 是否建议 #87 合入 `ui`

**不建议（本轮不动）。** 三点未解决：① `DIRTY`，与 `ui` 的 `app.css` 冲突未处理（见 `9a6dbcb6` 的文档记录）；
② 冻结范围内还有待签字项（E-09 首屏替换）；③ 医疗语义前端未接完。
合并 ≠ 启用，但当前连「合并」的前提都不齐。

## 15. 生产与临床验收尚缺少什么

1. **医学授权**：D-01b 的复核主体资格、`doctor` 角色开通制度、完整回执的可见范围——三项都是产品/医学决策。
2. **真实对象存储**：本轮 COS 只有替身；提交超时、生命周期规则、存在性探测都未在真实桶上验证。
3. **真实模型**：推理是确定性替身；没有任何临床性能结论，也不能从本报告推出任何临床结论。
4. **真实环境**：未部署、未压测、未做生产库迁移演练（`public/` 对账若要做，必须先有可回滚迁移）。
5. **浏览器证据**：截图归档、依赖后端的 Playwright、真实账号冒烟都还没跑。
6. **审计与合规**：Agent 日志脱敏、诊断记录导出、SSE 异常中的内部细节——审查未把这三项跑到「有证据」的程度。
