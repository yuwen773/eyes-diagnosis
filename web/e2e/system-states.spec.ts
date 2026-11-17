import { expect, test } from "@playwright/test"

/**
 * Iris System States 的浏览器契约：404 / 网络错误 + 恢复动作 / 渲染错误兜底。
 *
 * 这些用例不需要后端账号：业务请求用 page.route 拦截成真实 HTTP 错误，
 * 渲染错误用拦截 lazy chunk 的方式注入。它们验证的是状态呈现与恢复语义，
 * 不冒充真实后端数据或临床推理。
 */

test.describe("Iris System States", () => {
  test("404：未知地址给出明确语义、共享顶栏与 replace 回首页", async ({ page }) => {
    let requests = 0
    await page.route("**/api/**", (route) => {
      requests += 1
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: null }),
      })
    })

    await page.goto("/this-route-does-not-exist")
    await expect(page.getByRole("heading", { name: /这个地址不在 Iris 里/ })).toBeVisible()
    await expect(page.locator("header.product-head")).toBeVisible()

    const home = page.getByRole("link", { name: /回到首页/ })
    await expect(home).toBeVisible()
    // react-router 的 replace 链接最终落到首页；错误地址不会出现在历史里。
    await home.click()
    await expect(page).toHaveURL(/\/$/)
    await page.goBack()
    await expect(page).not.toHaveURL(/this-route-does-not-exist/)
    expect(requests).toBeGreaterThan(0)
  })

  test("网络错误：状态面板给出故障读数、严重度文字标签与一次明确重试", async ({ page }) => {
    let listCalls = 0
    await page.route("**/api/user/get/login", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: null }),
      }),
    )
    await page.route("**/api/news/list/page/vo", (route) => {
      listCalls += 1
      // 前两次都失败：第一次是初次请求，第二次是 QueryClient 对 5xx 的
      // 一次自动重试（queryClient.ts 的 retry 规则）。第三次才是用户点
      // 「重试」触发的 refetch——必须真的重新发起请求并恢复业务内容。
      if (listCalls <= 2) {
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ code: 502, msg: "bad gateway" }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: 0,
          data: { records: [], total: 0, current: 1, size: 9, pages: 1 },
        }),
      })
    })

    await page.goto("/news")
    const panel = page.locator(".iris-error")
    await expect(panel).toBeVisible()
    await expect(panel.getByText("需要处理")).toBeVisible()
    await expect(panel.getByText("502")).toBeVisible()
    await expect(panel.getByText("POST /news/list/page/vo")).toBeVisible()

    const retry = panel.getByRole("button", { name: "重试" })
    await expect(retry).toBeVisible()
    await retry.click()
    await expect(panel).toBeHidden()
    // 1 初次 + 1 自动重试 + 1 用户重试；自动重试的结果没有冒充用户恢复。
    expect(listCalls).toBe(3)
  })

  test("渲染错误：ErrorBoundary 显示双出口，不泄漏堆栈或「已记录」", async ({ page }) => {
    await page.route("**/src/pages/NewsPage.tsx*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `export function NewsPage(){ throw new Error('synthetic render failure') }`,
      }),
    )

    await page.goto("/news")
    const fallback = page.locator(".iris-error")
    await expect(fallback).toBeVisible()
    await expect(fallback.getByText("这个页面没能显示出来")).toBeVisible()
    await expect(fallback.getByRole("button", { name: /重新加载本页/ })).toBeVisible()
    await expect(fallback.getByRole("link", { name: /回到首页/ })).toHaveAttribute("href", "/")
    const text = (await fallback.innerText()) ?? ""
    expect(text).not.toContain("synthetic render failure")
    expect(text).not.toMatch(/已经记录|已记录/)
  })
})
