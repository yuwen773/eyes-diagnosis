# 验收冒烟（Playwright）

四条走真实后端的冒烟：登录 → 判读槽 / 记录纸 / 资讯详情 / Agent 回复。
它不是单元测试的替代品，只回答一个问题：**这套前端在真环境里还走得通吗。**

## 前置

全部手动起，`playwright.config.ts` 刻意不配 `webServer`（后端是另一条 Java 线）：

| 依赖 | 说明 |
| --- | --- |
| 前端 | `npm run dev`（默认 :5173；换端口用 `E2E_BASE_URL`） |
| 后端 | `mvn spring-boot:run`，:8081，`/api` 前缀 |
| MySQL / Redis | 后端会话与数据（本机两套 MySQL，见仓库 `CLAUDE.local.md`） |
| 算法服务 | 判读链路需要 Python gRPC :50051（只看 Agent/资讯时可不验判读） |

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

## 失败时

- 截图：`test-results/**/test-failed-*.png`
- trace：`test-results/**/trace.zip`，用 `npx playwright show-trace <file>` 打开

## 为什么不进 CI

CI 没有 MySQL / Redis / 算法服务，也拿不到真实账号；进 CI 只会得到一串环境失败。
发布前手动跑一次即可（见仓库根 `README.md` 的验证段）。

## TASK-08B 协作专项（显式选择，证据分开）

`npm run test:e2e` 保留上述生产依赖 smoke；不把本节的合成夹具计为生产通过。

- `npm run test:collaboration`：前端以 `VITE_COLLABORATION_ENABLED=true` 启动，验证合成 HTTP/SSE 契约、四组 Windows Chromium 截图、投影、终态、滚动和键盘/对比度/reduced-motion。截图初次生成后须检查，再在不带 `--update-snapshots` 的运行中验证。当前截图基线为 Windows Chromium，其他平台应单独建立和审阅。
- `npm run test:collaboration-backend`：显式启动 `CollaborationBrowserServer`（仓库根 `scripts/run_task05_browser_server.ps1`），直连真实 Java 控制器、Coordinator、MySQL 和 MapSessionRepository。存储、推理、模型及会话引导为合成夹具；不会调用真实提供方。临时库只允许 `jdbc:mysql://127.0.0.1:<port>/collaboration_test`，须是专用可清理库。
- `npx playwright test e2e/collaboration-default-off.spec.ts`：连接未设置前端开关的生产构建预览，验证无协作 API 请求及普通聊天回归；聊天响应使用明确的合成 SSE。

前端设置 `COLLABORATION_TEST_BACKEND=http://127.0.0.1:18085` 后用 Vite 的 `/api` 代理连接测试后端；未设置时目标仍为 8081。可选 `E2E_CHROMIUM_EXECUTABLE_PATH` 指向本机已有 Chromium；报告须记录实际浏览器版本。不同 Playwright 命令并行执行时须传不同 `--output` 目录。

跨域边界：代理把 Origin 改写为 target（`vite.config.ts`），使浏览器请求经代理后是**同源**请求——后端 `SameOriginFilter` 仍然全量生效，本组没有任何绕过或关闭该过滤器的用例；`collaboration-safety.spec.ts` 里显式带了恶意 Origin 的负例，预期被后端 403 拒绝。
