// Visual Completion 视觉验收截图采集
// 用法：EVIDENCE_USER=... EVIDENCE_PASS=... node web/scripts/evidence/visual-completion.mjs
// 产出：web/.shots-visual/*.png（gitignored）
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const BASE = process.env.SHOT_BASE ?? "http://localhost:5176"
const OUT = resolve(import.meta.dirname, "../../.shots-visual")
const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const USER = process.env.EVIDENCE_USER
const PASS = process.env.EVIDENCE_PASS

mkdirSync(OUT, { recursive: true })

const PAGES = [
  { name: "landing", path: "/", full: false, scroll: true },
  { name: "landing-full", path: "/", full: true },
  { name: "news", path: "/news" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "diagnosis", path: "/diagnosis", auth: true },
  { name: "agent", path: "/agent", auth: true },
  { name: "profile", path: "/profile", auth: true },
  { name: "records", path: "/records", auth: true },
  { name: "admin-dashboard", path: "/admin/dashboard", auth: true, admin: true },
  { name: "admin-users", path: "/admin/users", auth: true, admin: true },
  { name: "admin-news", path: "/admin/news", auth: true, admin: true },
  { name: "admin-diagnosis", path: "/admin/diagnosis", auth: true, admin: true },
  { name: "admin-knowledge", path: "/admin/knowledge", auth: true, admin: true },
  { name: "admin-data-analysis", path: "/admin/data-analysis", auth: true, admin: true },
  { name: "admin-news-edit", path: "/admin/news/1/edit", auth: true, admin: true },
]

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
]

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark")
    localStorage.setItem("theme", t)
  }, theme)
}

// networkidle 会被 vite HMR websocket 卡住，一律用 load + 固定 settle。
const nav = async (page, url) => {
  await page.goto(url, { waitUntil: "load", timeout: 30000 })
  await page.waitForTimeout(1200)
}

async function login(page, admin) {
  await nav(page, `${BASE}/login`)
  await page.fill('#account', USER)
  await page.fill('#password', PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 })
  await page.waitForTimeout(1000)
  if (admin) {
    await nav(page, `${BASE}/admin/dashboard`)
  }
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-angle=swiftshader"] })

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()

  for (const theme of ["light", "dark"]) {
    // 公开页（未登录）
    await nav(page, `${BASE}/`)
    await setTheme(page, theme)

    for (const spec of PAGES.filter((p) => !p.auth)) {
      await nav(page, `${BASE}${spec.path}`)
      await setTheme(page, theme)
      if (spec.scroll) {
        // 逐屏滚动到底再回顶，触发懒渲染
        await page.evaluate(async () => {
          const h = document.body.scrollHeight
          for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)) }
          window.scrollTo(0, 0)
        })
        await page.waitForTimeout(500)
      }
      await page.screenshot({ path: `${OUT}/${spec.name}-${vp.tag}-${theme}.png`, fullPage: spec.full ?? false })
      console.log(`shot ${spec.name}-${vp.tag}-${theme}`)
    }

    // 登录后的用户页 + 管理页（同一会话）
    if (USER && PASS) {
      await login(page, false)
      for (const spec of PAGES.filter((p) => p.auth && !p.admin)) {
        await nav(page, `${BASE}${spec.path}`)
        await setTheme(page, theme)
        await page.screenshot({ path: `${OUT}/${spec.name}-${vp.tag}-${theme}.png`, fullPage: false })
        console.log(`shot ${spec.name}-${vp.tag}-${theme}`)
      }
      await login(page, true)
      for (const spec of PAGES.filter((p) => p.admin)) {
        await nav(page, `${BASE}${spec.path}`)
        await setTheme(page, theme)
        await page.screenshot({ path: `${OUT}/${spec.name}-${vp.tag}-${theme}.png`, fullPage: false })
        console.log(`shot ${spec.name}-${vp.tag}-${theme}`)
      }
    }
  }
  await ctx.close()
}

await browser.close()
console.log(`done -> ${OUT}`)
