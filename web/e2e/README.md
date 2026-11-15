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

`playwright.config.ts` 在**本地**会三级回落找浏览器（`E2E_CHROMIUM_PATH` → 匹配版本 →
`ms-playwright` 里修订号最新的一份），这只是本机兼容兜底。**CI 不用这个回落**：CI 的标准
环境是用 `npx playwright install --with-deps chromium` 装与 `@playwright/test` 版本匹配的那一版。

## 已知失败与 fixme 预算

`smoke.spec.ts` 现在是 **1 条真跑 + 3 条 fixme**（Issue #81）。所以这套的结论只能说
"登录那条通过、三条已知失败被隔离"，**不能**说成"4 条冒烟通过"。

| 用例 | 状态 | 修法 |
| --- | --- | --- |
| 登录后判读页的影像槽可见 | 真跑 | — |
| 记录页展开第一条，能看到记录纸标题 | fixme | 补数据夹具（管理员账号没有患者记录） |
| 资讯页点第一条，详情标题可见 | fixme | `.chroma-card` 已随资讯页改版下线，换成稳定定位 |
| Agent 发送后 30 秒内出现回复气泡 | fixme | 换成本地可控的 SSE 测试源，去掉外网 LLM 依赖 |

`test.fixme` 是**临时隔离**，不是"这条先不跑"的开关：

- 每条都必须登记在 `e2e/fixme-budget.json`（文件 / 标题 / issue / 原因），并受 `max` 硬上限约束；
- `npm run check:e2e-fixme`（CI 的 `web` job 会跑）会拒绝：未登记的 fixme、超预算的数量、
  测试修好后没删掉的条目、以及 `test.only`（它会让其余用例静默不跑）；
- 所以新增一条 fixme = 一次需要人审批的动作，PR diff 里看得见。

## 失败时

- 截图：`test-results/**/test-failed-*.png`
- trace：`test-results/**/trace.zip`，用 `npx playwright show-trace <file>` 打开

## 为什么不进 CI

CI 没有 MySQL / Redis / 算法服务，也拿不到真实账号；跑用例只会得到一串环境失败。
发布前手动跑一次即可（见仓库根 `README.md` 的验证段）。CI 里只跑**静态**检查
`npm run check:e2e-fixme`（跳过项是否已登记），不跑 Playwright 本身。
