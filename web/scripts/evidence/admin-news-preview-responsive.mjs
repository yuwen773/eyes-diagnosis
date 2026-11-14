// 管理端资讯预览的响应式证据（PR #77 合并前）。
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-news-preview-responsive.mjs <输出目录>
// 凭据只走环境变量；截图来自真实运行的前后端与数据库，只读，不改库。
//
// 这一轮要证明三件事：
//   1) 逻辑宽度固定（桌面 1240 / 手机 390），画布窄了只是等比缩小，版式不重排；
//   2) 真实窄屏浏览器里，预览拿到整屏宽度——不再是被卡片挤成 250px 的窄条；
//   3) 两种主题下都成立，且没有横向滚动条。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5192"
const outDir = process.argv[2] ?? "/tmp/news-responsive"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
const newsId = process.env.NEWS_ID ?? "13"
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const errors = []

  const setDarkTheme = async (page) => {
    await page.evaluate(() => {
      try {
        localStorage.setItem("theme", "dark")
      } catch {
        /* 无痕模式：忽略，断言会拦住 */
      }
    })
    await page.reload({ waitUntil: "networkidle" })
    await page.waitForTimeout(400)
  }

  const login = async (page, theme) => {
    await page.goto(base + "/login", { waitUntil: "networkidle" })
    await page.getByPlaceholder("useraccount").fill(user)
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole("button", { name: "登录" }).click()
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await page.waitForTimeout(700)
    if (theme === "dark") await setDarkTheme(page)
  }

  const openPreview = async (page) => {
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 240)))
    await page.goto(`${base}/admin/news/${newsId}/edit`, { waitUntil: "networkidle" })
    await page.getByRole("tab", { name: "预览" }).click()
    await page.waitForTimeout(800)
  }

  /** 量出画布、设备框与版式的真实尺寸——证据不能只有截图。 */
  const measure = async (page) =>
    page.evaluate(() => {
      const stage = document.querySelector(".admin-newsedit__preview-stage")
      const device = document.querySelector(".admin-newsedit__device")
      const paper = document.querySelector(".news-paper")
      const viewport = document.querySelector(".admin-newsedit__preview-viewport")
      const style = device ? getComputedStyle(device) : null
      return {
        视口宽度: document.documentElement.clientWidth,
        页面横向溢出: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        画布宽度: stage ? Math.round(stage.getBoundingClientRect().width) : null,
        画布左缘: stage ? Math.round(stage.getBoundingClientRect().left) : null,
        逻辑宽度: style ? style.getPropertyValue("--news-preview-logical-width").trim() : null,
        缩放系数: style ? style.getPropertyValue("--news-preview-scale").trim() : null,
        设备框呈现宽度: device ? Math.round(device.getBoundingClientRect().width) : null,
        正文列宽: paper ? Math.round(paper.getBoundingClientRect().width) : null,
        预览条读数: viewport ? viewport.textContent : null,
      }
    })

  const shot = async (page, name) => {
    if (name.endsWith("-dark")) {
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      )
      if (!isDark) throw new Error(`${name} 截图前发现主题不是暗色：html.dark 不存在`)
    }
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true })
    console.log("captured", name)
  }

  const cases = [
    // 只补主套件没有的几组：真实窄屏浏览器（整屏预览）与平板宽度的手机档。
    // 命名沿用主套件的口径：preview-<设备档>-<浏览器宽度>-<主题>。
    { w: 390, h: 844, device: "手机", theme: "light", tag: "preview-mobile-390-light" },
    { w: 390, h: 844, device: "手机", theme: "dark", tag: "preview-mobile-390-dark" },
    { w: 768, h: 1024, device: "手机", theme: "light", tag: "preview-mobile-768-light" },
  ]

  for (const item of cases) {
    const ctx = await browser.newContext({ viewport: { width: item.w, height: item.h } })
    const page = await ctx.newPage()
    await login(page, item.theme)
    await openPreview(page)
    if (item.device === "手机") {
      await page.getByRole("button", { name: "手机" }).click()
      await page.waitForTimeout(500)
    }
    const m = await measure(page)
    console.log(item.tag, JSON.stringify(m))
    await shot(page, item.tag)
    await ctx.close()
  }

  await browser.close()
  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"))
    process.exit(2)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
