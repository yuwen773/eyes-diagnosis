// 管理端视觉改造 · 证据采集
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-redesign.mjs <输出目录>
// 产出：<输出目录>/{7 页浅色 1440, dark/7 页深色, w390|w768|w1280|w1920/7 页浅色}
// 凭据只走环境变量；截图数据来自本地数据库，未手工填充。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5182"
const outDir = process.argv[2] ?? "/tmp/shots"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

const ROUTES = [
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

  const login = async (page, theme) => {
    await page.goto(base + "/login", { waitUntil: "networkidle" })
    if (theme === "dark") {
      const t = page.locator(".theme-toggle").first()
      if (await t.count()) await t.click()
    }
    await page.getByPlaceholder("useraccount").fill(user)
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole("button", { name: "登录" }).click()
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15000 })
    await page.waitForTimeout(1000)
    if (theme === "dark") {
      const t = page.locator(".theme-toggle").first()
      if (await t.count()) await t.click()
      await page.waitForTimeout(400)
    }
  }

  const sweep = async (theme, width, height, sub) => {
    const page = await browser.newPage({ viewport: { width, height } })
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)))
    await login(page, theme)
    for (const [name, path] of ROUTES) {
      await page.goto(base + path, { waitUntil: "networkidle" })
      await page.waitForTimeout(900)
      await page.screenshot({ path: `${outDir}/${sub}/${name}.png`, fullPage: true })
      console.log("captured", sub, name)
    }
    await page.close()
  }

  await sweep("light", 1440, 900, ".")
  await sweep("dark", 1440, 900, "dark")
  await sweep("light", 390, 844, "w390")
  await sweep("light", 768, 1024, "w768")
  await sweep("light", 1280, 800, "w1280")
  await sweep("light", 1920, 1080, "w1920")

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
