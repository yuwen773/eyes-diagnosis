// Iris Roundtable 最终集成 · E-09 Fusion 接入真实首页的浏览器复验
//
// 用法：
//   1. cd web && npm run build            # 生产构建（不含 /design/hero-compare）
//   2. npx vite preview --port 4183 --strictPort
//   3. node web/scripts/evidence/hero-landing.mjs
//
// 验的是**真正的 `/` 首页**，不是设计预览路由。产出：
//   docs/reviews/assets/iris-roundtable-final-integration/landing-{viewport}-{theme}.png（入库）
//   target/iris-roundtable-final-integration/landing-report.json（全量读数）
//
// 判据（2026-11-18 产品已批准 Fusion R2-b，故此脚本只验接入是否成立，不重做 A/B/C 对比）：
//   - 主视觉根节点存在且 `data-mode` 在 5 秒窗口后进入 `settled`；
//   - 定格后 2 秒内 WebGL draw 次数为 0（真停，不是只改属性）；
//   - 无横向溢出；
//   - 顶栏 / 标题 / 双 CTA / 信息卡 / 入口卡都在；
//   - 没有失败的静态资源请求。
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"

const ROOT = resolve(import.meta.dirname, "../../..")
const BASE = process.env.HERO_LANDING_BASE ?? "http://localhost:4183"
const DOC_DIR = resolve(ROOT, "docs/reviews/assets/iris-roundtable-final-integration")
const TARGET_DIR = resolve(ROOT, "target/iris-roundtable-final-integration")
const CHROME =
  process.env.E2E_CHROMIUM_PATH ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"

mkdirSync(DOC_DIR, { recursive: true })
mkdirSync(TARGET_DIR, { recursive: true })

const browserPath = existsSync(CHROME) ? CHROME : (() => {
  try {
    return chromium.executablePath()
  } catch {
    return "playwright-default"
  }
})()

const VIEWPORTS = [
  { key: "390", width: 390, height: 844 },
  { key: "820", width: 820, height: 1180 },
  { key: "1440", width: 1440, height: 900 },
  { key: "1920", width: 1920, height: 1080 },
]
const THEMES = ["light", "dark"]

const browser = await chromium.launch({ headless: false, executablePath: browserPath })
const report = { base: BASE, when: new Date().toISOString(), viewports: [] }

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    // 主题走 ThemeProvider 的 localStorage 键；draw 计数在页面脚本之前挂上。
    await context.addInitScript((wanted) => {
      try {
        localStorage.setItem("theme", wanted)
      } catch {
        /* 存储被禁用时忽略：页面会退回系统主题 */
      }
      window.__heroDraws = 0
      const proto = window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype
      if (!proto) return
      for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const original = proto[name]
        if (typeof original !== "function") continue
        proto[name] = function (...args) {
          window.__heroDraws += 1
          return original.apply(this, args)
        }
      }
    }, theme)

    const page = await context.newPage()
    const failedRequests = []
    page.on("requestfailed", (request) => {
      // 首页不依赖后端；这里只关心静态资源（脚本 / 样式 / 字体 / 图片）。
      if (/\.(js|css|woff2?|png|jpe?g|webp|svg)(\?|$)/i.test(request.url())) {
        failedRequests.push(request.url())
      }
    })
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" })

    const hero = page.locator(".hero-fusion")
    await hero.waitFor({ state: "attached", timeout: 15000 })

    // 5 秒窗口 + 余量；只读 data-mode，不假设定时器精度。
    await page.waitForFunction(
      () => document.querySelector(".hero-fusion")?.getAttribute("data-mode") === "settled",
      undefined,
      { timeout: 15000 },
    )
    const settledAt = Date.now()
    const drawsAtSettle = await page.evaluate(() => window.__heroDraws ?? -1)
    await page.waitForTimeout(2000)
    const drawsAfterSettle = await page.evaluate(() => window.__heroDraws ?? -1)

    const facts = await page.evaluate(() => {
      const heroEl = document.querySelector(".hero-fusion")
      const canvas = document.querySelector(".hero-fusion__canvas")
      const optics = document.querySelector(".hero-fusion__optics")
      const cta = Array.from(document.querySelectorAll(".landing-hero__cta a")).map((a) =>
        (a.textContent ?? "").trim(),
      )
      return {
        mode: heroEl?.getAttribute("data-mode") ?? null,
        theme: heroEl?.getAttribute("data-theme") ?? null,
        breakpoint: heroEl?.getAttribute("data-breakpoint") ?? null,
        hasCanvas: Boolean(canvas),
        hasOpticsSvg: Boolean(optics),
        htmlThemeClass: document.documentElement.classList.contains("dark") ? "dark" : "light",
        title: document.querySelector(".landing-hero__title")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        cta,
        hasCard: Boolean(document.querySelector(".landing-hero__card")),
        entryCount: document.querySelectorAll(".landing-hero__entry").length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    const file = `landing-${viewport.key}-${theme}.png`
    await page.screenshot({ path: resolve(DOC_DIR, file), fullPage: false })

    report.viewports.push({
      viewport: viewport.key,
      theme,
      file,
      settledAtMs: settledAt,
      drawsAtSettle,
      drawsAfterSettle,
      drawsDuringSettleWindow: drawsAfterSettle - drawsAtSettle,
      failedRequests,
      ...facts,
    })
    console.log(
      `${viewport.key} ${theme} · mode=${facts.mode} canvas=${facts.hasCanvas} svg=${facts.hasOpticsSvg} ` +
        `draws(after settle)=${drawsAfterSettle - drawsAtSettle} overflowX=${facts.overflowX} ` +
        `cta=${facts.cta.length} entries=${facts.entryCount} failed=${failedRequests.length}`,
    )
    await context.close()
  }
}

await browser.close()
writeFileSync(resolve(TARGET_DIR, "landing-report.json"), JSON.stringify(report, null, 2), "utf8")
writeFileSync(
  resolve(DOC_DIR, "landing-report-summary.json"),
  JSON.stringify(
    {
      when: report.when,
      base: report.base,
      viewports: report.viewports.map((v) => ({
        viewport: v.viewport,
        theme: v.theme,
        mode: v.mode,
        breakpoint: v.breakpoint,
        drawsDuringSettleWindow: v.drawsDuringSettleWindow,
        overflowX: v.overflowX,
        failedRequests: v.failedRequests.length,
      })),
    },
    null,
    2,
  ),
  "utf8",
)
console.log("report written")
