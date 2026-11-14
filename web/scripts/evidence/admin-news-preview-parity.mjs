// 管理端资讯预览 · 版式同值核对（PR-B）。
//
// 主张是「预览就是公开页那篇文章」。这句话可以被证伪：同一个宽度下，
// 预览设备框里的文章与公开页文章的关键尺寸是否逐项相同。
//
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-news-preview-parity.mjs
// 凭据只走环境变量，不打印、不进截图。
//
// 核对对象是同一篇文章（库里的已发布文章 PUBLIC_NEWS_ID）：
//   - 公开页：浏览器视口宽度 = 预览设备框宽度
//   - 后台预览：设备框（手机 390 / 桌面取管理端主列实际宽度）
// 逐项比较计算样式，差值超过 0.6px 即失败。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5184"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
const publicId = process.env.PUBLIC_NEWS_ID ?? "13"
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const TOLERANCE = 0.6
const outDir = process.argv[2] ?? "/tmp/news-parity"

/** 在页面里量文章的关键尺寸。公开页与预览跑的是同一段代码。 */
const MEASURE = () => {
  const props = (sel, keys) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const out = {}
    for (const key of keys) out[key] = cs[key]
    return out
  }
  const body = document.querySelector(".news-article__body")
  const bodyStyle = body ? getComputedStyle(body) : null
  const toc = document.querySelector(".news-toc")
  return {
    title: props(".news-article__title", ["fontSize", "lineHeight", "maxWidth"]),
    head: props(".news-article__head", ["paddingTop", "paddingBottom"]),
    paper: props(".news-paper", [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "maxWidth",
    ]),
    plate: props(".news-article__plate", ["marginBottom"]),
    body: bodyStyle
      ? {
          columnGap: bodyStyle.columnGap,
          columns: bodyStyle.gridTemplateColumns.split(" ").filter(Boolean).length,
        }
      : null,
    tocPosition: toc ? getComputedStyle(toc).position : "absent",
    titleText: document.querySelector(".news-article__title")?.textContent?.trim() ?? "",
  }
}

const failures = []

function compare(label, left, right) {
  if (left === null && right === null) return // 两侧都没有这个元素（例如无封面）
  if (left === null || right === null) {
    failures.push(`${label}: 有一侧没量到（public=${left} preview=${right}）`)
    return
  }
  for (const key of Object.keys(left)) {
    const a = left[key]
    const b = right[key]
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > TOLERANCE) {
        failures.push(`${label}.${key}: 公开页 ${a} vs 预览 ${b}（差 ${(a - b).toFixed(2)}）`)
      }
    } else if (a !== b) {
      failures.push(`${label}.${key}: 公开页 ${a} vs 预览 ${b}`)
    }
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath: CHROME })

  const login = async (page) => {
    await page.goto(base + "/login", { waitUntil: "networkidle" })
    await page.getByPlaceholder("useraccount").fill(user)
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole("button", { name: "登录" }).click()
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await page.waitForTimeout(600)
  }

  // 后台预览：桌面窗口里量出设备框宽度（手机 390 / 桌面取主列实际宽度）。
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const adminPage = await adminCtx.newPage()
  await login(adminPage)
  await adminPage.goto(`${base}/admin/news/${publicId}/edit`, { waitUntil: "networkidle" })
  await adminPage.getByRole("tab", { name: "预览" }).click()
  await adminPage.waitForTimeout(500)

  const frameWidth = async () =>
    adminPage.evaluate(() => {
      const el = document.querySelector(".admin-newsedit__device")
      return el ? Math.round(el.getBoundingClientRect().width) : 0
    })

  const modes = []
  await adminPage.getByRole("button", { name: "手机" }).click()
  await adminPage.waitForTimeout(400)
  modes.push({ name: "mobile", width: await frameWidth(), height: 844 })
  await adminPage.getByRole("button", { name: "桌面" }).click()
  await adminPage.waitForTimeout(400)
  modes.push({ name: "desktop", width: await frameWidth(), height: 900 })

  for (const mode of modes) {
    if (mode.name === "mobile") {
      await adminPage.getByRole("button", { name: "手机" }).click()
    } else {
      await adminPage.getByRole("button", { name: "桌面" }).click()
    }
    await adminPage.waitForTimeout(400)
    const previewMetrics = await adminPage.evaluate(MEASURE)
    await adminPage.screenshot({ path: `${outDir}/parity-preview-${mode.name}.png`, fullPage: true })

    const publicCtx = await browser.newContext({
      viewport: { width: mode.width, height: mode.height },
    })
    const publicPage = await publicCtx.newPage()
    await publicPage.goto(`${base}/news/${publicId}`, { waitUntil: "networkidle" })
    await publicPage.waitForTimeout(900)
    const publicMetrics = await publicPage.evaluate(MEASURE)
    await publicPage.screenshot({ path: `${outDir}/parity-public-${mode.name}.png`, fullPage: true })
    await publicCtx.close()

    compare(`[${mode.name} ${mode.width}px] title`, publicMetrics.title, previewMetrics.title)
    compare(`[${mode.name} ${mode.width}px] head`, publicMetrics.head, previewMetrics.head)
    compare(`[${mode.name} ${mode.width}px] paper`, publicMetrics.paper, previewMetrics.paper)
    compare(`[${mode.name} ${mode.width}px] plate`, publicMetrics.plate, previewMetrics.plate)
    compare(`[${mode.name} ${mode.width}px] body`, publicMetrics.body, previewMetrics.body)

    // 目录：公开页窄屏 static、桌面 sticky；预览里一律 static（预览没有滚动
    // 容器，sticky 没有意义，这是已知取舍）。只要不是第三种值即可。
    if (!["static", "sticky", "absent"].includes(publicMetrics.tocPosition)) {
      failures.push(`[${mode.name}] 公开页目录 position 异常：${publicMetrics.tocPosition}`)
    }
    if (publicMetrics.titleText !== previewMetrics.titleText) {
      failures.push(
        `[${mode.name}] 标题文本不一致：公开页「${publicMetrics.titleText}」 vs 预览「${previewMetrics.titleText}」`,
      )
    }

    console.log(`[${mode.name} ${mode.width}px] public :`, JSON.stringify(publicMetrics))
    console.log(`[${mode.name} ${mode.width}px] preview:`, JSON.stringify(previewMetrics))
  }

  await adminCtx.close()
  await browser.close()

  if (failures.length > 0) {
    console.log("\nFAIL")
    for (const line of failures) console.log(" -", line)
    process.exit(1)
  }
  console.log("\nPARITY OK：预览设备框与公开页同宽时逐项同值")
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
