# Iris 修复批次评审与整改报告

> 日期：2026-11-16 ～ 2026-11-17
> 范围：后端三条分支 + 前端一条分支（`web/` 代码评审整改）
> 性质：先只读 `/code-review`，再按复审意见整改前端；后端仅评审，未改代码
> 关联：PR #92（draft，base `ui`）；交接文档 `D:\Work\code\iris-integration-handoff\iris-{backend,frontend}-fix.md`

---

## 0. 一句话结论

四条分支共 **34 条评审发现**。前端分支的 6 条 + 外部复审的 P1/P2 已全部整改并推到 PR #92（`6a64ec4b`，验证全绿）；**后端三条分支的 28 条发现仍未修**，其中「模型名修复只改了示例模板、线上配置会覆盖回去」与「MCP 并发上界」两条建议在合并前先处理。

---

## 1. 分支与落地状态

| 工作包 | 分支 | HEAD | 基线 | 状态 |
|---|---|---|---|---|
| A 配置 fail-fast + 流式错误契约 | `fix/backend-issues` | `d505ddf9` | `ui` @ `9d3c5317` | 本地，未 push / 未开 PR |
| B 流式错误契约（多 Agent 线） | `fix/stream-error-contract` | `8408c94a` | `feat/iris21-multiagent-integration` @ `6ba65478` | 本地，未 push / 未开 PR |
| C8 MCP 两个深模块 | `fix/mcp-seam` | `bc3c42f1` | `ui` @ `9d3c5317` | 本地，未 push / 未开 PR |
| 前端评审整改 | `fix/frontend-review-20261116` | `6a64ec4b` | `ui` @ `cf9e9351` | **PR #92（draft）**，base `ui`，13 提交 / 126 文件（+2337 / −441） |

工作树均干净。A/B 两条改的是**同一处流式错误契约**，合并时须择一，不能各修一版。

---

## 2. 后端评审发现（28 条，均未修）

### 2.1 `fix/mcp-seam` @ `bc3c42f1`（10 条）

**高**

| # | 位置 | 问题 |
|---|---|---|
| 1 | `agent/service/impl/McpServerServiceImpl.java:79` | `updateMcp`/`deleteMcp`/`getMcp`/`getTools` 仍解引用可空的 `getByCodeAndUser()` 结果；双击删除第二次 DELETE 查不到 → NPE → HTTP 500（`callTool` 同提交已改 404，这四处漏了） |
| 2 | `agent/mcp/McpToolRegistry.java:155` | 等待方超时即 `finally` 归还 permit，但 `callOnce` 还在跑；`per-server-max` 不再约束真实在途调用，卡住的服务器会拖垮共享线程池，健康服务也被报 `OVERLOADED` |
| 3 | `agent/mcp/McpToolRegistry.java:87` | `discover()` 无并发闸门，`CompletableFuture.cancel(true)` 对已运行任务无效；超时返回后任务仍占线程池最长 60s |
| 4 | `agent/mcp/McpToolCallbackProvider.java:46` | `getCallbacks` 在请求线程同步 `discover`，每个未缓存服务阻塞 30s；3 个不可达服务 = 首条 SSE 前卡 ~90s，且失败不缓存，每轮重演 |

**中**

| # | 位置 | 问题 |
|---|---|---|
| 5 | `McpServerServiceImpl.java:98` | `getMcp`/`getTools` 丢弃 `Discovery.failure()`，只返回 `toolsOrEmpty()`；管理端无法区分「没工具」与「不可达/被拒/过载」，正是该提交声称修掉的静默跳过 |
| 6 | `agent/mcp/SdkMcpSession.java:56` | 无 `TextContent` 的成功结果从旧实现 `"{}"` 变成 `""`，只返回 structured content 的工具会让模型收到空输出 |
| 7 | `agent/mcp/McpClientFactory.java:145` | `parseConfig` 填的 `command/args/env/headers` 无人读取，且与 `McpServerServiceImpl.extractUrl/extractHost` 重复解析 `mcpServers`，两套解析器会漂移 |

**低**

| # | 位置 | 问题 |
|---|---|---|
| 8 | `agent/mcp/McpToolCallback.java:54` | 每次失败打两条 WARN（`McpToolRegistry.failure:231` 已记过） |
| 9 | `agent/mcp/McpClientFactory.java:67` | 把策略层 `BusinessException` 包成 `McpSessionException` 时丢了 cause |
| 10 | `agent/mcp/McpToolRegistry.java:40` | 发现超时硬编码 30s（其他 MCP 超时都是配置项），短于工厂 60s SSE 初始化超时 |

### 2.2 `fix/backend-issues` @ `d505ddf9`（9 条）

**高**

| # | 位置 | 问题 |
|---|---|---|
| 1 | `agent/AgentStreamError.java:53` | 只按 HTTP 状态码分类：403 一律「额度不足」，其余（400 参数/上下文超长、404 模型名错）一律「稍后重试」。模型名写错正是原事故形态，用户重试永远不恢复 |
| 2 | `AgentStreamError.java:86` | 硬编码 host `dashscope.aliyuncs.com`；base-url 换国际站/企业网关后修复静默失效，无告警 |
| 3 | `application-server.example.yml:75` | **模型名修复只改了示例模板**；线上加载的是 gitignored 的 `application-server.yml`（更高优先级），不同步就仍 `qwen-vl-plus` → 404 |
| 4 | `application.yml:101` | 去掉默认值后，未导出 `DASHSCOPE_API_KEY` 的本地 `mvn test` 在 `contextLoads` 就 `PlaceholderResolutionException`；只有 ci profile 补了占位符 |

**中**

| # | 位置 | 问题 |
|---|---|---|
| 5 | `application.yml:101` | 变量存在但为空串时占位符照常解析，fail-fast 不生效，仍是「启动成功、首个请求 401」；需显式 `isBlank` 校验 |
| 6 | `controller/AgentController.java:89` | error 帧改成 `{code,msg}` JSON，但仍在构建的 Vue 客户端 `useAgentStream.ts:123` `throw new Error(event.data)`，会把原始 JSON 显示给用户 |
| 7 | `AgentStreamError.java:73` | 只识别 `WebClientResponseException`；非流式 `RestClient` 路径抛 `NonTransientAiException`/`TransientAiException`（无 cause），一律归 `SYSTEM_ERROR` |

**低**

| # | 位置 | 问题 |
|---|---|---|
| 8 | `web/src/lib/api.ts:392` | `msg` 为空/非字符串时回退成整段 JSON 文本 |
| 9 | `web/src/lib/faults.ts:191` | 50301/50302/50303 三段仅 title 不同，可改查表 |

### 2.3 `fix/stream-error-contract` @ `8408c94a`（9 条）

与 A 高度重合，另有三条 B 特有：

| # | 位置 | 问题 |
|---|---|---|
| 1 | `AgentStreamError.java:56` | 同 A-1（400/404/422 → 「稍后重试」）；测试 `AgentStreamErrorTest.java:50` 还把 404→UNAVAILABLE 固化成断言 |
| 2 | `AgentStreamError.java:53` | 状态码压过响应体：403 一律「额度不足」，body 是 `AccessDenied` 时排查方向完全错 |
| 3 | `AgentStreamError.java:45` | **SSE 流内错误完全看不见**：DashScope 200 后吐 error chunk 抛无 cause 的 `DashScopeException`，绕过分类仍是 `SYSTEM_ERROR`——正是本 PR 要消除的症状 |
| 4 | `web/src/lib/api.ts:424` | JSON 帧缺字符串 `msg` 时回退成原始 JSON 作为 message |
| 5 | `web/src/lib/api.ts:430` | 旧纯文本帧映射成 50000 后 `faults.ts:222` 丢弃 `cause.message`，保留的旧文案到不了用户 |
| 6 | `web/src/lib/faults.ts:191` | 三段 503xx 特例违反 `CODING_STANDARDS.md:32-33`，应改 code→title 表 |
| 7 | `AgentStreamError.java:20` | 硬编码 host，同 A-2；测试也用同一硬编码 host 构造，改坏也测不出 |
| 8 | `frontend/src/composables/useAgentStream.ts:123` | 弃用但仍构建的 Vue 客户端把 JSON 帧当纯文本抛出，测试还 mock 旧帧 |
| 9 | `AgentStreamErrorTest.java:37` | 固化可疑映射，缺 400/429 与流内错误用例 |

---

## 3. 前端整改（PR #92，已完成并推送）

### 3.1 首批评审 6 条（`77e43f6c` + `47e1c2ff`）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 管理端宽表勾选列吸走富余宽度（实测 1200/1440/1600 视口下 376/616/776px） | `77e43f6c`：列宽规则只作用于声明了列宽的表头；61 张逐像素复核通过 |
| 2 | 个人中心聚合读不出来时统计显示 0，副标题却写「按当前页」 | `47e1c2ff`：退回本页汇总（口径标 page），两边都没读数才显示「—」；死代码 `loadMyStats` 换成纯函数 `resolveScopedStats`，`RecordsPage` 一并复用 |
| 3 | 加载骨架 `<td>` 没有 `data-col`，窄屏卡片化加载瞬间错位 | 骨架单元格补列身份 |
| 4 | 草稿防抖 300ms 后刷新/关页丢最后一段 | 补 `pagehide` 兜底（React 卸载不覆盖页面关闭） |
| 5 | 棱镜 `pointerleave` 不取消已排队 rAF，离开后卡 hover 态 | 离开时 `cancelAnimationFrame` |
| 6 | `records.test.ts` 只测死代码 `loadMyStats` | 载荷校验用例移到 `loadServerStats`，合成用例给 `resolveScopedStats` |

### 3.2 外部复审 P1 + P2（`6a64ec4b`）

| 条目 | 处理 |
|---|---|
| **P1** 统计降级是真实回归（聚合 404 时显示 0） | 修复已在 `47e1c2ff`；本批把回归用例换成复审那一幕：**聚合 404 + 列表 37 条、近 10 条 2 条高风险 → 断言页面显示 37 与 2，不是 0** |
| **P2-A** `components.json` 被删、shadcn 仍在 devDependencies，组件生成流程不完整 | 恢复 `web/components.json`（`base-nova` / `lucide` / alias 指向 `@/components` 与 `@/lib/utils`）并补 CLI 落点 `src/lib/utils.ts`（仅一个 `cn`，不引 clsx / tailwind-merge）；决策写进 `web/DESIGN.md` 规则 18：组件底座是 Base UI 薄封装，`components.json` 是生成约束不是现状 |
| **P2-B** 统计查询键带页码，翻页为同一账号级统计建新键 | 新增 `queryKeys.records.stats(scope)`，个人中心与记录页共用缓存，scope 隔离不变 |
| **P2-C** 宽表回归只有人工测量与截图，无可长期跑的断言 | 新增 `web/e2e/admin-columns.spec.ts`（用户管理 + 诊断管理），**不需要后端与账号**（测试内拦截会话与列表） |

#### 几何断言的设计要点

表格是 `table-layout: fixed` + `width: 100%`，富余宽度由浏览器**按声明宽度等比分摊**。实测勾选列声明 40px、容器 1266px 时拿到 68.8px（= 40/736 的份额）——所以「40px 定宽」不是不变量。断言改为断**份额**：

- 每列实际份额 = 声明份额（容差 1.5 个百分点）
- 勾选列份额 ≤ 10%
- 操作列贴表格右边缘（容差 2px）
- 份额不随视口漂移（1200 与 1600 两档）

**有效性验证**：临时把 `77e43f6c` 的修复回退成 `width: var(--col-w, auto)`，两条用例都变红（勾选列实际 19.6% / 9.1%，声明 5.4% / 4.2%）；恢复后全绿。

### 3.3 验证读数

| 验证项 | 结果 |
|---|---|
| `npm run typecheck` | 通过，0 错误 |
| `npm run lint` | 通过，0 error / 0 warning |
| `npm test`（Vitest） | 53 文件 / **470** 用例全绿（基线 436 → 463 → 470） |
| `npm run build` | 通过，2.11s |
| `check:e2e-fixme` | 0 隔离，无 `test.only` |
| `check:gate-tests` | pass 3 / fail 0 |
| 入口 JS | 474.84 kB（gzip 154.60 kB），与前一批一致 |
| `admin-columns.spec.ts`（Playwright） | 2 passed（5.8s），回退修复时 2 failed |

---

## 4. 遗留与后续

### 4.1 前端

1. **`/profile` 逐像素证据过期**：口径提示文案改过，冻结基线的 61 张证据需为这一页重跑（仓库里没有留下比对脚本，上次是手工跑的）。
2. **几何断言未覆盖**：暗主题与 ≤900px 卡片化路径不在 `admin-columns.spec.ts` 里，是否纳入待定。
3. **仍需单独评的项**（交接文档 §4 已列）：M-1 筛选草稿 state 下沉、M-2 `columns` 稳定化、B-1 `@base-ui/react` 首屏拆包、≤900 卡片化块收敛、组件令牌集中、`:hover` 门控。

### 4.2 后端（合并前建议）

| 优先级 | 事项 |
|---|---|
| P0 | 核实线上实际加载的 `application-server.yml` 是否已同步模型名 `qwen3-vl-plus`（只改 example 模板不算修好） |
| P0 | MCP permit 提前归还与 discover 无闸门两条并发缺陷（`mcp-seam` #2/#3/#4） |
| P0 | 流式错误分类的 host 硬编码与状态码推断（A/B 重合，须择一修） |
| P1 | `McpServerServiceImpl` 四处 NPE→500；流内 error chunk 绕过分类 |
| P1 | A/B 契约归属决策：以 B 为准（防 #87 覆盖）/ 以 A 为准 / 两条冻结 |

### 4.3 流程状态

- PR #92 仍为 **draft**；按仓库规则 Draft→Ready 由用户自行翻转，agent 未执行。
- 后端三条分支仍未 push、未开 PR、未合并、未部署。
- 定时任务 `92cea203`（每 10 分钟检查交接文件）在判定 READY 时已删除。

---

## 5. 产物索引

| 产物 | 路径 |
|---|---|
| 前端评审报告（已更新处理状态与两轮整改） | `docs/2026-11-16-web-react-code-review.md` |
| 前端交接文档 | `D:\Work\code\iris-integration-handoff\iris-frontend-fix.md` |
| 后端交接文档 | `D:\Work\code\iris-integration-handoff\iris-backend-fix.md` |
| 几何断言 | `web/e2e/admin-columns.spec.ts` + `web/e2e/README.md` |
| 组件治理决策 | `web/DESIGN.md` 规则 18、`web/components.json`、`web/src/lib/utils.ts` |
