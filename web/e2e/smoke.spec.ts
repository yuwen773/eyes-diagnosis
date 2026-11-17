import { expect, test, type Page } from "@playwright/test"

/**
 * 四条验收冒烟：登录 → 判读槽、记录纸、资讯详情、Agent 回复。
 * 账号从环境变量取；缺账号时整体 skip（不红），见 e2e/README.md。
 *
 * 登录走真实后端；记录与资讯用固定合成读数夹具，Agent 用可控 SSE。
 * 四条都执行；不代表真实模型、算法推理或临床验收。
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

  test("记录页空态与合成记录展开均可见", async ({ page }) => {
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
    await expect(page.locator(".sheet")).toBeVisible()
    await expect(page.locator(".sheet")).toContainText("synthetic-smoke")
    await expect(page.locator(".sheet__verdict")).toContainText("青光眼")
  })

  test("资讯页点合成条目，详情标题与正文可见", async ({ page }) => {
    const news = {
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
    const firstCard = page.getByRole("link", { name: news.title, exact: true })
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    await expect(
      page.getByRole("heading", { level: 1, name: news.title })
    ).toBeVisible()
    await expect(page.getByText(news.content)).toBeVisible()
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
