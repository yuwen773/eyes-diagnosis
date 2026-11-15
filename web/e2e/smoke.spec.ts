import { expect, test, type Page } from "@playwright/test"

/**
 * 四条验收冒烟：登录 → 判读槽、记录纸、资讯详情、Agent 回复。
 * 账号从环境变量取；缺账号时整体 skip（不红），见 e2e/README.md。
 *
 * 登录、记录与资讯走真实后端；数据种在专用测试库，Agent 用可控 SSE。
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

  test("记录页读取本人记录，空态或记录纸可见", async ({ page }) => {
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
      (response) =>
        new URL(response.url()).pathname === `/api/diagnosis/get/${id}`
    )
    const firstRow = page.locator(".records__row").first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    await firstRow.click()
    const selected = await (await detail).json()
    expect(selected.code).toBe(0)
    expect(String(selected.data.id)).toBe(id)
    await expect(page.locator(".sheet")).toBeVisible()
    await expect(page.locator(".sheet__head")).toContainText(id)
    await expect(page.locator(".sheet__verdict")).toBeVisible()
  })

  test("资讯页点已发布条目，真实详情标题与正文可见", async ({ page }) => {
    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/news/list/page/vo" &&
        response.request().method() === "POST"
    )
    await page.goto("/news")
    const payload = await (await listed).json()
    expect(payload.code).toBe(0)
    expect(
      payload.data.records.length,
      "专用测试库需至少一条已发布资讯"
    ).toBeGreaterThan(0)
    const news = payload.data.records[0]
    const detail = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/news/get/${news.id}`
    )
    const firstCard = page
      .getByRole("link", { name: news.title, exact: true })
      .first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    const selected = await (await detail).json()
    expect(selected.code).toBe(0)
    expect(String(selected.data.id)).toBe(String(news.id))
    expect(selected.data.content?.trim()).toBeTruthy()
    await expect(
      page.getByRole("heading", { level: 1, name: news.title })
    ).toBeVisible()
    await expect(page.locator(".news-paper__body")).toBeVisible()
    await expect(page.locator(".news-paper__body")).not.toBeEmpty()
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
    // 第二次解析 locator 就找不到了。用稳定的类名定位。
    const input = page.locator(".agent-input__textarea")
    await input.fill("你好")
    await input.press("Enter")
    await expect(
      page.locator(".agent-msg--assistant").filter({ hasText: reply })
    ).toBeVisible()
    expect(sent?.message).toBe("你好")
    expect(sent?.threadId).toBeTruthy()
    await expect(
      page.getByRole("button", { name: "发送", exact: true })
    ).toBeVisible()
    await expect(input).toHaveValue("")
  })
})
