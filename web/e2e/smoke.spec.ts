import { expect, test, type Page } from "@playwright/test"

/**
 * 九条验收冒烟：登录 → 判读槽、记录纸（合成链 + 真实后端链）、资讯详情
 * （真实链 + 合成链 + 头条封面 + 目录锚点）、Agent 回复（正常回复 + 工具无回执）。
 * 账号从环境变量取；缺账号时整体 skip（不红），见 e2e/README.md。
 *
 * 登录走真实后端；部分记录与资讯用固定合成读数夹具，Agent 用可控 SSE。
 * 九条都执行；不代表真实模型、算法推理或临床验收。
 */
const user = process.env.E2E_USER
const password = process.env.E2E_PASSWORD
const hasAccount = Boolean(user && password)

async function login(page: Page) {
  await page.goto("/login")
  await page.getByPlaceholder("useraccount").fill(user!)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole("button", { name: "登录" }).click()
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 })
}

test.describe("验收冒烟", () => {
  test.skip(
    !hasAccount,
    "需要 E2E_USER / E2E_PASSWORD，以及运行中的后端（见 e2e/README.md）"
  )

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("登录后判读页的影像槽可见", async ({ page }) => {
    await page.goto("/diagnosis")
    await expect(page.getByText("点击或拖入影像")).toBeVisible()
  })

  test("记录页空态与合成记录：点行进入独立报告页", async ({ page }) => {
    const record = {
      id: "81001",
      result: "青光眼",
      confidence: 0.7,
      createTime: "2026-11-15T10:00:00",
      modelVersion: "synthetic-smoke",
      humanReviewStatus: "PENDING",
      severity: "MODERATE",
    }
    let records: (typeof record)[] = []
    await page.route("**/api/diagnosis/list/page/my", (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            records,
            total: records.length,
            current: 1,
            size: 10,
            pages: 1,
          },
        },
      })
    )
    await page.route("**/api/diagnosis/stats/my", (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            total: records.length,
            highRisk: 0,
            awaitingReview: records.length,
            lastReadAt: null,
          },
        },
      })
    )
    await page.route("**/api/diagnosis/get/81001", (route) =>
      route.fulfill({ json: { code: 0, data: record } })
    )
    await page.goto("/records")
    await expect(page.getByText("还没有属于你的判读")).toBeVisible()
    records = [record]
    await page.reload()
    const firstRow = page.locator(".records__row").first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    await firstRow.click()
    // R3 Phase 3：报告不再在列表里展开，而是独立路由，刷新后仍可取。
    await expect(page).toHaveURL(/\/records\/81001$/)
    await expect(page.locator(".sheet")).toBeVisible()
    await expect(page.locator(".sheet")).toContainText("synthetic-smoke")
    await expect(page.locator(".sheet__verdict")).toContainText("青光眼")
  })

  // 来自 Roundtable 集成分支：真实后端（专用测试库）的记录链。
  // 上面的合成用例保证「行 → 独立报告」的导航；这条保证同一流程在真实接口上成立。
  test("记录页读取真实后端本人记录：行 → 独立报告", async ({ page }) => {
    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/diagnosis/list/page/my" &&
        response.request().method() === "POST"
    )
    await page.goto("/records")
    const payload = await (await listed).json()
    expect(payload.code).toBe(0)
    const records = payload.data.records
    expect(Array.isArray(records)).toBe(true)
    if (records.length === 0) {
      await expect(page.getByText("还没有属于你的判读")).toBeVisible()
      await expect(page.locator(".records__row")).toHaveCount(0)
      return
    }
    const id = String(records[0].id)
    const detail = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/diagnosis/get/${id}`
    )
    const firstRow = page.locator(".records__row").first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    await firstRow.click()
    const selected = await (await detail).json()
    expect(selected.code).toBe(0)
    expect(String(selected.data.id)).toBe(id)
    await expect(page).toHaveURL(new RegExp(`/records/${id}$`))
    await expect(page.locator(".sheet")).toBeVisible()
    await expect(page.locator(".sheet__head")).toContainText(id)
    await expect(page.locator(".sheet__verdict")).toBeVisible()
  })

  test("资讯页读取真实后端已发布条目：详情正文非空", async ({ page }) => {
    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/news/list/page/vo" &&
        response.request().method() === "POST"
    )
    await page.goto("/news")
    const payload = await (await listed).json()
    expect(payload.code).toBe(0)
    expect(payload.data.records.length, "专用测试库需至少一条已发布资讯").toBeGreaterThan(0)
    const news = payload.data.records[0]
    const detail = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/news/get/${news.id}`
    )
    // 期刊抬头把首条当头条，可访问名字里带「最新 · LATEST」与日期，按子串匹配。
    await page.getByRole("link", { name: news.title }).first().click()
    const selected = await (await detail).json()
    expect(selected.code).toBe(0)
    expect(String(selected.data.id)).toBe(String(news.id))
    expect(selected.data.content?.trim()).toBeTruthy()
    await expect(page.getByRole("heading", { level: 1, name: news.title })).toBeVisible()
    await expect(page.locator(".news-paper__body")).toBeVisible()
    await expect(page.locator(".news-paper__body")).not.toBeEmpty()
  })

  test("资讯页点合成条目，详情标题与正文可见", async ({ page }) => {    const news = {
      id: "81002",
      title: "合成冒烟资讯",
      content: "仅用于测试的合成资讯正文。",
      publishTime: "2026-11-15T10:00:00",
    }
    await page.route("**/api/news/list/page/vo", (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: { records: [news], total: 1, current: 1, size: 9, pages: 1 },
        },
      })
    )
    await page.route("**/api/news/get/81002", (route) =>
      route.fulfill({ json: { code: 0, data: news } })
    )
    await page.goto("/news")
    // 单条资讯会被期刊抬头当成头条：整块头条是一个链接，可访问名字里
    // 还带着「最新 · LATEST」和日期，所以这里按子串匹配。
    const firstCard = page.getByRole("link", { name: news.title })
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    await expect(
      page.getByRole("heading", { level: 1, name: news.title })
    ).toBeVisible()
    await expect(page.getByText(news.content)).toBeVisible()
  })

  test("期刊头条的封面本身就能点进文章", async ({ page }) => {
    const news = {
      id: "81004",
      title: "有封面的合成头条",
      content: "仅用于测试的合成资讯正文。",
      publishTime: "2026-11-15T10:00:00",
      // 1×1 GIF：不引外部资源，图位照常渲染。
      coverImage:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    }
    await page.route("**/api/news/list/page/vo", (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: { records: [news], total: 1, current: 1, size: 9, pages: 1 },
        },
      })
    )
    await page.route("**/api/news/get/81004", (route) =>
      route.fulfill({ json: { code: 0, data: news } })
    )
    await page.goto("/news")

    // 点的是封面本身，不是标题文字：整块头条是一个链接。
    const plate = page.locator(".journal__latest-plate")
    await expect(plate).toBeVisible({ timeout: 15_000 })
    await plate.click()
    await expect(
      page.getByRole("heading", { level: 1, name: news.title })
    ).toBeVisible()
  })

  test("目录锚点不给历史加条目：浏览器返回直接离开文章", async ({ page }) => {
    const news = {
      id: "81005",
      title: "带章节的合成长文",
      content: "<h2>第一节</h2><p>内容一</p><h2>第二节</h2><p>内容二</p>",
      publishTime: "2026-11-15T10:00:00",
    }
    await page.route("**/api/news/list/page/vo", (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: { records: [news], total: 1, current: 1, size: 9, pages: 1 },
        },
      })
    )
    await page.route("**/api/news/get/81005", (route) =>
      route.fulfill({ json: { code: 0, data: news } })
    )
    await page.goto("/news")
    await page.getByRole("link", { name: news.title }).click()

    const toc = page.locator(".news-toc").getByRole("link", { name: /第二节/ })
    await expect(toc).toBeVisible()
    await toc.click()
    await expect(page).toHaveURL(/#news-sec-2$/)

    // replaceState 只改地址栏，不塞历史：返回应当离开文章，回到列表。
    await page.goBack()
    await expect(page).toHaveURL(/\/news$/)
  })

  test("Agent 发送后显示本地 SSE 回复并结束加载", async ({ page }) => {
    const reply = "本地 SSE 合成回复，不是医疗建议。"
    let sent: { message: string; threadId: string } | undefined
    await page.route("**/api/agent/chat/stream", async (route) => {
      sent = route.request().postDataJSON()
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ messageType: "ASSISTANT", content: reply })}\n\nevent: done\ndata: {}\n\n`,
      })
    })
    // 自动标题同样会调用模型；冒烟不向外网发模型请求。
    await page.route("**/api/agent/sessions/*/generate-title", (route) =>
      route.fulfill({ json: { code: 0, data: true } })
    )
    await page.goto("/agent")
    // 不能用 placeholder 定位后再输入：输入框有文字后 placeholder 会变成空串，
    // 第二次解析 locator 就找不到了。用稳定的类名定位（R3 起输入框是
    // `.prompt__input`，旧 `.agent-input__textarea` 已随工作区重做删除）。
    const input = page.locator(".prompt__input")
    await input.fill("你好")
    await input.press("Enter")
    await expect(
      page.locator(".agent-msg--assistant").filter({ hasText: reply })
    ).toBeVisible()
    expect(sent?.message).toBe("你好")
    expect(sent?.threadId).toBeTruthy()
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible()
    await expect(input).toHaveValue("")
  })

  test("工具没有回执就结束的回合，执行过程显示「未确认」而不是「执行中」", async ({ page }) => {
    await page.route("**/api/agent/chat/stream", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body:
          `data: ${JSON.stringify({
            // 后端 MessageType 的 @JsonValue 是 "tool-request"（小写连字符）。
            messageType: "tool-request",
            toolCalls: [{ name: "searchDocuments", arguments: '{"query":"白内障"}' }],
          })}\n\nevent: done\ndata: {}\n\n`,
      })
    )
    await page.route("**/api/agent/sessions/*/generate-title", (route) =>
      route.fulfill({ json: { code: 0, data: true } })
    )
    await page.goto("/agent")
    const input = page.locator(".prompt__input")
    await input.fill("查一下白内障")
    await input.press("Enter")

    // 流结束了但后端没有 tool-response：不能一直挂着「执行中」，
    // 也不能说「完成」——只能说「未确认」。
    await expect(page.getByText("未确认")).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(".thought__state").filter({ hasText: "执行中" })).toHaveCount(0)
  })
})
