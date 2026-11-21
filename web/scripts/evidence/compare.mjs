// Iris 2.1 · R3.3 · 改造前 / 改造后并排对比图
//
// 用法：
//   node web/scripts/evidence/compare.mjs <beforeDir> <afterDir> <outDir> [slug,slug]
//
// 每张对比图 = 左「改造前」右「改造后」，同一视口同一主题。
// 用 Playwright 渲染一个两栏 HTML 再截图——不引第三方图像库，
// 也不生成任何「假图」：左右两侧都是真实页面截图的原始像素。
import { mkdirSync, existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }

/** 读成 data URL：内联进对比页，避免 file:// 子资源被拦。 */
function dataUrl(path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
  const mime = MIME[ext] ?? "image/png"
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`
}

const beforeDir = process.argv[2]
const afterDir = process.argv[3]
const outDir = process.argv[4] ?? "docs/design/admin-pages-polish/compare"
const only = process.argv[5] ? new Set(process.argv[5].split(",").map((s) => s.trim())) : null
if (!beforeDir || !afterDir) throw new Error("usage: compare.mjs <beforeDir> <afterDir> <outDir> [slugs]")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

const SLUGS = [
  "dashboard",
  "data-analysis",
  "diagnosis",
  "news",
  "knowledge",
  "users",
  "news-edit",
]
const SHOTS = [
  ["1440", "light"],
  ["1440", "dark"],
  ["390", "light"],
]

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()

  let made = 0
  for (const slug of SLUGS) {
    if (only && !only.has(slug)) continue
    for (const [width, theme] of SHOTS) {
      const name = `${slug}-${width}-${theme}`
      const before = resolve(beforeDir, `${name}.png`)
      const after = resolve(afterDir, `${name}.png`)
      if (!existsSync(before) || !existsSync(after)) continue

      // 图片用 data URL 内联：setContent 的文档源是 about:blank，
      // Chromium 会拦掉这种源发起的 file:// 子资源请求（截图里只剩裂图）。
      // 内联后左右两侧就是两张真实截图的原始像素，不经任何二次处理。
      const beforeUrl = dataUrl(before)
      const afterUrl = dataUrl(after)
      const html = `<!doctype html><meta charset="utf-8">
<style>
  @page { margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; background: #0b0b12; font-family: "Segoe UI", system-ui, sans-serif }
  .row { display: flex; gap: 18px; padding: 18px; align-items: flex-start }
  .col { flex: 1 1 0; min-width: 0 }
  .cap { color: #cfcfe0; font-size: 13px; letter-spacing: .08em; text-transform: uppercase;
         padding: 0 0 10px 2px; font-weight: 600 }
  .cap b { color: #9c8cf0 }
  .shot { border: 1px solid #2a2a3a; border-radius: 6px; overflow: hidden;
          background: #12121a; max-height: 1400px; overflow-y: hidden }
  .shot img { display: block; width: 100% }
</style>
<div class="row">
  <div class="col">
    <div class="cap"><b>改造前</b> · ${esc(name)}</div>
    <div class="shot"><img src="${beforeUrl}"></div>
  </div>
  <div class="col">
    <div class="cap"><b>改造后</b> · ${esc(name)}</div>
    <div class="shot"><img src="${afterUrl}"></div>
  </div>
</div>`
      await page.setContent(html, { waitUntil: "load" })
      await page.waitForFunction(() => {
        const imgs = Array.from(document.images)
        return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0)
      })
      await page.waitForTimeout(200)
      const out = `${outDir}/compare-${name}.png`
      await page.screenshot({ path: out, fullPage: true, animations: "disabled" })
      console.log("compare →", out)
      made += 1    }
  }
  await browser.close()
  console.log(`${made} comparison images`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
