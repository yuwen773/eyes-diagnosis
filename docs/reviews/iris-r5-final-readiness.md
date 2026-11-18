# Iris R5 · 最终就绪报告（联合候选 v2）

> 口径：本文件只写**已经跑出来的证据**。没跑过的写「未验证」，需要负责人点头的写 BLOCKED。
> 所有 SHA 为 2026-11-18 实测值。
>
> 本轮对 `ui` 的写操作**只有一次授权动作**：#98、#99 的受控合并（用户明确要求「先收口这两项」）。
> #87、#100 **没有**合入任何分支；没有部署；没有启用生产协作；没有 force push；
> 没有使用真实患者数据；没有改生产数据库。所有联调均为**合成数据**。

---

## 1. 分支与 PR 拓扑

| PR | 分支 | Base | HEAD | 状态 |
|---|---|---|---|---|
| #98 | `fix/r3-agent-send-rollback` | `ui` | `61535322` | **已合并** → `b805377f` |
| #99 | `feat/r5-storage-privacy` | `ui` | `f6adac47` | **已合并** → `6066342b` |
| #100 | `feat/r5-clinical-semantics` | `feat/iris21-multiagent-integration` | `18126256` | Draft，CI 20/20 |
| #87 | `feat/iris21-multiagent-integration` | `ui` | `9a6dbcb6` | Draft，**未合并** |
| —（本地） | `local/r3-joint-20261118-v2` | `ui` | 本报告所在提交（见 §17） | **仅本地，未推送** |

冻结 tag `iris-ui-v2.1-freeze-20261115` → `80f53f7f…`，**未移动**。

`#98` / `#99` 的合并都做过「合并后树 = 已测树」的逐字节核对
（`git rev-parse origin/ui^{tree}` 与对应 head 的 tree 相等），不是只看 CI 绿灯。

## 2. HEAD / Base / Merge base

| 对象 | HEAD | Base | Merge base（与 `ui`） |
|---|---|---|---|
| `origin/ui` | `b805377f` | — | — |
| `local/r3-joint-20261118-v2` | 本报告所在提交（见 §17） | `ui` | `b805377f` |
| `feat/iris21-multiagent-integration`（#87） | `9a6dbcb6` | `ui` | `b5f37e5c`（旧 ui 基点） |
| `feat/r5-clinical-semantics`（#100） | `18126256` | #87 | `b5f37e5c` |

联合候选相对 `origin/ui`：**126 个提交，478 个文件，+70078 / −262**。

联合候选的两个合并点：

| 提交 | 内容 |
|---|---|
| `a5a07581` | `merge #87`（Roundtable 集成分支）并入 `ui` |
| `c92fdd14` | `merge #100`（患者报告来源投影）并入上一行结果 |

## 3. 已完成的修复及提交

### Phase A · Agent 可靠性（#98，已合入 `ui`）

| 提交 | 内容 |
|---|---|
| `25dd31cf` | 流已受理后失败不再撤回用户提问；切换身份清空会话列表 |
| `70e4379e` | 用受理信号（2xx + `text/event-stream`）代替「有没有助手内容」判断发送结果 |
| `b36bd05a` | 收窄受理语义（2xx = 已入队，≠ 已落库）；历史核对只读不重发；送达四态 |
| `7d2d5db2` | 送达读数改用 `--signal-text`；`--fg-1`（未定义）→ `--fg`；去掉重复 live region |
| `0969216e` | 停止在响应头之前不再冒充已受理 |
| `61535322` | 中止分「用户按停止」与「会话被切走」；历史去重加时间门槛 |

### Phase C · 存储与隐私（#99，已合入 `ui`）

| 提交 | 内容 |
|---|---|
| `bdd1f326` | 落库结果未知时不删影像（C-12）；`userPassword` 不序列化（D-03）；判读响应 `no-store`（D-04） |
| `e4c48e49` | 更正「孤儿对象可回收」的说法；补「确实没落库才删」的回归 |
| `fcba25d4` | 补「对象已写入、回包解析失败」的漏删路径；0 行插入补删；回查事务前提守卫 |
| `f6adac47` | 旧上传路径也保留「落库结果未知」的影像，并补回查缺口的记录 |

### Phase B · 医疗语义（#100，未合并）

| 提交 | 内容 |
|---|---|
| `30d7c7c0` | `GET /diagnosis/get/{id}` 增 `data.source` 只读投影（三事实分开陈述） |
| `537438ba` | 收窄归档/来源断言口径；补 controller 层契约测试 |
| `b52ad844` | 真实 MySQL 往返：应用级验收断言投影真从四张表读出 |
| `18126256` | 患者报告补四类事实；`reviewerRole` 进投影；REVIEWED 不再复述「医生」 |

### 联合候选中的集成修复（本候选独有，需随合并一起落地）

| 提交 | 内容 | 为什么必须有 |
|---|---|---|
| `3a2ad688` | `DiagnosisPrivacyTest` 补 `DiagnosisSourceProjectionService` mock | #99 的手工装配 controller 测试不认识 #100 新增的依赖，合并后 NPE |
| `990559d8` | 协作用例改用 `.prompt__input`；新增 `scripts/evidence/joint-r5-capture.mjs` | ui 的 R3 工作区重做删掉了 `.agent-input__textarea`，#87 的两条用例仍按旧类名找控件 |

## 4. 合并冲突的解决口径（逐文件）

| 文件 | 取法 | 理由 / 代价 |
|---|---|---|
| `web/src/lib/agentStream.ts` | 两侧字段并存：`toolCallId/toolStatus/stepLabel/finishReason`（#87）+ `delivery/SendOutcome/abortedBy`（#98） | 两套语义正交；`tool-request` 分支整段取 #87 |
| `web/src/components/agent/messages/ToolRequestMessage.tsx`(+test) | **删除** | ui 的 ThoughtLine 模型已取代 #87 的五态工具卡渲染；合并后全仓无引用。**代价**：五态数据仍在 `agentStream`，但不再有专用卡片渲染——这是需要设计层签字的集成决策 |
| `web/src/lib/agentStream.hook.test.tsx` | #98 的受理语义用例 + 补回 #87 三条独有用例（等待确认 / reset 后迟到事件 / 工具卡后 assistant 退流式） | 改用同一 `renderHook` 夹具，断言未弱化 |
| `web/src/lib/api.auth.test.ts` | 三组用例并存（onAccepted 正反例 / 错误状态 + 认证信封 / 非 JSON 错误体） | — |
| `web/src/lib/domain.ts` | 取 #100 的 `humanReviewState`；ui 的 `reviewState` 退场 | 旧枚举 APPROVED/REJECTED/PENDING 不再特殊处理，落「未记录」（已写成显式断言） |
| `web/src/components/RecordSheet.test.tsx` | 两侧用例并存 | ui 的拒识/归档语义 + #100 的复核措辞与来源投影 |
| `web/src/pages/RecordsPage.test.tsx` | 保留 ui 的「行 → 独立报告路由」；#100 的三条详情用例**迁到** `RecordDetailPage.test.tsx` | 合并后详情归独立路由 `/records/:id`，旧的内联展开不存在 |
| `web/src/styles/agent.css` / `app.css` | 取 ui | #87 的 `agent-msg--reasoning / typing-bar / agent-console` 在合并后无任何引用 |
| `web/src/styles/roundtable.css` | 5 处字面色改令牌；CRITIC 角色金 2 处登记进硬编码色棘轮 | 见 §11 |
| `web/e2e/smoke.spec.ts` / `README.md` | 取 ui 的九条版本；README 的「四条」计数同步为「九条」 | ui 版本已含 Roundtable 的真实后端记录链 |

## 5. 审查问题关闭证据（含本候选新增）

| 维度 | 编号 | 级别 | 结论 | 证据 |
|---|---|---|---|---|
| A 医疗语义 | 归档/来源断言口径 | P1 | **CLOSED（后端 + 前端）** | `537438ba` 后端口径；`RecordSheet.tsx` 现在渲染四态并带文字标签 |
| A 医疗语义 | 越权读投影 | P1 | **CLOSED** | 投影只在归属校验后下发；`RecordDetailPage.test.tsx` 的 403 用例断言不出现任何回执 |
| A 医疗语义 | AI_ONLY 说成「待复核」 | P2 | **CLOSED** | `domain.review.test.ts` + `RecordSheet.test.tsx` 双向钉住 |
| B 隐私 | 落库结果未知时误删影像 | P1 | **CLOSED** | 按主键回查；回查失败按「可能存在」处理 |
| B 隐私 | 密码哈希序列化 | P1 | **CLOSED** | `User.userPassword` `@JsonIgnore`；`DiagnosisPrivacyTest` 3 例 |
| B 隐私 | 判读响应可缓存 | P2 | **CLOSED** | `no-store` + 响应头断言 |
| C Agent SSE | 2xx 被当成「已落库」 | P2 | **CLOSED（口径）** | 2xx 只证明「已入队」；`api.auth.test.ts` 钉住发射点 |
| C Agent SSE | 受理后失败撤回气泡 | P1 | **CLOSED** | 保留气泡 + 「送达未确认」 |
| C Agent SSE | 历史晚到覆盖新消息 | P1 | **CLOSED** | 序号 + 线程 + 身份 + 「期间有无新用户轮次」四重校验 |
| D 后端 | R5-01 | P1 | **CLOSED** | 对象已写、回包解析失败 → 删除刚写入的 key |
| D 后端 | R5-02 | P1 | **CLOSED（部分）** | 0 行插入补删；`public/` 无常驻对账仍是登记风险（§11） |
| D 后端 | R5-03 / R5-04 | P2 | **CLOSED** | 回查事务前提守卫；真实 MySQL 往返用例 |
| E 用户端 | #1 | P1 | **CLOSED** | `--signal-text`（4.81:1）+ `agent-delivery.spec.ts` 运行时测量 |
| E 用户端 | #2 | P2 | **CLOSED** | `--fg-1`（全仓未定义）→ `--fg` |
| F 证据 | #99 × #100 合并后 NPE | **P1（本候选发现）** | **CLOSED** | `3a2ad688`；`DiagnosisPrivacyTest` 3/3 |
| F 证据 | 协作用例选择器漂移 | **P1（本候选发现）** | **CLOSED** | `990559d8`；两条用例重跑通过 |

## 6. D-01 / D-06 / D-01b 最终状态

| 项 | 状态 | 说明 |
|---|---|---|
| **D-01** 患者授权 ≠ 临床复核 | **CLOSED（前后端）** | 报告页把「来源 / 草稿审核 / 患者授权 / 影像归档 / 复核人角色」分行陈述；授权的措辞是「患者已授权保存 · 时间 · 回执前缀」，不写「已复核」 |
| **D-06** 影像归档来源 | **CLOSED（前后端）** | 四态 `ARCHIVED / ARCHIVED_NOT_PUBLIC / NOT_ARCHIVED / UNKNOWN`；`ARCHIVED_NOT_PUBLIC` 只陈述「按隐私策略不公开」，**不**陈述对象可回放 |
| **D-01b** 谁能写 `REVIEWED` | **BLOCKED（医学 / 产品）** | 见下 |

**D-01b 的事实链（本轮实测）：**

- `DoctorReviewService`（协作草稿审核）**确实要求 `doctor` 角色**：`assign` 要 `admin` 且被分配人
  `userRole='doctor'`；`list / detail / decide` 都 `requireRole(doctor,"doctor")`。所以协作台里
  「待医生复核 / 该版本已获医生批准」的措辞有角色校验支撑。
- `DiagnosisController#updateDiagnosisResult` 的 `@AuthCheck(mustRole = ADMIN_ROLE)` 会写
  `HumanReviewStatus.REVIEWED` —— **管理员即可写入「人工复核完成」**，而系统没有可核验的临床资质。
- 本轮能做的：把展示口径从「医生复核」改成「人工复核已记录」，并在报告里单独一行给出
  `reviewerRole`（`管理员（admin）` / `医生（doctor）`），**陈述角色而不授予资质**。
- 本轮**不能**做的：判定管理员是否具备临床复核资格、是否要新增 `doctor` 角色开通制度。这是医学/产品决策。

## 7. C-12 可靠性与补偿测试结论

判定：**按主键回查**——查到 → 保留对象；明确查不到 → 补偿删除；回查本身失败 → 按「可能存在」处理，**不删**。

| 场景 | 测试 | 结果 |
|---|---|---|
| 落库抛异常但提交已生效 | `commitSucceededButDriverThrewKeepsTheReferencedObject` | 通过 |
| 回查也失败 | `unknownCommitStateKeepsTheObjectWhenEvenTheReadbackFails` | 通过 |
| 分配了 id 但回查为空 | `insertFailedWithAllocatedIdAndEmptyReadbackDeletesTheObject` | 通过 |
| 插入 0 行 | `zeroRowInsertIsTreatedAsFailureAndDeletesTheOrphanObject` | 通过 |
| 回包解析失败（对象已写） | `uploadsObjectThenParsingTheReplyFailsDeletesTheWrittenObject` | 通过 |
| 事务前提被破坏 | `readbackMustStayOutsideTheWriteTransaction` | 通过（守卫） |

**未做**：outbox / 幂等键 / 迁移；`public/` 前缀**没有**常驻对账器。
**未验证**：真实 COS 驱动层的提交超时（只有替身）。

## 8. Agent 发送 / 历史 / 账号隔离

| 项 | 机制 | 证据 |
|---|---|---|
| 受理语义 | `onAccepted` 在 `onopen` 通过状态码 + content-type 校验后回调 | `api.auth.test.ts` |
| 四态送达 | `sending / accepted / unconfirmed / failed` | `agentStream.hook.test.tsx`、`AgentPage.test.tsx` |
| 中止归属 | `abortedBy: "user" \| "superseded"` | 同上 |
| 未确认核对 | `getChatHistory` 只读不重发，只升不降 | `AgentPage.test.tsx` |
| 账号切换竞态 | 会话列表：序号 + 身份；历史：序号 + 线程 + 身份 + 「期间有无新用户轮次」 | 同上 |
| 工具状态归属 | `toolCallId` 幂等；#87 的状态帧与 #98 的送达四态共存 | `agentStream.test.ts` + 补回的 hook 用例 |

## 9. 完整联合候选

`local/r3-joint-20261118-v2` @ **本报告所在提交（见 §17）**，**仅本地**，不推送、不部署。

内容 = `origin/ui`（`b805377f`）+ #87 集成线 + #100 来源投影 + 两处集成修复。

验证栈（本轮实测）：

| 组件 | 实例 |
|---|---|
| 后端 | 本工作树 `mvn spring-boot:run`，:8081，profile 覆盖 `diagnosis_joint_v2` @ MySQL 8.0.26 :3307 |
| 前端 dev | :5273（协作 flag 开）、:5274（flag 关）、:5275（代理到 :18085 协作测试后端） |
| 协作测试后端 | `CollaborationBrowserServer` @ :18085，真 Java HTTP/SSE + MySQL `collaboration_test` |

## 10. 测试矩阵（本轮实测）

| 层 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm run typecheck`（`tsc -b`） | 通过 |
| Lint | `npm run lint`（`eslint .`） | 通过 |
| 前端单测 | `npx vitest run` | **82 文件 / 857 例通过** |
| 前端构建 | `npm run build` | 通过（含协作 flag 开/关两种构建） |
| e2e 硬门禁 | `check:e2e-fixme` / `check:gate-tests` | 0 fixme；6/6 |
| 后端全量 | `scripts/verify.sh`（一次性 MySQL 8 + Redis） | pass1 单元 **649 例（303 依赖专用真库跳过）**、pass2 MySQL 集成门禁 **7 例**、pass3 隔离库套件 **303 例** —— 三遍 **BUILD SUCCESS**，退出码 0 |
| Playwright · 前端类（真实应用 + 合成 API） | `admin-columns` / `agent-delivery` / `system-states`（flag 开，:5273） | **11 passed** |
| 同上 | `nav-breakpoint`（flag 开 :5273 → 8 passed；「协作关闭」那条改在 flag 关 :5274） | **9 passed / 0 failed**（两档构建各跑对应分组） |
| 同上 | `ui-freeze-regression`（13 路由 × 6 宽度 × 明暗） | **2 passed**，无横向溢出、无未捕获异常 |
| 真实后端冒烟 | `smoke.spec.ts`（:5273 代理 → :8081，合成账号 + 合成种子） | **9 passed** |
| 协作夹具 | `collaboration.spec.ts`（flag 开 :5273） | **43 passed** |
| 协作默认关 | `collaboration-default-off.spec.ts`（flag 关 :5274） | **1 passed** |
| 协作真后端 | `collaboration-backend.spec.ts` + `collaboration-safety.spec.ts`（:5275 → :18085） | **5 passed** |
| 截图归档 | `node scripts/evidence/joint-r5-capture.mjs` | **48 张**，横向溢出 0 |

**未运行（如实登记）：**
- `product-real-provider-r5.spec.ts` —— 预注册的一次性真实提供方实验（16 次请求上限），
  **按设计不重复执行**，本轮不跑。

验证层级：前端单测 = 合成（mock）；Playwright 前端类 = 真实应用 + 合成 API；
`smoke.spec.ts` = 真实 Spring Boot + 真实 MySQL + 真实 HTTP，数据为合成种子；
`collaboration-backend/safety` = 真实 Java HTTP/SSE + 真实 MySQL，推理/存储/模型为合成夹具。
**没有任何一项是临床验证。**

## 11. 浏览器截图目录

| 目录 | 内容 | 生成方式 |
|---|---|---|
| `target/r5-joint-shots/`（48 张 + `manifest.json`） | 6 个关键路由 × 390/768/1440 × 明暗，另加 768 各主题的 reduced-motion | `node scripts/evidence/joint-r5-capture.mjs` |
| `target/ui-freeze/`（72 张） | 13 条已冻结路由 × 6 宽度（含 820/900/1920）× 明暗 | `e2e/ui-freeze-regression.spec.ts` |
| `web/test-results/roundtable-evidence/`（56 张 png + 18 份 json） | 协作工作台 9 档宽度 × 明暗 + 抽屉 / 表单态 | `e2e/collaboration.spec.ts` |

三处都在 gitignore 范围内：证据随候选留存在本地，重建命令写在上面，不随分支推送。

## 12. 未关闭的 P0 / P1 / P2

| 级别 | 项 | 现状 |
|---|---|---|
| **P0** | — | **无** |
| P1 | D-01b 复核主体资格 | **BLOCKED**（医学 / 产品） |
| P1 | `public/` 前缀无常驻对账 | 已知 key 都会清；「提交结果未知」可能留对象，需人工排查或后续接 ADR |
| P2 | 五态工具卡渲染被 ThoughtLine 取代 | `agentStream.ts` 仍产出 `toolStatus`，但合并后没有专用卡片消费它 —— 需设计层签字确认这是想要的 |
| P2 | CRITIC 角色金无令牌 | `roundtable.css` 2 处字面色已登记进棘轮（`hardcoded-colors.test.ts`），待设计层决定是否升成正式令牌 |
| P2 | B-04' 刷新后工具五态退化 | 未改；当前展示「未确认」，不虚构 |
| P2 | C-08 `doctor` 角色无开通路径 | 未改（D-01b 的上游） |
| P3 | `@ModelAttribute` 覆盖不到 413/405 | 接受现状（这些响应不含患者数据） |
| P3 | `t_diagnosis_task.taskId` collation 不一致 | 加 JOIN 前用新迁移统一 |
| P3 | `npm run test:collaboration` 直连 `E2E_BASE_URL` | 不设变量时默认打 :5173，容易打到别的构建上；本轮是显式指定 :5273 |
| P3 | `DiagnosisPage` 的归档措辞仍由 `Boolean(result.url)` 推出 | 与后端 `ARCHIVED` 口径同源（有地址＝记录引用了一个影像地址，不做存储侧存在性探测），但拿不到 `ARCHIVED_NOT_PUBLIC` / `UNKNOWN` 两态；该页只处理直传影像，协作影像走 `RecordSheet` 的四态投影。要统一需判读响应回带 `source` |

## 13. 是否建议 #98 合并

**已按授权合并**（`b805377f`），合并后树与已测 head 逐字节相等。

## 14. 是否建议医疗语义专项（#100）合入 #87

**建议合入，前提是带上本候选的两处集成修复**（`3a2ad688` 的测试依赖、`990559d8` 的选择器与截图脚本）。

理由：合并后的三处真问题都在本候选里暴露并修好了；`RecordDetailPage` 已经把投影渲染出来，
D-01 / D-06 因此从「后端就绪、前端未接」变成**前后端闭合**。
仍不建议把 D-01b 标成关闭：它需要医学负责人给结论。

## 15. 是否建议 #87 合入 `ui`

**仍然不建议自动合并。** 本报告只能证明「把 #87 + #100 + #98/#99 合起来之后，验证栈是绿的」；
它没有证明「#87 单独合入 `ui` 是安全的」。合并前还差：

1. #87 与 `ui` 的 `app.css` / `agent.css` 冲突需要按 §4 的口径正式解一次（本候选是本地解，未回写）；
2. 五态工具卡渲染退场需要设计层签字（§12 P2）；
3. 协作默认关闭是**双开关**（`VITE_COLLABORATION_ENABLED` + `eye-diagnosis.collaboration.*`），
   生产启用仍需单独评审。

## 16. 生产与临床验收尚缺少什么

1. **医学授权**：D-01b 的复核资格、`doctor` 角色开通制度、完整回执的可见范围——三项都是产品/医学决策。
2. **真实对象存储**：COS 只有替身；提交超时、生命周期规则、存在性探测都未在真实桶上验证。
3. **真实模型**：推理是确定性替身；本报告不能推出任何临床性能结论。
4. **真实环境**：未部署、未压测、未做生产库迁移演练。
5. **浏览器证据的边界**：截图是**合成数据**下的版式证据，不是临床界面验收。
6. **审计与合规**：Agent 日志脱敏、诊断记录导出、SSE 异常中的内部细节，仍未跑到「有证据」的程度。

---

### 逐项命令（可复现）

```bash
# 前端
cd web && npm run typecheck && npm run lint && npx vitest run && npm run build
npm run check:e2e-fixme && npm run check:gate-tests

# 后端
scripts/verify.sh

# 真实后端冒烟（需先起 :8081 + :5273）
E2E_BASE_URL=http://127.0.0.1:5273 E2E_USER=… E2E_PASSWORD=… \
  npx playwright test e2e/smoke.spec.ts --workers=1

# 协作（夹具 / 默认关 / 真后端）
E2E_BASE_URL=http://127.0.0.1:5273 npx playwright test e2e/collaboration.spec.ts --workers=1
E2E_BASE_URL=http://127.0.0.1:5274 npx playwright test e2e/collaboration-default-off.spec.ts --workers=1
E2E_BASE_URL=http://127.0.0.1:5275 npx playwright test e2e/collaboration-backend.spec.ts e2e/collaboration-safety.spec.ts --workers=1

# 截图归档
E2E_BASE_URL=http://127.0.0.1:5273 E2E_USER=… E2E_PASSWORD=… \
  node scripts/evidence/joint-r5-capture.mjs
```

## 17. SHA 取证

联合候选的 HEAD **就是写入本报告的那一次提交**（本文件每次改写都会换 SHA，把数字写死在正文里
只会立刻过期）。取当前值：

```bash
git -C <worktree> log -1 --format=%h -- docs/reviews/iris-r5-final-readiness.md
```

它之前的两个代码提交是（固定、不再变化）：

| 提交 | 内容 |
|---|---|
| `990559d8` | 协作用例改用 `.prompt__input`；新增截图脚本 |
| `3a2ad688` | `DiagnosisPrivacyTest` 补来源投影依赖 |

两个合并点：`a5a07581`（#87）、`c92fdd14`（#100）——同样固定。
