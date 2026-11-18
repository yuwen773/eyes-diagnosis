import { expect, test } from "@playwright/test"

/**
 * Iris System States R2 浏览器契约。
 *
 * 所有业务失败用 page.route 注入：验证的是状态呈现与恢复语义，
 * 不冒充真实后端数据，也不验证临床推理。
 */

const ANON = (page: import("@playwright/test").Page) =>
  page.route("**/api/user/get/login", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: null }) }),
  )

const gateway = (route: import("@playwright/test").Route) =>
  route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: 502, msg: "bad gateway" }) })

test.describe("Iris System States R2 · 认证表单", () => {
  test("空账号：字段级提示、焦点与 aria 关联", async ({ page }) => {
    await ANON(page)
    await page.goto("/login")
    await page.locator("#password").fill("anything")
    await page.locator('form.form button[type="submit"]').click()
    const message = page.locator("#account-error")
    await expect(message).toBeVisible()
    await expect(message).toContainText("请填写账号")
    await expect(page.locator("#account")).toBeFocused()
    await expect(page.locator("#account")).toHaveAttribute("aria-invalid", "true")
    await expect(page.locator("#account")).toHaveAttribute("aria-describedby", "account-error")
    await expect(page.locator("form.form")).not.toContainText(/NET|AUTH|CHECK|FAULT|502/)
  })

  test("5xx：表单级提示给再试一次，恢复后保留输入", async ({ page }) => {
    await ANON(page)
    let attempts = 0
    await page.route("**/api/user/login", (route) => {
      attempts += 1
      return gateway(route)
    })
    await page.goto("/login")
    await page.locator("#account").fill("synthetic-user")
    await page.locator("#password").fill("synthetic-pass")
    await page.locator('form.form button[type="submit"]').click()
    const alert = page.locator(".iris-form-alert")
    await expect(alert).toContainText("服务这会儿没有响应")
    await expect(alert).not.toContainText(/NET|AUTH|CHECK|FAULT|502/)
    await alert.getByRole("button", { name: "再试一次" }).click()
    await expect(alert).toBeVisible()
    expect(attempts).toBe(2)
    await expect(page.locator("#account")).toHaveValue("synthetic-user")
    await expect(page.locator("#password")).toHaveValue("synthetic-pass")
  })

  test("错误凭据不提供无意义重试", async ({ page }) => {
    await ANON(page)
    await page.route("**/api/user/login", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 40100, msg: "unauthorized" }) }),
    )
    await page.goto("/login")
    await page.locator("#account").fill("synthetic-user")
    await page.locator("#password").fill("wrong-pass")
    await page.locator('form.form button[type="submit"]').click()
    await expect(page.locator(".iris-form-alert")).toContainText("账号或密码不对")
    await expect(page.getByRole("button", { name: "再试一次" })).toHaveCount(0)
  })

  test("网络失败：提示连不上服务", async ({ page }) => {
    await ANON(page)
    await page.route("**/api/user/login", (route) => route.abort("internetdisconnected"))
    await page.goto("/login")
    await page.locator("#account").fill("synthetic-user")
    await page.locator("#password").fill("synthetic-pass")
    await page.locator('form.form button[type="submit"]').click()
    await expect(page.locator(".iris-form-alert")).toContainText("连不上服务")
  })

  test("反斜杠 redirect 不被当成站内跳转", async ({ page }) => {
    await ANON(page)
    await page.route("**/api/user/login", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { id: "1", userAccount: "synthetic-user" } }),
      }),
    )
    await page.goto("/login?redirect=%2F%5Cevil.com")
    await page.locator("#account").fill("synthetic-user")
    await page.locator("#password").fill("synthetic-pass")
    await page.locator('form.form button[type="submit"]').click()
    await expect(page).toHaveURL(/\/diagnosis$/)
  })

  test("快速两次提交只发一次请求", async ({ page }) => {
    await ANON(page)
    let attempts = 0
    await page.route("**/api/user/login", async (route) => {
      attempts += 1
      await new Promise((resolve) => setTimeout(resolve, 600))
      return gateway(route)
    })
    await page.goto("/login")
    await page.locator("#account").fill("synthetic-user")
    await page.locator("#password").fill("synthetic-pass")
    const button = page.locator('form.form button[type="submit"]')
    await button.dispatchEvent("click")
    await button.dispatchEvent("click")
    await expect(page.locator(".iris-form-alert")).toBeVisible()
    expect(attempts).toBe(1)
  })

  test("375px 长文案不横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await ANON(page)
    await page.route("**/api/user/login", (route) => gateway(route))
    await page.goto("/login")
    await page.locator("#account").fill("synthetic-user")
    await page.locator("#password").fill("synthetic-pass")
    await page.locator('form.form button[type="submit"]').click()
    await expect(page.locator(".iris-form-alert")).toBeVisible()
    const overflow = await page.evaluate(() => {
      const alert = document.querySelector(".iris-form-alert") as HTMLElement | null
      return (alert?.scrollWidth ?? 0) - (alert?.clientWidth ?? 0)
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

test.describe("Iris System States R2 · 注册表单", () => {
  test("空账号：字段级提示并聚焦", async ({ page }) => {
    await ANON(page)
    await page.goto("/register")
    await page.locator("#password").fill("long-enough")
    await page.locator("#confirm").fill("long-enough")
    await page.locator('form.form button[type="submit"]').click()
    await expect(page.locator("#account-error")).toContainText("账号至少 4 位")
    await expect(page.locator("#account")).toBeFocused()
    await expect(page.locator("#account")).toHaveAttribute("aria-describedby", "account-error")
  })

  test("5xx：表单级提示不提供盲重试，重复提交只发一次", async ({ page }) => {
    await ANON(page)
    let attempts = 0
    await page.route("**/api/user/register", async (route) => {
      attempts += 1
      await new Promise((resolve) => setTimeout(resolve, 400))
      return gateway(route)
    })
    await page.goto("/register")
    await page.locator("#account").fill("tester01")
    await page.locator("#password").fill("long-enough")
    await page.locator("#confirm").fill("long-enough")
    const submit = page.locator('form.form button[type="submit"]')
    await submit.dispatchEvent("click")
    await submit.dispatchEvent("click")
    await expect(page.locator(".iris-form-alert")).toContainText("服务这会儿没有响应")
    await expect(page.getByRole("button", { name: "再试一次" })).toHaveCount(0)
    expect(attempts).toBe(1)
  })
})

test.describe("Iris System States R2 · 资讯内容区", () => {
  test("首次 502：只替换内容区，保留外壳，无端点泄漏，重试恢复", async ({ page }) => {
    await ANON(page)
    let calls = 0
    await page.route("**/api/news/list/page/vo", (route) => {
      calls += 1
      if (calls <= 2) return gateway(route)
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { records: [], total: 0, current: 1, size: 9, pages: 1 } }),
      })
    })
    await page.goto("/news")
    const section = page.locator(".iris-section-state")
    await expect(section).toContainText("资讯没能读出来")
    await expect(section).toContainText("需要处理")
    await expect(section).not.toContainText(/\/api\/|POST/)
    await expect(page.locator("header.product-head")).toBeVisible()
    await section.getByRole("button", { name: "重试" }).click()
    await expect(section).toHaveCount(0)
    expect(calls).toBe(3)
  })

  test("搜索切换后失败只影响当前查询键", async ({ page }) => {
    await ANON(page)
    await page.route("**/api/news/list/page/vo", (route) => {
      const body = route.request().postDataJSON?.() ?? {}
      if (body.title) return gateway(route)
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { records: [], total: 0, current: 1, size: 9, pages: 1 } }),
      })
    })
    await page.goto("/news")
    await expect(page.locator(".news-empty")).toBeVisible()
    await page.locator("#news-search").fill("不存在的标题")
    await page.locator('button:has-text("检索")').click()
    await expect(page.locator(".iris-section-state")).toBeVisible()
  })

  test("空态不是错误", async ({ page }) => {
    await ANON(page)
    await page.route("**/api/news/list/page/vo", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { records: [], total: 0, current: 1, size: 9, pages: 1 } }),
      }),
    )
    await page.goto("/news")
    await expect(page.locator(".news-empty")).toContainText("资讯库里还没有条目")
    await expect(page.locator(".iris-section-state")).toHaveCount(0)
  })

  test("缓存刷新失败保留列表内容并给非阻断提示", async ({ page }) => {
    await ANON(page)
    let calls = 0
    await page.route("**/api/news/list/page/vo", (route) => {
      calls += 1
      if (calls === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ code: 0, data: { records: [{ id: "cached-1", title: "缓存保留的资讯", author: "编辑部", publishTime: "2026-11-18 09:00:00", content: "<p>缓存正文</p>" }], total: 1, current: 1, size: 9, pages: 1 } }),
        })
      }
      return gateway(route)
    })
    await page.goto("/news")
    await expect(page.getByText("缓存保留的资讯")).toBeVisible()
    // 受控失效入口代替 30 秒 staleTime 等待：触发真实的后台 refetch，
    // 保留缓存内容，显示非阻断恢复提示。钩子只在 VITE_E2E_REFRESH_HOOK=1 时挂载。
    await page.evaluate(() => (window as unknown as { __irisRefetch: () => void }).__irisRefetch())
    await expect(page.locator(".iris-refresh-notice")).toBeVisible()
    await expect(page.getByText("缓存保留的资讯")).toBeVisible()
  })

  test("详情首次 502 走内容区状态，不占整页", async ({ page }) => {
    await ANON(page)
    await page.route("**/api/news/get/**", (route) => gateway(route))
    await page.goto("/news/synthetic-id")
    await expect(page.locator(".iris-section-state")).toContainText("这条资讯没能读出来")
    await expect(page.locator("header.product-head")).toBeVisible()
  })
})
