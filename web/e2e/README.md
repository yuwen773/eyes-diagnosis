# 验收冒烟（Playwright）

四条浏览器冒烟：登录 → 判读槽 / 记录纸 / 资讯详情 / Agent 回复。
登录、会话、记录、资讯走真实后端 API。专用测试库使用下述合成数据种子，
浏览器不拦截记录或资讯响应；Agent SSE 与自动标题使用明确的本地测试源。
记录为空时验证真实空态，有数据时核对列表 id、详情 id 和记录纸；不要求管理员恰好有患者记录。
这些结果属于真实应用上的合成数据验收，不代表真实模型推理或临床验收。

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
E2E_USER=<账号> E2E_PASSWORD=<密码> npm run test:smoke
```

- `npm run test:e2e` 会跑整个 `e2e/` 目录（含协作专项与需要 `PRODUCT_ACCEPTANCE_LIVE`
  的真实提供方用例），**不是**这四条冒烟的入口；只跑冒烟用 `npm run test:smoke`。
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
| 记录页真实空态或本人记录展开 | 执行 | 实际分页与详情响应；空态、记录纸按专用库种子分两次验证 |
| 已发布资讯 → 标题与正文 | 执行 | 实际公开列表与详情；核对 id、可访问标题和非空正文 |
| Agent 本地 SSE 回复与加载结束 | 执行 | 拦截流与自动标题请求，断言固定回复与发送内容 |

`test.fixme` 是**临时隔离**，不是"这条先不跑"的开关：

- 每条都必须登记在 `e2e/fixme-budget.json`（文件 / 标题 / issue / 原因），并受 `max` 硬上限约束；
- `npm run check:e2e-fixme`（CI 的 `web` job 会跑）会拒绝：未登记的 fixme、超预算的数量、
  缺少原因、测试修好后没删掉的条目、以及 `test.only`（它会让其余用例静默不跑）；
- 所以新增一条 fixme = 一次需要人审批的动作，PR diff 里看得见。

## 专用库种子（真实 API 验收）

只在新建、可清理的 `diagnosis_ci` 测试库运行，不能对开发/临床已有库执行。
先经正常注册接口建立 `irisSmokeFixture` 前缀的合成用户，凭证通过上述环境变量传入。
使用数据库客户端连接该专用库，在**同一个连接**里设置 `@smokeAccount` 为此账号，然后执行：

1. `fixtures/smoke-news.sql`：插入一条公开已发布的合成资讯；不伪造浏览器响应。
2. 不插入记录，跑 `playwright test e2e/smoke.spec.ts`：验证真实空态及其余三条。
3. `fixtures/smoke-record.sql`：插入属于该合成用户的一条 `synthetic-smoke` 记录。
4. 跑 `playwright test e2e/smoke.spec.ts --grep 记录页`：验证真实列表 → 详情 → 记录纸。

两份 SQL 均限制 schema 名与账号前缀，不更新或删除已有数据；重复插入会失败，
不会静默覆盖。若公开资讯为空，资讯测试明确失败并提示种子缺失，不转成 skip。
只有环境账号缺失才整组 skip；有账号时失败就是失败，不能写成通过。

## 失败时

- 截图：`test-results/**/test-failed-*.png`
- trace：`test-results/**/trace.zip`，用 `npx playwright show-trace <file>` 打开

## 为什么不进 CI

CI 不提供这四条 smoke 的登录账号与运行中的应用栈；发布前手动跑一次（见仓库根
`README.md` 的验证段）。CI 的 web job 跑 `npm run check:e2e-fixme` 与
`npm run check:gate-tests`，不以静态门禁冒充浏览器验收。

## TASK-08B 协作专项（显式选择，证据分开）

`smoke.spec.ts` 保留真实登录并使用上述合成读数与 SSE；本节协作专项的夹具
同样单独报告，不计为生产通过。使用文件名或专项脚本选择目标套件。

- `npm run test:collaboration`：前端以 `VITE_COLLABORATION_ENABLED=true` 启动，验证合成 HTTP/SSE 契约、四组 Windows Chromium 截图、投影、终态、滚动和键盘/对比度/reduced-motion。截图初次生成后须检查，再在不带 `--update-snapshots` 的运行中验证。当前截图基线为 Windows Chromium，其他平台应单独建立和审阅。
- `npm run test:collaboration-backend`：显式启动 `CollaborationBrowserServer`（仓库根 `scripts/run_task05_browser_server.ps1`），直连真实 Java 控制器、Coordinator、MySQL 和 MapSessionRepository。存储、推理、模型及会话引导为合成夹具；不会调用真实提供方。临时库只允许 `jdbc:mysql://127.0.0.1:<port>/collaboration_test`，须是专用可清理库。
- `npx playwright test e2e/collaboration-default-off.spec.ts`：连接未设置前端开关的生产构建预览，验证无协作 API 请求及普通聊天回归；聊天响应使用明确的合成 SSE。

前端设置 `COLLABORATION_TEST_BACKEND=http://127.0.0.1:18085` 后用 Vite 的 `/api` 代理连接测试后端；未设置时目标仍为 8081。可选 `E2E_CHROMIUM_EXECUTABLE_PATH` 指向本机已有 Chromium；报告须记录实际浏览器版本。不同 Playwright 命令并行执行时须传不同 `--output` 目录。

跨域边界：代理把 Origin 改写为 target（`vite.config.ts`），使浏览器请求经代理后是**同源**请求——后端 `SameOriginFilter` 仍然全量生效，本组没有任何绕过或关闭该过滤器的用例；`collaboration-safety.spec.ts` 里显式带了恶意 Origin 的负例，预期被后端 403 拒绝。
