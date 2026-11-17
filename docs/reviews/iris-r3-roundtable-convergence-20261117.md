# Iris R3 + Roundtable 3.0 · 收口与综合审查报告（2026-11-17）

> 审查范围：`yuwen773/eyes-diagnosis` 的 Iris R3 线（#92 → #94 → #95 → #96）与
> Roundtable 3.0 线（#93 → 集成分支 → #87）。
> 本报告只做**只读审查 + 受控集成验证 + Phase 3 实现**；除 #93 → 集成分支这一次
> 既有合并外，**没有执行任何新的远端合并**，没有改动冻结 `ui`，没有部署。

---

## 10.1 Executive Summary

### 完成了什么

| 工作 | 结果 |
|---|---|
| **Phase 0 基线盘点** | 五条 PR + `ui` 的 SHA、CI、祖先关系、文件重叠全部**重新查询**，没有沿用旧报告的数值 |
| **Phase 1 R3 收口** | #92/#94/#95 的整改逐项复核；上一轮的 6 项整改测试与 PR 正文一致性都查过（含正文里遗留的旧措辞） |
| **Phase 2 #93 集成** | 合并**已在本任务开始前发生**（`290d6f15`，2026-11-17T09:27:10Z）。本轮不重做，做的是**合并后复验**：树一致性、CI 承继、本地全量前端校验、独立代码审查 |
| **Phase 3 UX-A/B/C** | 三个工作包已实现并提交（`ac07a535` / `a95af864` / `a0abca27`），Draft PR #96 |
| **Phase 4 综合审查** | 五维审查；跨线冲突用 `git merge-tree` 做了**只读预演**（未真的合并） |

### 实际验证过的能力

- #93 合并后的**集成 HEAD**：typecheck / lint / build 全绿，vitest **650/651**（1 例负载 flake）。
- #93 合并提交与固定候选**树逐字节相同**（`3cad9514^{tree}` == `290d6f15^{tree}`），
  合并前 10 个 CI job 的 success **按字节适用于集成 HEAD**。
- 协作 Feature Flag 五个开关默认 `false`，并有 e2e（`collaboration-default-off.spec.ts`）
  断言默认关闭时既显示「协作暂未开放」也不发协作请求。
- #93 前端**独立审查未发现 P0/P1**（跨账号泄漏、SSE 撤权清屏、Blob 回收、
  管理员入口角色闸门、伪造执行/证据文案，逐条落到 file:line）。
- Phase 3 分支：typecheck / lint / build 全绿，vitest **63 文件 / 566 例全过**，CI 6/7 job 通过。

### 仍停留在合成 / 未验证的部分

- 多 Agent 协作的浏览器验收全部是**合成事件 + `/api/test/*` 接缝**；真实模型输出质量、
  临床有效性、生产环境**未验收**。
- 冷刷新补不出快照水位之前的完整时间线；终态撤权没有推送。
- **Phase 3 的 Playwright 已补跑**（后端按用户指示重启后）：真实后端冒烟 **7/7 通过**，
  含「点记录行进入 /records/:id 并渲染记录纸」；截图 **36 张**已采集并核对。
  但**判读结果与记录/报告页用的是合成响应**（本地算法 gRPC 服务未起、r3demo 账号名下无记录），
  属界面验收，不是临床验收。
- 跨线兼容性只做了**静态差异 + `git merge-tree` 冲突预演**，**没有构建联合候选**，
  因此不能声称「两条线已共同通过集成验收」。

### 现在是否允许下一阶段集成

**允许「继续开发与审阅」，不允许「把 R3 合进 `ui`」。** 理由见 §10.5：仍有 2 条 P1
未解决（上传体积口径、严重度恒为未评估），且 #87 对 `ui` 已是 CONFLICTING 状态。

---

## 10.2 Git / PR Matrix

| PR | URL | Base | HEAD | Merge Base | 提交数 | 文件数 | CI | 状态 | 碰过 `ui`？ |
|---|---|---|---|---|---|---|---|---|---|
| #87 | /pull/87 | `ui` | `feat/iris21-multiagent-integration` @ `290d6f15` | 见 §10.3 | — | — | **无 run** | OPEN · Draft · **CONFLICTING** | 否 |
| #92 | /pull/92 | `ui` | `fix/frontend-review-20261116` @ `6a64ec4b` | `origin/ui` | 13 | 126 | 7/7 pass | OPEN · Draft | 否 |
| #93 | /pull/93 | `feat/iris21-multiagent-integration` | `codex/iris-roundtable-3` @ `3cad9514` | `6ba65478` | 3 | 49 | 合并前 10 job 全 success | **MERGED** → `290d6f15` | 否 |
| #94 | /pull/94 | `fix/frontend-review-20261116` | `feat/r3-agent-workspace` @ `77145c04` | `6a64ec4b` | 7 | 26 | 7/7 pass | OPEN · Draft | 否 |
| #95 | /pull/95 | `feat/r3-agent-workspace` | `feat/r3-journal` @ `2b00e61d` | `77145c04` | 10 | 21 | 7/7 pass | OPEN · Draft | 否 |
| #96 | /pull/96 | `feat/r3-journal` | `feat/r3-phase3-clinical` @ `a0abca27` | `2b00e61d` | 3 | 13 | 6/7（python 仍跑） | OPEN · **Draft** | 否 |

- `origin/ui` = `9d3c5317`（来自 PR #91，**别的线**；本任务三轮均未推送 `ui`）。
- 祖先链验证：`6a64ec4b` → `77145c04` → `2b00e61d` → `a0abca27` 依次成立。

---

## 10.3 Roundtable 集成证明

### 固定候选验证结果

| 门禁项 | 要求 | 实测 |
|---|---|---|
| PR 编号 | #93 | #93 ✓ |
| HEAD | `3cad9514fef0f13a639dc3c7a6db4b38945e0a63` | `3cad9514fef0f13a639dc3c7a6db4b38945e0a63` ✓ |
| Base | `feat/iris21-multiagent-integration` | 一致 ✓ |
| Base 原 HEAD | `6ba65478…` | 合并前为该值 ✓ |
| 固定 base 是 head 祖先 | 是 | ✓ |
| 合并方式 | Merge Commit | `Merge PR #93: Iris Agent Roundtable 3.0 工作台升级` ✓ |
| 落点 | 集成分支 | `290d6f15` ✓ |

### 唯一授权合并的执行结果

**合并发生于 2026-11-17T09:27:10Z，早于本任务开始**（本任务第一轮才建立基线）。
本轮**没有再执行一次合并**，改为验证这次合并是否满足门禁：

- 合并提交 `290d6f15` 的树 = 固定候选的树 = `ed9ac5fe75fe5f284ef4c9d93a6de81881a65673`
  → **内容零差异**，合并前的 CI 结论可直接承继。
- #87 仍为 **Draft**；`origin/ui` 未被本任务改动。
- Feature Flag 默认关闭成立：`application.yml:92-98` 五个 `collaboration.*` 开关全 `false`，
  对应 bean 均为 `@ConditionalOnProperty(havingValue = "true")`。

### 新 HEAD 复验（本地，导出树 `iris-integ-verify`）

| 检查 | 结果 |
|---|---|
| typecheck / lint / build | 全过 |
| vitest | **650 通过 / 1 失败**：`src/components/shell/MobileNav.test.tsx`「协作开关=true：管理员在抽屉账号区能看到系统管理」在 67 worker 满载下耗时 6.3s，撞 5s 超时；**单跑该文件 13/13 通过、2.7s** → 负载 flake，非代码缺陷（P2） |
| 远端 CI | 集成分支 push 与 PR #87 上**都没有 CI run**：workflow 只触发 `pull_request`，而 #87 冲突时 GitHub 生成不了 merge ref |

### 独立审查结论

对 #93 前端九个文件做的 P0/P1 定向审查（跨账号泄漏、SSE 401/403 清屏、
Object URL 回收、管理员入口闸门、伪造执行/证据文案）：

- **未发现 P0/P1。**
- 逐条依据：受保护子树按 `status/identity/role` 重新建键；401/403 时 `run` 置空并停流；
  授权影像在 reload / visibilitychange / 卸载三条路径都 revoke；
  管理员入口由 `user.userRole === "admin"` 闸住且 `NAV_LINKS` 不含后台路由；
  完成文案只在 `run.completed` 或服务端 `SUCCEEDED` 时出现，患者投影丢弃未知枚举原文。
- **未核实项（如实登记）**：非终态 SSE 正常断开是否会造成重连循环（读代码确认终态会在
  `useCollaborationRun.ts:171-179` 收敛为 `closed`，风险不成立）；`/admin` 路由的服务端
  角色校验；`limitationCount` 字段名在 `EVIDENCE_FROZEN` 下的语义（已核：后端
  `PatientDraftCoordinator.java:629` 传的就是 `citations().size()`，文案「引用 N 条」属实）。

---

## 10.4 R3 体验成果

| 页面 | 状态 | 说明 |
|---|---|---|
| `/agent`（单 Agent） | **已开发 · 已验证** | 三栏工作区、PromptBar、思考线；工具步终态是「未确认」（后端不发 `tool-response`，前端不造事件） |
| `/news`、`/news/:id` | **已开发 · 已验证** | 期刊抬头、真实头条、编辑式内容卡、728px 正文版式；目录锚点保留 React Router history state |
| `/diagnosis` | **已开发 · 单测 + 真实后端冒烟 + 截图** | 三阶段影像工作区；四种结局显式区分；判读结果为合成响应 |
| `/records` + `/records/:id` | **已开发 · 单测 + 真实后端冒烟 + 截图** | 列表只追溯、报告独立成页；复核状态映射修复；行→报告有真实后端断言 |
| `/profile` | **已开发 · 单测 + 真实后端冒烟 + 截图** | 身份优先；最近判读直达报告；体积上限与后端真值对齐 |
| 多 Agent 协作台 | **已开发（#93）· 合成验证** | 真实模型与临床未验收；冷刷新水位边界见 §10.1 |
| `/admin/*` | 未动 | 管理端不在本轮范围；`ui` 冻结中的 UI 债仍登记在 Issue #84 |

---

## 10.5 综合风险清单

### P0（安全越权 / 数据泄漏 / 医学结论伪造 / 合并误操作）

**无。** 两条链的独立审查都没找到 P0。

### P1

| # | 位置 | 复现 | 影响 | 建议 | 状态 |
|---|---|---|---|---|---|
| P1-1 | `src/main/java/com/csust/eyediagnosis/manager/FileManager.java:102` | 上传 > 2 MB 的眼底照片到 `/diagnosis/diagnosis`；头像页允许 10 MB、判读页前端允许 5 MB | 后端 2 MB 上限与前端 5 MB / 10 MB 不一致：> 2 MB 头像直接失败；> 2 MB 眼底图**判读能出结果，但存图因 COS 报错被吞掉而丢图**——用户看到结论却查不到原图 | 三选一：后端上限对齐到 5 MB；或前端把限额降到 2 MB 并明说；或后端对超限影像明确报错而不是吞掉 COS 异常 | **未修**（跨端，需产品口径） |
| P1-2 | `src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java:495` | 任意一条真实判读记录 | `vo.setSeverity("NOT_ASSESSED")` 硬编码 → 所有记录严重度恒为「未评估」，高风险计数恒为 0，患者看不到任何严重度信息 | 由模型/质量门真实产出 severity；在产出之前，前端与后台都应显示「未评估」而不是暗示已评估（本轮前端已按未评估显示） | **未修**（后端语义，需评审） |

### P2

| # | 位置 | 问题 | 建议 | 状态 |
|---|---|---|---|---|
| P2-1 | `web/src/lib/api.ts:346` | `GET /diagnosis/stats/my` 后端无实现 → 个人中心与记录页统计永远是「本页」口径 | 后端补端点；或产品决定下线「全量」承诺。前端当前有诚实降级（标「本页」） | 已降级，未修端点 |
| P2-2 | `web/src/components/RecordSheet.tsx:210` | `requiresReview && !rejected` → **既拒识又需复核**时，待复核提示被抑制 | 拒识与待复核是两个独立维度，提示应各自成立 | 未修 |
| P2-3 | `web/src/components/MobileNav.tsx` 与 `web/src/components/shell/MobileNav.tsx` | 同概念双实现；#93 只改前者，却新增 `shell/MobileNav.test.tsx` | 收敛到一个组件，删掉另一个 | 未修 |
| P2-4 | `web/src/components/shell/MobileNav.test.tsx` | 满载下 6.3s 撞 5s 超时（单跑 2.7s 通过） | 给该用例加显式 timeout 或降并发 | 已登记，未修 |
| P2-5 | `web/src/lib/domain.ts` `reviewState` | 后端写 `AI_ONLY/AWAITING_REVIEW/REVIEWED/OVERRIDDEN`，前端只认旧枚举 → **已复核记录也显示「待复核」** | 两套枚举都认，未知值保守落「待复核」 | **本轮已修**（`a95af864` + `domain.review.test.ts`） |
| P2-6 | `web/e2e/collaboration-backend.spec.ts` 等 | 协作 e2e 依赖 `/api/test/*` 合成接缝 | 保留合成用例，另设真实模型验收通道并显式标注 | 已登记 |

### P3

- `limitationCount` 字段名在 `EVIDENCE_FROZEN` 语义下其实是引用条数（后端 `PatientDraftCoordinator.java:629`），命名与含义不同源，容易被误读。
- `DiagnosisPage` / `RecordsPage` / `ProfilePage` 仍无独立单测覆盖（Phase 3 已补 4 条关键回归，但页面级覆盖仍薄）。

---

## 10.6 视觉验收索引

| 集合 | 路径 | 对应提交 | 主题 / 宽度 | 状态 |
|---|---|---|---|---|
| Agent 基线 | `D:\Work\code\iris-r3-shots\out`（68 张） | `77145c04` 之前的 #94 交付态 | 浅/深 × 1440/768/390，11 态 | 已看并按发现修过 |
| 合并前整改 | `D:\Work\code\iris-r3-shots\out-remediation`（18 张） | `77145c04` / `2b00e61d` | 浅/深 × 1440/390，未确认态、展开态、发送互斥、头条与第 2 页检索落点 | 已逐张核对 |
| Journal 基线 | `D:\Work\code\iris-r3-shots`（82 张） | `2b00e61d` | 浅/深 × 1440/768/390，14 态 | 已看并按发现修过 |
| Roundtable 证据 | `docs/testing/roundtable-evidence-20261117/`（12 张 webp，**在仓库内**） | `3cad9514` | 浅/深 × 360/390/1024/1280/1440 | 随 #93 交付 |
| #92 评审 | `D:\Work\code\iris-review-shots` | `6a64ec4b` | 个人中心与管理端 | 上一轮留存 |
| **Phase 3** | `D:\Work\code\iris-r3-shots\out-phase3`（36 张） | `c04c2357` | 浅/深 × 1440/390：判读空态/已选影像/判读中/分类结果/拒识结果、记录列表、独立报告页、个人中心 | 已采集并核对（判读结果与记录为**合成响应**，文件名带 synthetic） |

---

## 10.7 下一阶段建议

### 是否建议转 Ready

| PR | 建议 | 理由 |
|---|---|---|
| #92 | **建议 Ready**（需你确认 61 张像素证据重跑） | 整改闭合、CI 7/7；证据链完整 |
| #94 | **建议 Ready** | 六项整改闭合，工具步「未确认」口径诚实，不伪造后端事件 |
| #95 | **建议 Ready** | 三项整改闭合，目录 history state 与头条可点性都有回归测试 |
| #96（Phase 3） | **可以进入你的 Review** | 冒烟 7/7、截图 36 张、单测 568 例；但 P1-2（severity 恒未评估）仍在，判读/报告用的是合成响应 |

### #87 与 `ui` 的未来集成还缺什么

1. **#87 对 `ui` 已是 CONFLICTING**：集成线与 `ui`（已到 `9d3c5317`）需要一次冲突解决。
2. **R3 线与集成线的冲突预演**（`git merge-tree`，只读，未真的合并）——5 处冲突：
   - `web/src/styles/app.css`（content）
   - `web/src/styles/agent.css`（content）
   - `web/src/lib/agentStream.ts`（content）
   - `web/src/components/agent/messages/ToolRequestMessage.tsx`（**modify/delete**：R3 线删除、集成线修改）
   - `web/e2e/smoke.spec.ts`（content）
   这五处里 `ToolRequestMessage.tsx` 的 modify/delete 最需要人工判断：R3 侧删掉了它，
   集成侧仍在改它。
3. 需要一次**真正的联合构建**（两条线同时进一个候选）才能谈「联合验收」；本轮**没有**做，
   因此不做任何「两条线已共同通过集成验收」的结论。

### 是否还有必须解决的 P0/P1

- **无 P0。**
- **P1 剩两条**（上传体积口径、严重度恒未评估），都需要后端或产品口径，不是前端单方面能定。
- 另有一项**证据缺口**：Phase 3 的判读结果与报告页用的是**合成响应**，真实算法服务（gRPC）与一条真实记录都还没跑过。

### 是否需要真实模型与临床评估

**需要。** 协作线至今全部结论建立在合成事件与 `/api/test/*` 接缝上；
真实模型的输出质量、拒识率、医生复核工作量与临床有效性都未评估。
任何对外表述都不能把「合成联调 5/5 通过」写成「真实模型已验证」。

---

*本报告由收口任务生成；所有 SHA、CI 数字、文件计数均在本轮重新查询，
未沿用历史报告数值。*
