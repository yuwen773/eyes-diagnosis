/**
 * R2.5 全站验收 · 跨路由连续性 + 键盘 / 主题 / 抽屉回归（可复跑）
 *
 * 用法（先在 web/ 下起 vite，再另开一个终端）：
 *
 *   EVIDENCE_USER=<测试账号> EVIDENCE_PASS=<密码> \
 *   node scripts/evidence/r25-accept-crossroute.mjs
 *
 * 可选：EVIDENCE_BASE（默认 http://localhost:5175）、
 *       EVIDENCE_OUT（默认 .shots/r25-accept-crossroute）、
 *       EVIDENCE_CHROME（默认本机 Playwright Chromium 路径）。
 *
 * 这份脚本对应审计文档 §6.4 验收门禁的 3/4/5/6 条与 §6.5 跨路由连续性表：
 *   - 真实路由跳转：/ → /diagnosis → /agent → /news → /profile → /records；
 *   - 同一顶栏：导航目的地、当前态、Logo 尺寸跨路由一致；
 *   - 主题：切换不丢路由、无 console error；
 *   - 键盘：Tab 焦点可见、移动抽屉焦点锁 + Esc 归还焦点；
 *   - 窄屏无横向滚动。
 *
 * 断言失败会以非零码退出，并把失败项写进 report.json。
 * 账号请用临时账号，采完删除；本脚本不保存任何凭据。
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.EVIDENCE_BASE ?? "http://localhost:5175"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), ".shots", "r25-accept-crossroute")
const CHROME =
  process.env.EVIDENCE_CHROME ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const USER = process.env.EVIDENCE_USER
const PASS = process.env.EVIDENCE_PASS

if (!USER || !PASS) {
  console.error("缺少 EVIDENCE_USER / EVIDENCE_PASS（用临时账号，采完删除）")
  process.exit(1)
}

/** 走一遍这条路线，顺序与审计 §6.5 一致。 */
const ROUTE_SEQUENCE = [
  { path: "/", name: "home" },
  { path: "/diagnosis", name: "diagnosis" },
  { path: "/agent", name: "agent" },
  { path: "/news", name: "news" },
  { path: "/profile", name: "profile" },
  { path: "/records", name: "records" },
]

/** 顶栏目的地必须始终是这三个，且短码不变（§6.5「导航结构」）。 */
const EXPECT_NAV = [
  { code: "01", label: "判读" },
  { code: "02", label: "诊断 Agent" },
  { code: "03", label: "新闻资讯" },
]

mkdirSync(OUT, { recursive: true })
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

const errors = []
const failures = []
const report = []

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})

async function newPage(theme, width) {
  const context = await browser.newContext({
    viewport: {
      width,
      height: width <= 430 ? 844 : width <= 820 ? 1024 : width >= 1920 ? 1080 : 900,
    },
    deviceScaleFactor: 1,
  })
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme)
  const response = await context.request.post(`${BASE}/api/user/login`, {
    data: { userAccount: USER, userPassword: PASS },
  })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  const page = await context.newPage()
  const tag = `${theme}/${width}`
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`))
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`))
  return { context, page }
}

async function shot(page, name, options = {}) {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 80, ...options })
}

function check(condition, message) {
  if (!condition) failures.push(message)
  return condition
}

/** 从页面上读出顶栏的结构事实（§6.5 表的前六行）。 */
async function readHeader(page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".product-head__nav")
    const links = nav
      ? Array.from(nav.querySelectorAll(".product-head__link")).map((el) => ({
          code: el.querySelector(".product-head__code")?.textContent?.trim() ?? "",
          label: (el.textContent ?? "").replace(el.querySelector(".product-head__code")?.textContent ?? "", "").trim(),
          current: el.getAttribute("aria-current"),
        }))
      : []
    const brand = document.querySelector(".product-head__brand")
    const brandBox = brand?.getBoundingClientRect()
    // 金属虹膜标两版都在 DOM 里（浅色底挂 light 版，深色底挂 dark 版），
    // 隐藏的那版 display:none，取有尺寸的那一个。
    const marks = Array.from(
      document.querySelectorAll(".product-head__brand img, .product-head__brand svg"),
    )
    const mark = marks.find((el) => {
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    })
    const markBox = mark?.getBoundingClientRect()
    const head = document.querySelector("[data-product-head]")
    return {
      scene: head?.getAttribute("data-scene") ?? null,
      links,
      currentCount: links.filter((l) => l.current === "page").length,
      brandBox: brandBox ? { w: Math.round(brandBox.width), h: Math.round(brandBox.height) } : null,
      markBox: markBox ? { w: Math.round(markBox.width), h: Math.round(markBox.height) } : null,
      hasHeader: Boolean(head),
      fontFamily: nav ? getComputedStyle(nav).fontFamily : null,
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      pathname: location.pathname,
    }
  })
}

// ── 主循环：每套主题 × 每个断点走一遍整条路线 ────────────────────────────

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1440, 1920]) {
    const { context, page } = await newPage(theme, width)
    const seen = []

    for (const route of ROUTE_SEQUENCE) {
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" })
      await settle(900)
      const header = await readHeader(page)
      seen.push(header)

      check(header.hasHeader, `${theme}/${width}${route.path}: 没有顶栏`)
      check(
        header.links.length === EXPECT_NAV.length,
        `${theme}/${width}${route.path}: 导航目的地 ${header.links.length} 个，应为 ${EXPECT_NAV.length} 个`,
      )
      check(
        header.links.every((l, i) => l.code === EXPECT_NAV[i].code && l.label === EXPECT_NAV[i].label),
        `${theme}/${width}${route.path}: 导航结构与短码不一致：${JSON.stringify(header.links)}`,
      )
      check(
        header.currentCount <= 1,
        `${theme}/${width}${route.path}: aria-current="page" 出现 ${header.currentCount} 次，应至多 1 次`,
      )
      check(
        !header.hScroll,
        `${theme}/${width}${route.path}: 出现横向滚动`,
      )
      check(
        header.markBox && header.markBox.w > 0 && header.markBox.h > 0,
        `${theme}/${width}${route.path}: 品牌标记没有尺寸`,
      )

      await shot(page, `${theme}-${route.name}-${width}`)
    }

    // 跨路由一致性：Logo 尺寸、导航字体在同一条路线上必须一致。
    const marks = seen.map((h) => JSON.stringify(h.markBox))
    check(
      new Set(marks).size === 1,
      `${theme}/${width}: 品牌标记尺寸跨路由不一致：${marks.join(" / ")}`,
    )
    const fonts = new Set(seen.map((h) => h.fontFamily))
    check(fonts.size === 1, `${theme}/${width}: 导航字体跨路由不一致：${[...fonts].join(" / ")}`)

    report.push({ theme, width, routes: seen.map((h) => h.pathname), ok: failures.length === 0 })
    await context.close()
  }
}

// ── 主题切换：换主题不丢路由、无 console error ────────────────────────────

for (const width of [390, 1440]) {
  const { context, page } = await newPage("light", width)
  await page.goto(`${BASE}/news`, { waitUntil: "networkidle" })
  await settle(800)
  const before = await page.evaluate(() => ({
    path: location.pathname,
    dark: document.documentElement.classList.contains("dark"),
  }))
  await page.locator(".theme-toggle").click()
  await settle(700)
  const after = await page.evaluate(() => ({
    path: location.pathname,
    dark: document.documentElement.classList.contains("dark"),
    stored: localStorage.getItem("theme"),
  }))
  check(after.path === before.path, `${width}: 主题切换后丢了路由（${before.path} → ${after.path}）`)
  check(after.dark !== before.dark, `${width}: 主题切换后 html.dark 没有翻转`)
  await shot(page, `theme-toggle-${width}-after`)
  report.push({ view: "theme-toggle", width, before, after })
  await context.close()
}

// ── 键盘：Tab 焦点可见；移动抽屉焦点锁 + Esc 归还焦点 ─────────────────────

{
  const { context, page } = await newPage("light", 1440)
  await page.goto(`${BASE}/news`, { waitUntil: "networkidle" })
  await settle(800)
  await page.evaluate(() => document.body.focus())
  const stops = []
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab")
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return {
        tag: el.tagName,
        name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
        outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
        shadow: style.boxShadow !== "none",
        visible: box.width > 0 && box.height > 0,
      }
    })
    if (info) stops.push(info)
  }
  check(stops.length > 0, "1440: Tab 没有落到任何可聚焦元素")
  check(
    stops.every((s) => s.visible),
    `1440: Tab 焦点有不可见元素：${JSON.stringify(stops.filter((s) => !s.visible))}`,
  )
  const hasIndicator = stops.filter((s) => s.outline || s.shadow).length
  check(
    hasIndicator >= Math.ceil(stops.length / 2),
    `1440: ${stops.length} 个焦点停靠里只有 ${hasIndicator} 个带可见焦点指示`,
  )
  await shot(page, "keyboard-focus-1440")
  report.push({ view: "keyboard", width: 1440, stops })
  await context.close()
}

{
  const { context, page } = await newPage("light", 390)
  await page.goto(`${BASE}/news`, { waitUntil: "networkidle" })
  await settle(800)
  await page.locator(".burger").click()
  await settle(600)
  const inDrawer = await page.evaluate(() => {
    const panel = document.querySelector("#mobile-nav")
    const active = document.activeElement
    return {
      open: document.querySelector(".burger")?.getAttribute("aria-expanded"),
      bodyLocked: document.body.style.overflow === "hidden",
      focusInside: Boolean(panel && active && panel.contains(active)),
      drawerLinks: panel ? panel.querySelectorAll("a").length : 0,
    }
  })
  check(inDrawer.open === "true", "390: 抽屉打开后 aria-expanded 不是 true")
  check(inDrawer.bodyLocked, "390: 抽屉打开后 body 没有锁滚动")
  check(inDrawer.focusInside, "390: 抽屉打开后焦点没有落在抽屉里")
  await shot(page, "keyboard-drawer-390-open")

  await page.keyboard.press("Escape")
  await settle(600)
  const closed = await page.evaluate(() => ({
    open: document.querySelector(".burger")?.getAttribute("aria-expanded"),
    bodyLocked: document.body.style.overflow === "hidden",
    focusOnBurger: document.activeElement?.classList.contains("burger"),
  }))
  check(closed.open === "false", "390: Esc 之后抽屉没有关闭")
  check(!closed.bodyLocked, "390: Esc 之后 body 滚动锁没解除")
  check(closed.focusOnBurger, "390: Esc 之后焦点没有归还给汉堡按钮")
  await shot(page, "keyboard-drawer-390-closed")
  report.push({ view: "drawer", width: 390, inDrawer, closed })
  await context.close()
}

await browser.close()

writeFileSync(
  join(OUT, "report.json"),
  JSON.stringify({ errors, failures, report }, null, 2),
)
console.log(JSON.stringify({ errors, failures, report }, null, 2))
if (errors.length || failures.length) process.exitCode = 1
