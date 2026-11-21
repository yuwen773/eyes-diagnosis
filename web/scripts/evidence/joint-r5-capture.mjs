/**
 * 联合候选的截图归档（本地、真实后端、合成数据）。
 *
 * 目的只有一个：给 `docs/reviews/iris-r5-final-readiness.md` 提供**可复现的像素证据**，
 * 证明 390 / 768 / 1440 三档视口 × Light / Dark 两套主题 × 减少动效偏好下，
 * 关键页面没有横向溢出、没有丢内容层。
 *
 * 它**不是**验收门禁，也不产生断言：断言在 `e2e/*.spec.ts` 里。这里只出图。
 *
 * 用法（需已起：后端 :8081、前端 dev :5273 代理到 :8081、专用测试库有合成账号）：
 *   E2E_BASE_URL=http://127.0.0.1:5273 E2E_USER=... E2E_PASSWORD=... \
 *     node scripts/evidence/joint-r5-capture.mjs
 *
 * 输出：仓库根 `target/r5-joint-shots/`（已 gitignore）。缺环境变量时整体跳过，不产生红。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273"
const USER = process.env.E2E_USER
const PASSWORD = process.env.E2E_PASSWORD
const RECORD_ID = process.env.E2E_RECORD_ID ?? "81001"
const OUT = resolve(process.cwd(), "../target/r5-joint-shots")

const ROUTES = [
  { path: "/diagnosis", name: "diagnosis" },
  { path: "/records", name: "records" },
  { path: `/records/${RECORD_ID}`, name: "record-report" },
  { path: "/news", name: "news" },
  { path: "/agent", name: "agent" },
  { path: "/profile", name: "profile" },
]
const WIDTHS = [390, 768, 1440]
const THEMES = ["light", "dark"]

if (!USER || !PASSWORD) {
  console.log("skip: 需要 E2E_USER / E2E_PASSWORD（见 e2e/README.md）")
  process.exit(0)
}

mkdirSync(OUT, { recursive: true })

// 与 playwright.config.ts 同一口径：显式路径优先，否则用本机装好的最新一份。
const executablePath =
  process.env.E2E_CHROMIUM_PATH ||
  process.env.E2E_CHROMIUM_EXECUTABLE_PATH ||
  chromium.executablePath()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const manifest = []

async function shoot(name, width, theme, reducedMotion) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 390 ? 844 : width <= 768 ? 1024 : 900 },
    reducedMotion,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme)
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder("useraccount").fill(USER)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole("button", { name: "登录" }).click()
  await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 15_000 })

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route.path}`)
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => document.fonts?.ready)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    const motion = reducedMotion === "reduce" ? "-rm" : ""
    const file = `${route.name}-${theme}-${width}${motion}.png`
    await page.screenshot({ path: resolve(OUT, file), fullPage: true })
    manifest.push({ file, route: route.path, theme, width, reducedMotion, overflowPx: overflow })
  }
  await context.close()
}

for (const theme of THEMES) {
  for (const width of WIDTHS) await shoot("standard", width, theme, "no-preference")
}
for (const theme of THEMES) await shoot("reduced", 768, theme, "reduce")

await browser.close()

writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
const overflowing = manifest.filter((m) => m.overflowPx > 1)
console.log(`shots: ${manifest.length} → ${OUT}`)
console.log(overflowing.length === 0 ? "no horizontal overflow" : `overflow: ${JSON.stringify(overflowing)}`)
