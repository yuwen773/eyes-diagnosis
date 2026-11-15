# 验收冒烟（Playwright）

四条浏览器冒烟：登录 → 判读槽 / 记录纸 / 资讯详情 / Agent 回复。
登录与会话走真实后端；记录、资讯读数和 Agent SSE 使用测试内的合成夹具，
不依赖当前账号已有患者记录、已有资讯或外网模型。这些结果属于浏览器契约验收，
不代表真实推理、真实数据或临床验收。

## 前置

全部手动起，`playwright.config.ts` 刻意不配 `webServer`（后端是另一条 Java 线）：

| 依赖 | 说明 |
| --- | --- |
| 前端 | `npm run dev`（默认 :5173；换端口用 `E2E_BASE_URL`） |
| 后端 | `mvn spring-boot:run`，:8081，`/api` 前缀 |
| MySQL / Redis | 后端会话与数据（本机两套 MySQL，见仓库 `CLAUDE.local.md`） |
| 算法 / 外网模型 | 这四条不触发推理或外网模型；完整推理链需另行验收 |

## 环境变量

```bash
E2E_USER=<账号> E2E_PASSWORD=<密码> npm run test:e2e
```

- 两个变量缺任意一个：四条用例全部 **skipped**（不红），用于 CI / 无账号机器。
- `E2E_BASE_URL`：默认 `http://localhost:5173`。

首次运行需要浏览器：

```bash
npx playwright install chromium
```

`playwright.config.ts` 在**本地**会三级回落找浏览器（`E2E_CHROMIUM_PATH` → 匹配版本 →
`ms-playwright` 里修订号最新的一份），这只是本机兼容兜底。**CI 不用这个回落**：CI 的标准
环境是用 `npx playwright install --with-deps chromium` 装与 `@playwright/test` 版本匹配的那一版。

## Issue #81 与 fixme 预算

`smoke.spec.ts` 的四条用例均执行，无 fixme。三条历史隔离已修复，预算降为 **0**。
缺账号时仍整体跳过，必须如实报告 skipped；不能把跳过描述成通过。

| 用例 | 状态 | 修法 |
| --- | --- | --- |
| 登录后判读页的影像槽可见 | 执行 | 真实登录与页面 |
| 记录页空态与合成记录展开 | 执行 | 固定分页、统计、详情夹具；同一条验证空态与记录纸 |
| 资讯合成条目 → 标题与正文 | 执行 | 固定列表与详情；按链接内标题定位，不用历史类名 |
| Agent 本地 SSE 回复与加载结束 | 执行 | 拦截流与自动标题请求，断言固定回复与发送内容 |

`test.fixme` 是**临时隔离**，不是"这条先不跑"的开关：

- 每条都必须登记在 `e2e/fixme-budget.json`（文件 / 标题 / issue / 原因），并受 `max` 硬上限约束；
- `npm run check:e2e-fixme`（CI 的 `web` job 会跑）会拒绝：未登记的 fixme、超预算的数量、
  缺少原因、测试修好后没删掉的条目、以及 `test.only`（它会让其余用例静默不跑）；
- 所以新增一条 fixme = 一次需要人审批的动作，PR diff 里看得见。

## 失败时

- 截图：`test-results/**/test-failed-*.png`
- trace：`test-results/**/trace.zip`，用 `npx playwright show-trace <file>` 打开

## 为什么不进 CI

CI 没有 MySQL / Redis / 算法服务，也拿不到真实账号；跑用例只会得到一串环境失败。
发布前手动跑一次即可（见仓库根 `README.md` 的验证段）。CI 里只跑**静态**检查
`npm run check:e2e-fixme`（跳过项是否已登记）与 `npm run check:gate-tests`
（门禁正负例），不跑 Playwright 本身。
