// Iris 2.1 管理端工作台 · 证据采集
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-workspace.mjs <输出目录> [阶段]
// 阶段：before（改造前基线）/ after（改造后）
// 产出：仪表盘多档位双主题 + 外壳局部 + 其余管理页回归截图。
// 凭据只走环境变量；截图数据来自本机数据库，未手工填充。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5173"
const outDir = process.argv[2] ?? "/tmp/shots"
const stage = process.argv[3] ?? "after"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

const PAGES = [
  ["dashboard", "/admin/dashboard"],
  ["users", "/admin/users"],
  ["news", "/admin/news"],
  ["diagnosis", "/admin/diagnosis"],
  ["knowledge", "/admin/knowledge"],
  ["data-analysis", "/admin/data-analysis"],
  ["news-edit", "/admin/news/new/edit"],
]

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })

  const newPage = async (theme, width, height) => {
    const context = await browser.newContext({ viewport: { width, height } })
    // 主题直接写 localStorage：应用启动即读，避免先登浅色再切深色带来的
    // 过渡态与首屏闪烁（截图要的是稳定态）。
    await context.addInitScript((value) => {
      window.localStorage.setItem("theme", value)
    }, theme)
    const page = await context.newPage()
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)))
    return { context, page }
  }

  const login = async (page) => {
    await page.goto(base + "/login", { waitUntil: "networkidle" })
    await page.getByPlaceholder("useraccount").fill(user)
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole("button", { name: "登录" }).click()
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await page.waitForTimeout(900)
  }

  const settle = async (page) => {
    // 等真实读数落地：仪表盘读数轨出现即说明统计接口已回。
    await page
      .waitForSelector(".admin-metric-strip, .admin-pagehead", { timeout: 15000 })
      .catch(() => {})
    await page.waitForTimeout(1200)
  }

  const shot = async (page, name, opts = {}) => {
    const { fullPage = true, clip } = opts
    await page.screenshot({
      path: `${outDir}/${name}.png`,
      fullPage: fullPage && !clip,
      clip,
      timeout: 90000,
      animations: "disabled",
    })
    console.log("captured", name)
  }

  /* ── 仪表盘：多档位 × 双主题 ─────────────────────────────── */

  for (const [theme, suffix] of [
    ["light", "light"],
    ["dark", "dark"],
  ]) {
    const { context, page } = await newPage(theme, 1440, 900)
    await login(page)
    await page.goto(base + "/admin/dashboard", { waitUntil: "networkidle" })
    await settle(page)
    await shot(page, `dashboard-1440-${suffix}`)
    await shot(page, `dashboard-1440-${suffix}-viewport`, { fullPage: false })
    // 外壳局部：侧栏 + 工作区顶栏（1440 下侧栏宽 252，顶栏高 64）。
    await shot(page, `shell-1440-${suffix}`, {
      fullPage: false,
      clip: { x: 0, y: 0, width: 900, height: 520 },
    })
    await context.close()
  }

  for (const [theme, suffix] of [
    ["light", "light"],
    ["dark", "dark"],
  ]) {
    const { context, page } = await newPage(theme, 390, 844)
    await login(page)
    await page.goto(base + "/admin/dashboard", { waitUntil: "networkidle" })
    await settle(page)
    await shot(page, `dashboard-390-${suffix}`)
    // 窄屏导航抽屉（改造前没有这个入口，取不到就跳过）。
    const menu = page.locator(".admin-topbar__menu")
    if (await menu.count()) {
      await menu.click()
      await page.waitForTimeout(700)
      await shot(page, `nav-drawer-390-${suffix}`, { fullPage: false })
    }
    await context.close()
  }

  {
    const { context, page } = await newPage("light", 1280, 800)
    await login(page)
    await page.goto(base + "/admin/dashboard", { waitUntil: "networkidle" })
    await settle(page)
    await shot(page, "dashboard-1280")
    await context.close()
  }

  /* ── 其余管理页：共用外壳的回归抽查 ─────────────────────── */

  {
    const { context, page } = await newPage("light", 1440, 900)
    await login(page)
    for (const [name, path] of PAGES) {
      if (name === "dashboard") continue
      await page.goto(base + path, { waitUntil: "networkidle" })
      await page.waitForTimeout(1100)
      await shot(page, `page-${name}`)
    }
    await context.close()
  }

  /* ── 窄屏回归：两页台账 ─────────────────────────────────── */

  {
    const { context, page } = await newPage("light", 390, 844)
    await login(page)
    for (const [name, path] of [
      ["diagnosis", "/admin/diagnosis"],
      ["news", "/admin/news"],
    ]) {
      await page.goto(base + path, { waitUntil: "networkidle" })
      await page.waitForTimeout(1100)
      await shot(page, `w390-${name}`)
    }
    await context.close()
  }

  console.log("stage:", stage, "→", outDir)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
