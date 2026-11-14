// Iris 2.1 · R3.3 · 管理端六页验收探针
//
// 用法：
//   CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-pages-acceptance.mjs
//
// 产出（控制台 + JSON 到 stdout）：
// - 每一页 × 每一档位：横向溢出（scrollWidth > clientWidth）、控制台错误、
//   关键业务入口是否存在（筛选 / 分页 / 行操作 / 主操作 / 弹层按钮）。
// - 汇总成一张表，便于人工复核。
//
// 只读探针：不写库、不改数据。
import { mkdirSync, writeFileSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5173"
const outDir = process.argv[2] ?? "docs/design/admin-pages-polish/acceptance"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

const PAGES = [
  ["data-analysis", "/admin/data-analysis"],
  ["diagnosis", "/admin/diagnosis"],
  ["news", "/admin/news"],
  ["knowledge", "/admin/knowledge"],
  ["users", "/admin/users"],
  ["news-edit", "/admin/news/new/edit"],
]

const VIEWPORTS = [
  [390, 844],
  [768, 1024],
  [1440, 900],
  [1920, 1080],
]

/** 每页必须存在的关键入口（缺一个就记一条 finding）。 */
const AFFORDANCES = {
  "data-analysis": [
    [".admin-metric-strip", "KPI 读数轨"],
    [".admin-viz__toggle-btn", "图/表切换"],
    [".admin-range__btn", "时间窗切换"],
  ],
  diagnosis: [
    [".admin-dt__table", "台账表格"],
    [".admin-dt__pager", "分页条"],
    [".admin-dt__row-actions", "行操作"],
  ],
  news: [
    [".admin-dt__table", "台账表格"],
    [".admin-dt__pager", "分页条"],
    [".admin-dt__row-actions", "行操作"],
  ],
  knowledge: [
    [".admin-dt__table", "台账表格"],
    [".admin-knowledge__upload", "上传区"],
    [".admin-dt__row-actions", "行操作"],
  ],
  users: [
    [".admin-dt__table", "台账表格"],
    [".admin-dt__pager", "分页条"],
    [".admin-dt__row-actions", "行操作"],
  ],
  "news-edit": [[".admin-newsedit__workspace", "编辑工作台"]],
}

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const results = []

  // 外层按「档位 × 主题」开一次 context：登录一次，六页轮着跑，
  // 既省 48 次登录，也顺带验证同一会话里跨页导航不炸。
  for (const [width, height] of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height } })
      await context.addInitScript((value) => {
        window.localStorage.setItem("theme", value)
      }, theme)
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text().slice(0, 200)}`)
      })

      try {
        await page.goto(base + "/login", { waitUntil: "networkidle" })
        await page.getByPlaceholder("useraccount").fill(user)
        await page.locator('input[type="password"]').fill(pass)
        await page.getByRole("button", { name: "登录" }).click()
        await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })

        for (const [slug, route] of PAGES) {
          // 每页重置错误收集：上一页的报错不该算到这一页头上。
          errors.length = 0
          await page.goto(base + route, { waitUntil: "networkidle" })
          await page
            .waitForSelector(
              ".admin-metric-strip, .admin-dt__head, .admin-viz, .admin-newsedit__workspace",
              { timeout: 20000 },
            )
            .catch(() => {})
          await page.waitForTimeout(1200)

          const probe = await page.evaluate(() => {
            const doc = document.documentElement
            // 找横向溢出的元素（只看最外层，避免被内部滚动容器误报）
            const offenders = []
            const limit = doc.clientWidth
            for (const el of Array.from(document.querySelectorAll("body *"))) {
              const rect = el.getBoundingClientRect()
              if (rect.width === 0) continue
              if (rect.right > limit + 1) {
                // 只报最外层的越界元素
                const parent = el.parentElement
                const parentRect = parent?.getBoundingClientRect()
                if (!parentRect || parentRect.right <= limit + 1) {
                  offenders.push({
                    tag: el.tagName.toLowerCase(),
                    cls: (el.className || "").toString().slice(0, 90),
                    right: Math.round(rect.right),
                  })
                }
              }
            }
            return {
              scrollWidth: doc.scrollWidth,
              clientWidth: doc.clientWidth,
              offenders: offenders.slice(0, 5),
              title: document.title,
            }
          })

          const missing = []
          for (const [selector, label] of AFFORDANCES[slug] ?? []) {
            let count = 0
            try {
              count = await page.locator(selector).count()
            } catch (error) {
              missing.push(`${label} (${selector}) [probe error: ${String(error).slice(0, 80)}]`)
              continue
            }
            if (count === 0) missing.push(`${label} (${selector})`)
          }

          results.push({
            page: slug,
            viewport: `${width}x${height}`,
            theme,
            overflow: probe.scrollWidth > probe.clientWidth + 1,
            scrollWidth: probe.scrollWidth,
            clientWidth: probe.clientWidth,
            offenders: probe.offenders,
            missing,
            errors,
          })

          const flag =
            probe.scrollWidth > probe.clientWidth + 1 || missing.length || errors.length
              ? "WARN"
              : "ok"
          console.log(
            `${flag.padEnd(4)} ${slug.padEnd(14)} ${String(width).padEnd(5)}${theme.padEnd(6)}` +
              ` scroll=${probe.scrollWidth}/${probe.clientWidth}` +
              (missing.length ? ` missing=[${missing.join(", ")}]` : "") +
              (errors.length ? ` errors=${errors.length}` : ""),
          )
        }
      } finally {
        await context.close()
      }
    }
  }

  await browser.close()

  const problems = results.filter(
    (r) => r.overflow || r.missing.length > 0 || r.errors.length > 0,
  )
  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    problems: problems.length,
    results,
  }
  const file = `${outDir}/acceptance.json`
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n${results.length} checks · ${problems.length} with findings → ${file}`)
  if (problems.length) {
    for (const p of problems) {
      console.log(
        `\n${p.page} ${p.viewport} ${p.theme}\n  overflow=${p.overflow} ${JSON.stringify(p.offenders)}` +
          `\n  missing=${JSON.stringify(p.missing)}\n  errors=${JSON.stringify(p.errors)}`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
