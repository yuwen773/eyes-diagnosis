/**
 * R2.5-03 资讯编辑版 · 视觉证据采集（可复跑）
 *
 * 用法（先在 web/ 下起 vite，再另开一个终端）：
 *
 *   node scripts/evidence/r25-03-news.mjs
 *
 * 可选：EVIDENCE_BASE（默认 http://localhost:5175）、EVIDENCE_OUT（默认 .shots/r25-03-news）、
 *       EVIDENCE_CHROME（默认本机 Playwright Chromium 路径）。
 *
 * 说明：
 * - 列表 / 分页 / 检索 / 空结果 / 短文详情全部走真实接口。
 * - 「有封面」与「长文目录」两条路径本机数据覆盖不到（13 条均无封面、正文 51–75 字），
 *   用真实接口响应 + 布局夹具验证排版：前者只追加 coverImage，后者替换一条详情响应。
 *   夹具不进入产品代码，也不代表任何真实内容。
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.EVIDENCE_BASE ?? "http://localhost:5175"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), ".shots", "r25-03-news")
const CHROME =
  process.env.EVIDENCE_CHROME ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"

mkdirSync(OUT, { recursive: true })
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

/* 长文夹具：四个 h2 触发目录（>1 节），正文长度超过 400 字以走导语路径。 */
const LONG_ARTICLE = {
  id: "13",
  title: "角膜炎的症状、原因与治疗",
  author: "编辑部",
  publishTime: "2026-11-12 09:30:00",
  summary: "",
  content: [
    "<p>角膜炎是角膜组织的炎症反应，可由感染、外伤或免疫因素引起。本页按院内科普口径整理常见问题，具体诊断与治疗请以执业医师意见为准；如出现视力骤降或剧烈眼痛，请立即就医。</p>",
    "<h2>常见诱因</h2>",
    "<p>角膜位于眼球最外层，直接接触外界。佩戴隐形眼镜时清洁不当、眼部外伤、异物划伤，以及部分免疫相关疾病，都可能引起角膜的炎症反应。长期干眼、睑缘炎也会削弱角膜表面的防御能力。</p>",
    "<h2>需要留意的症状</h2>",
    "<ul><li>眼红、畏光、流泪，异物感明显；</li><li>视力模糊或看灯光出现光晕；</li><li>眼痛持续加重，或伴有分泌物增多。</li></ul>",
    "<p>症状的轻重并不总与病情一致。佩戴隐形眼镜期间出现上述表现，应先停戴并尽快就诊，不要自行购买眼药水长期使用。</p>",
    "<h2>就诊与日常护理</h2>",
    "<p>医生会结合裂隙灯检查判断炎症的位置与范围，必要时取样检查。护理上应遵医嘱用药、按时复诊；毛巾与枕巾单独清洗；避免揉眼；外出时按医生建议佩戴防护镜。</p>",
    "<h2>什么时候需要复诊</h2>",
    "<p>用药后症状没有缓解、反而加重，或出现新的视力下降，都应提前复诊。复诊时带上正在使用的药物清单，方便医生判断疗程与调整方案。日常注意用眼休息，长时间用屏幕时每隔二十分钟远眺二十秒。</p>",
  ].join(""),
}

const errors = []
const report = []

const probeWidth = (page) =>
  page.evaluate(() => {
    const body = document.querySelector(".news-paper__body")
    const rect = body?.getBoundingClientRect()
    const style = body ? getComputedStyle(body) : null
    return {
      bodyWidth: rect ? Math.round(rect.width) : null,
      fontSize: style?.fontSize,
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    }
  })

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})

function watch(page, tag) {
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`))
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`))
}

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  watch(page, theme)
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme)

  await page.goto(`${BASE}/news`, { waitUntil: "networkidle" })
  await settle(900)
  report.push({ theme, page: "news", ...(await probeWidth(page)) })
  await page.screenshot({ path: join(OUT, `${theme}-news-1440-fold.jpg`), type: "jpeg", quality: 80 })
  await page.screenshot({ path: join(OUT, `${theme}-news-1440-full.jpg`), fullPage: true, type: "jpeg", quality: 70 })
  await page.locator(".news-lead").screenshot({ path: join(OUT, `${theme}-news-lead-1440.jpg`), type: "jpeg", quality: 80 })
  await page.locator(".news-rows").screenshot({ path: join(OUT, `${theme}-news-rows-1440.jpg`), type: "jpeg", quality: 80 })

  await page.click('.news__pager-step:has-text("下一页")')
  await settle(900)
  await page.screenshot({ path: join(OUT, `${theme}-news-page2-1440.jpg`), type: "jpeg", quality: 80 })
  report.push({ theme, page: "news-page2", meta: await page.locator(".news__meta").innerText() })

  await page.fill("#news-search", "角膜")
  await page.click(".news__submit")
  await settle(900)
  await page.screenshot({ path: join(OUT, `${theme}-news-search-1440.jpg`), type: "jpeg", quality: 80 })

  await page.fill("#news-search", "不存在的条目xyz")
  await page.click(".news__submit")
  await settle(900)
  await page.screenshot({ path: join(OUT, `${theme}-news-empty-1440.jpg`), type: "jpeg", quality: 80 })
  report.push({ theme, page: "news-empty", meta: await page.locator(".news__meta").innerText() })
  await page.click(".news__clear")
  await settle(700)

  await page.click(".news-lead__title a")
  await page.waitForURL(/\/news\/\d+/)
  await settle(1000)
  report.push({ theme, page: "detail", ...(await probeWidth(page)), url: page.url() })
  await page.screenshot({ path: join(OUT, `${theme}-detail-1440-fold.jpg`), type: "jpeg", quality: 80 })
  await page.screenshot({ path: join(OUT, `${theme}-detail-1440-full.jpg`), fullPage: true, type: "jpeg", quality: 70 })
  await ctx.close()

  // 有封面夹具
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const fpage = await fctx.newPage()
  watch(fpage, `${theme}-cover`)
  await fpage.addInitScript((t) => localStorage.setItem("theme", t), theme)
  await fpage.route("**/api/news/list/page/vo", async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    json.data.records = json.data.records.map((row, index) =>
      index < 2 ? { ...row, coverImage: "/fundus-demo.jpg" } : row,
    )
    await route.fulfill({ response, json })
  })
  await fpage.route("**/api/news/get/*", async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    json.data = { ...json.data, coverImage: "/fundus-demo.jpg" }
    await route.fulfill({ response, json })
  })
  await fpage.goto(`${BASE}/news`, { waitUntil: "networkidle" })
  await settle(900)
  await fpage.screenshot({ path: join(OUT, `${theme}-news-cover-1440-fold.jpg`), type: "jpeg", quality: 80 })
  await fpage.locator(".news-lead").screenshot({ path: join(OUT, `${theme}-news-cover-lead.jpg`), type: "jpeg", quality: 80 })
  await fpage.locator(".news-rows").screenshot({ path: join(OUT, `${theme}-news-cover-rows.jpg`), type: "jpeg", quality: 80 })
  await fpage.click(".news-lead__title a")
  await fpage.waitForURL(/\/news\/\d+/)
  await settle(900)
  await fpage.screenshot({ path: join(OUT, `${theme}-detail-cover-1440-fold.jpg`), type: "jpeg", quality: 80 })
  await fctx.close()

  // 长文 + 目录夹具
  const lctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const lpage = await lctx.newPage()
  watch(lpage, `${theme}-long`)
  await lpage.addInitScript((t) => localStorage.setItem("theme", t), theme)
  await lpage.route("**/api/news/get/13", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, msg: "ok", data: LONG_ARTICLE }),
    }),
  )
  await lpage.goto(`${BASE}/news/13`, { waitUntil: "networkidle" })
  await settle(1000)
  report.push({
    theme,
    page: "detail-long",
    toc: await lpage.locator(".news-toc__list a").count(),
    ...(await probeWidth(lpage)),
  })
  await lpage.screenshot({ path: join(OUT, `${theme}-detail-long-1440-fold.jpg`), type: "jpeg", quality: 80 })
  await lpage.screenshot({ path: join(OUT, `${theme}-detail-long-1440-full.jpg`), fullPage: true, type: "jpeg", quality: 70 })
  // 点目录第二项，验证锚点落点没被吸顶顶栏遮住
  await lpage.click('.news-toc__list a:nth-child(1)')
  await settle(900)
  await lpage.screenshot({ path: join(OUT, `${theme}-detail-long-toc.jpg`), type: "jpeg", quality: 80 })
  report.push({
    theme,
    page: "detail-long-anchor",
    top: await lpage.locator(".news-paper__body h2").first().evaluate((el) => Math.round(el.getBoundingClientRect().top)),
  })
  await lctx.close()
}

for (const theme of ["light", "dark"]) {
  for (const vp of [390, 768, 900, 1920]) {
    const ctx = await browser.newContext({
      viewport: { width: vp, height: vp === 390 ? 844 : 900 },
      deviceScaleFactor: 1,
      isMobile: vp === 390,
      hasTouch: vp === 390,
    })
    const page = await ctx.newPage()
    watch(page, `${vp}/${theme}`)
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme)
    await page.goto(`${BASE}/news`, { waitUntil: "networkidle" })
    await settle(900)
    report.push({ theme, vp, ...(await probeWidth(page)) })
    await page.screenshot({ path: join(OUT, `${theme}-news-${vp}-fold.jpg`), type: "jpeg", quality: 80 })
    await page.screenshot({ path: join(OUT, `${theme}-news-${vp}-full.jpg`), fullPage: true, type: "jpeg", quality: 70 })
    await page.click(".news-lead__title a")
    await page.waitForURL(/\/news\/\d+/)
    await settle(900)
    report.push({ theme, vp, page: "detail", ...(await probeWidth(page)) })
    await page.screenshot({ path: join(OUT, `${theme}-detail-${vp}-fold.jpg`), type: "jpeg", quality: 80 })
    await ctx.close()
  }
}

// 长文目录 · 390
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  watch(page, `${theme}-long-390`)
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme)
  await page.route("**/api/news/get/13", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, msg: "ok", data: LONG_ARTICLE }),
    }),
  )
  await page.goto(`${BASE}/news/13`, { waitUntil: "networkidle" })
  await settle(900)
  await page.screenshot({ path: join(OUT, `${theme}-detail-long-390-fold.jpg`), type: "jpeg", quality: 80 })
  await ctx.close()
}

writeFileSync(join(OUT, "report.json"), JSON.stringify({ report, errors }, null, 2))
await browser.close()
console.log(`done, errors=${errors.length}`)
if (errors.length) process.exitCode = 1
