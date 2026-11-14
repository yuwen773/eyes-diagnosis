// Iris 2.1 · R3.3 管理端六页视觉精修 · 证据采集
//
// 用法：
//   CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-pages-polish.mjs <输出目录> [阶段]
// 阶段：before（改造前基线）/ after（改造后）
//
// 产出：六个管理页 × {390, 768, 1440, 1920} × {light, dark} 的整页截图，
// 以及若干交互态局部截图（筛选展开、行菜单、批量条、对话框、预览模式、文档预览）。
//
// 凭据只走环境变量；截图数据来自本机数据库，未手工填充。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5173"
const outDir = process.argv[2] ?? "/tmp/shots"
const stage = process.argv[3] ?? "after"
// 可选第 4 个参数：只拍某几页（逗号分隔的 slug），便于单页迭代。
const only = process.argv[4] ? new Set(process.argv[4].split(",").map((s) => s.trim())) : null
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

/** 六页：slug → 路由。顺序即优先级（P0 → P5）。 */
const PAGES = [
  ["dashboard", "/admin/dashboard"],
  ["data-analysis", "/admin/data-analysis"],
  ["diagnosis", "/admin/diagnosis"],
  ["news", "/admin/news"],
  ["knowledge", "/admin/knowledge"],
  ["users", "/admin/users"],
  ["news-edit", "/admin/news/new/edit"],
]

/** 视口：宽 × 高。1920 用来查「内容被无限拉长」。 */
const VIEWPORTS = [
  [390, 844],
  [768, 1024],
  [1440, 900],
  [1920, 1080],
]

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })

  const newPage = async (theme, width, height) => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    })
    // 主题直接写 localStorage：应用启动即读，避免先登浅色再切深色带来的
    // 过渡态与首屏闪烁（截图要的是稳定态）。
    await context.addInitScript((value) => {
      window.localStorage.setItem("theme", value)
    }, theme)
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console] ${msg.text().slice(0, 300)}`)
    })
    return { context, page, errors }
  }

  const login = async (page) => {
    await page.goto(base + "/login", { waitUntil: "networkidle" })
    await page.getByPlaceholder("useraccount").fill(user)
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole("button", { name: "登录" }).click()
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await page.waitForTimeout(600)
  }

  /** 等真实读数落地：读数轨 / 表格头出现即说明接口已回。 */
  const settle = async (page) => {
    await page
      .waitForSelector(
        ".admin-metric-strip, .admin-pagehead, .admin-dt__head, .admin-viz, .admin-newsedit__workspace",
        { timeout: 20000 },
      )
      .catch(() => {})
    await page.waitForTimeout(1400)
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

  /* ── 六页 × 四档位 × 双主题 ──────────────────────────────── */

  for (const [slug, route] of PAGES) {
    if (only && !only.has(slug)) continue
    for (const [width, height] of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        const { context, page, errors } = await newPage(theme, width, height)
        try {
          await login(page)
          await page.goto(base + route, { waitUntil: "networkidle" })
          await settle(page)
          await shot(page, `${slug}-${width}-${theme}`)
          if (errors.length) {
            console.log(`  !! ${slug}-${width}-${theme} console errors:`)
            for (const e of errors.slice(0, 5)) console.log("     ", e)
          }
        } finally {
          await context.close()
        }
      }
    }
  }

  /* ── 交互态（1440，light / dark 各一份）──────────────────── */

  const wantInteraction = (slug) => !only || only.has(slug)

  for (const theme of ["light", "dark"]) {
    const { context, page } = await newPage(theme, 1440, 900)
    try {
      await login(page)

      // 数据分析：图 / 表 切换（读数表通道必须可见）
      if (wantInteraction("data-analysis")) {
        await page.goto(base + "/admin/data-analysis", { waitUntil: "networkidle" })
        await settle(page)
        const tableToggle = page.locator(".admin-viz__toggle-btn", { hasText: "表" }).first()
        if (await tableToggle.count()) {
          await tableToggle.click()
          await page.waitForTimeout(500)
          await shot(page, `x-data-analysis-readtable-1440-${theme}`)
        }
      }

      // 诊断管理：行操作菜单 + 详情抽屉
      if (wantInteraction("diagnosis")) {
        await page.goto(base + "/admin/diagnosis", { waitUntil: "networkidle" })
        await settle(page)
        const rowMenuBtn = page
          .locator(".admin-dt__row-actions .admin-iconbtn, .admin-dt__row-actions button")
          .first()
        if (await rowMenuBtn.count()) {
          await rowMenuBtn.click()
          await page.waitForTimeout(500)
          await shot(page, `x-diagnosis-rowmenu-1440-${theme}`, { fullPage: false })
          await page.keyboard.press("Escape")
          await page.waitForTimeout(400)
        }
        const detailBtn = page.getByRole("button", { name: /详情/ }).first()
        if (await detailBtn.count()) {
          await detailBtn.click()
          await page.waitForTimeout(1600)
          await shot(page, `x-diagnosis-drawer-1440-${theme}`, { fullPage: false })
          // 关闭按钮优先：Esc 在 Base UI Dialog 里可能被焦点层吃掉。
          const close = page.locator(".admin-drawer__close").first()
          if (await close.count()) await close.click()
          else await page.keyboard.press("Escape")
          await page.waitForTimeout(500)
        }
        // 批量条
        const pickAll = page.locator(".admin-dt__head .admin-dt__check").first()
        if (await pickAll.count()) {
          await pickAll.click()
          await page.waitForTimeout(600)
          await shot(page, `x-diagnosis-batch-1440-${theme}`, { fullPage: false })
          await page.keyboard.press("Escape")
        }
      }

      // 用户管理：新建对话框
      if (wantInteraction("users")) {
        await page.goto(base + "/admin/users", { waitUntil: "networkidle" })
        await settle(page)
        const createUser = page.getByRole("button", { name: /新建用户|新增用户/ }).first()
        if (await createUser.count()) {
          await createUser.click()
          await page.waitForTimeout(700)
          await shot(page, `x-users-create-1440-${theme}`, { fullPage: false })
          const close = page.locator(".admin-modal__close").first()
          if (await close.count()) await close.click()
          else await page.keyboard.press("Escape")
          await page.waitForTimeout(400)
        }
      }

      // 知识库：文档预览抽屉（原文 + RAG Chunk 两个独立区域）
      if (wantInteraction("knowledge")) {
        await page.goto(base + "/admin/knowledge", { waitUntil: "networkidle" })
        await settle(page)
        const preview = page.getByRole("button", { name: /预览/ }).first()
        if (await preview.count()) {
          await preview.click()
          await page.waitForTimeout(1800)
          await shot(page, `x-knowledge-preview-1440-${theme}`, { fullPage: false })
          const close = page.locator(".admin-drawer__close").first()
          if (await close.count()) await close.click()
          else await page.keyboard.press("Escape")
          await page.waitForTimeout(400)
        }
      }

      // 新闻编辑：预览模式
      if (wantInteraction("news-edit")) {
        await page.goto(base + "/admin/news/new/edit", { waitUntil: "networkidle" })
        await settle(page)
        const previewTab = page.getByRole("tab", { name: /预览/ }).first()
        if (await previewTab.count()) {
          await previewTab.click()
          await page.waitForTimeout(900)
          await shot(page, `x-newsedit-preview-1440-${theme}`)
        }
      }

      // 新闻管理：行菜单
      if (wantInteraction("news")) {
        await page.goto(base + "/admin/news", { waitUntil: "networkidle" })
        await settle(page)
        const rowMenuBtn = page
          .locator(".admin-dt__row-actions .admin-iconbtn, .admin-dt__row-actions button")
          .first()
        if (await rowMenuBtn.count()) {
          await rowMenuBtn.click()
          await page.waitForTimeout(500)
          await shot(page, `x-news-rowmenu-1440-${theme}`, { fullPage: false })
        }
      }
    } finally {
      await context.close()
    }
  }

  await browser.close()
  console.log(`\nstage=${stage} done → ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
