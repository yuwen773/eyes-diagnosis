import { test, expect, type Page } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Iris 2.1 UI 冻结回归扫描（R1 §7）。
 *
 * <p>目的只有一个：确认多 Agent 集成没有改动冻结 UI 的版式、令牌与主题。
 * 它**不**验证业务正确性——所有 /api 响应都是合成的固定夹具，因此这里既不能
 * 当作端到端通过，也不能当作数据口径证据。
 *
 * <p>每页在 390 / 768 / 820 / 900 / 1440 / 1920 六个宽度、Light / Dark 两个主题下：
 * 1) 断言没有横向溢出（版式回归最容易出在这里）；
 * 2) 断言 html 的主题类与所选主题一致（令牌翻转没被破坏）；
 * 3) 断言没有未捕获异常（集成改动引入的运行时错误）。
 * 390 / 900 / 1440 三个代表宽度额外留截图，便于人工比对。
 */

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/agent", name: "agent" },
  { path: "/diagnosis", name: "diagnosis" },
  { path: "/news", name: "news" },
  { path: "/profile", name: "profile" },
  { path: "/records", name: "records" },
  { path: "/admin/dashboard", name: "admin-dashboard" },
  { path: "/admin/users", name: "admin-users" },
  { path: "/admin/news", name: "admin-news" },
  { path: "/admin/diagnosis", name: "admin-diagnosis" },
  { path: "/admin/knowledge", name: "admin-knowledge" },
  { path: "/admin/data-analysis", name: "admin-data-analysis" },
]

const WIDTHS = [390, 768, 820, 900, 1440, 1920]
const THEMES = ["light", "dark"] as const
const SHOT_WIDTHS = new Set([390, 900, 1440])
// Playwright 以 web/ 为工作目录运行，截图落在仓库根的 target/（已 gitignore）。
const SHOT_DIR = resolve(process.cwd(), "../target/ui-freeze")

const USER = {
  id: "1",
  userAccount: "freeze-reviewer",
  userName: "冻结回归",
  userRole: "admin",
  userAvatar: "",
  userProfile: "",
  createTime: "2026-01-01 00:00:00",
}

const NEWS = [1, 2, 3].map((n) => ({
  id: String(n),
  title: `冻结回归样片 ${n}`,
  author: "Iris",
  content: "<p>合成正文，仅用于版式回归。</p>",
  summary: "合成正文，仅用于版式回归。",
  coverImage: "",
  publishTime: `2026-11-0${n} 09:00:00`,
}))

function envelope(data: unknown) {
  return { code: 0, data, msg: "" }
}

/** 固定夹具：够渲染出真实的信息密度，但不代表任何业务口径。 */
function fixture(path: string, method: string): unknown {
  if (path.includes("/user/get/login")) return envelope(USER)
  if (path.includes("/diagnosis/list/page/my"))
    return envelope({ records: [], total: 0, size: 10, current: 1, pages: 0 })
  if (path.includes("/diagnosis/stats/my"))
    return envelope({ total: 0, highRisk: 0, awaitingReview: 0, lastReadAt: null })
  if (path.includes("/news/list/page/vo"))
    return envelope({ records: NEWS, total: NEWS.length, size: 9, current: 1, pages: 1 })
  if (path.includes("/agent/sessions")) return envelope([])
  if (path.includes("/agent/history")) return envelope({ messages: [], hasMore: false, nextCursor: null })
  if (path.includes("/admin")) return envelope({ records: [], total: 0, size: 10, current: 1, pages: 0 })
  if (method === "GET") return envelope(null)
  return envelope(true)
}

async function stubApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture(path, request.method())),
    })
  })
}

for (const theme of THEMES) {
  test(`冻结 UI 版式扫描 · ${theme}`, async ({ page }) => {
    test.setTimeout(600_000)
    mkdirSync(SHOT_DIR, { recursive: true })
    await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(`${page.url()} :: ${error.message}`))
    await stubApi(page)

    for (const route of ROUTES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(route.path, { waitUntil: "domcontentloaded" })
        await page.waitForTimeout(400)

        const state = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          dark: document.documentElement.classList.contains("dark"),
        }))
        expect(state.overflow, `${route.path} @${width}px 出现横向溢出`).toBeLessThanOrEqual(1)
        expect(state.dark, `${route.path} @${width}px 主题类与所选主题不符`).toBe(theme === "dark")

        if (SHOT_WIDTHS.has(width))
          await page.screenshot({
            path: resolve(SHOT_DIR, `${route.name}-${theme}-${width}.png`),
            fullPage: true,
          })
      }
    }

    expect(errors, `未捕获异常：${errors.join(" | ")}`).toEqual([])
  })
}
