// 文档工作区（PR-A）证据采集。
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-doc-preview.mjs <输出目录>
// 凭据只走环境变量；数据全部来自本地后端与数据库，没有手工填充的假状态。
import { mkdirSync } from "node:fs"
import { execSync } from "node:child_process"

// /tmp 在 MSYS 与 Node 眼里不是同一个地方；用 cygpath 换 Windows 真路径。
const FIXDIR = execSync("cygpath -w /tmp/docfix").toString().trim()

const base = process.env.CAP_BASE ?? "http://localhost:5183"
const outDir = process.argv[2] ?? "/tmp/doc-shots"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

const DOCS = {
  md: "眼科疾病知识库.md",
  txt: "prompt.txt",
  pdf: "眼底影像判读规范.pdf",
  docx: "眼科疾病分类说明.docx",
  doc: "旧版病历模板.doc",
}

// 需要在库里真实存在的夹具（PDF / DOCX / DOC 由本脚本自己上传，采完再删）。
const NEEDED = {
  pdf: `${FIXDIR}\\眼底影像判读规范.pdf`,
  docx: `${FIXDIR}\\眼科疾病分类说明.docx`,
  doc: `${FIXDIR}\\旧版病历模板.doc`,
}

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const errors = []

  const context = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } })
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base })
    return ctx
  }

  const login = async (page, theme) => {
    await page.goto(base + "/login", { waitUntil: "networkidle" })
    if (theme === "dark") {
      const t = page.locator(".theme-toggle").first()
      if (await t.count()) await t.click()
    }
    await page.getByPlaceholder("useraccount").fill(user)
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole("button", { name: "登录" }).click()
    await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await page.waitForTimeout(800)
    if (theme === "dark") {
      const t = page.locator(".theme-toggle").first()
      if (await t.count()) await t.click()
      await page.waitForTimeout(300)
    }
  }

  const openDoc = async (page, fileName) => {
    await page.goto(base + "/admin/knowledge", { waitUntil: "networkidle" })
    await page.waitForTimeout(600)
    const filter = page.getByLabel("文件名")
    if (!(await filter.isVisible())) {
      const expand = page.getByRole("button", { name: "展开筛选" })
      if (await expand.count()) await expand.click()
    }
    await page.getByLabel("文件名").fill(fileName)
    await page.getByRole("button", { name: "查询" }).click()
    await page.waitForTimeout(900)
    const row = page.locator("tr", { hasText: fileName }).first()
    await row.waitFor({ timeout: 15000 })
    await row.locator('button[aria-label="预览文档"]').click()
    await page.locator(".admin-drawer--workspace").waitFor({ timeout: 15000 })
    // DOCX 要等 mammoth 动态加载 + 转换，PDF 要等内置查看器首帧；
    // 统一等原文容器出现后再给一段稳定时间，避免截到半张表。
    const prose = page.locator(".admin-doc__prose, .admin-doc__reader pre, .admin-doc__reader iframe")
    await prose.first().waitFor({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2200)
  }

  const shot = async (page, name) => {
    await page.screenshot({ path: `${outDir}/${name}.png` })
    console.log("captured", name)
  }

  const track = (page, tag) => {
    page.on("pageerror", (e) => errors.push(`${tag}: ${String(e).slice(0, 240)}`))
  }

  // 夹具自备自销：PDF / DOCX / DOC 由脚本真实上传，采完按文件名删掉，
  // 库里只留下仓库本来的文档。TXT 与 MD 用库里既有的。
  const uploaded = []
  const ensureFixtures = async (page) => {
    await page.goto(base + "/admin/knowledge", { waitUntil: "networkidle" })
    await page.waitForTimeout(600)
    for (const [kind, filePath] of Object.entries(NEEDED)) {
      const fileName = filePath.split("\\").pop()
      const existing = await page.evaluate(async (name) => {
        const res = await fetch("/api/knowledge/list/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current: 1, pageSize: 50, fileName: name }),
        })
        const j = await res.json()
        return (j.data?.records ?? []).filter((r) => r.fileName === name).map((r) => r.id)
      }, fileName)
      for (const staleId of existing) {
        await page.evaluate(async (id) => {
          await fetch("/api/knowledge/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          })
        }, staleId)
        console.log("removed stale fixture", fileName, staleId)
      }
      await page.locator('input[type="file"]').first().setInputFiles(filePath)
      await page.getByRole("button", { name: "开始上传" }).click()
      let id = null
      for (let i = 0; i < 60 && !id; i++) {
        await page.waitForTimeout(500)
        id = await page.evaluate(async (name) => {
          const res = await fetch("/api/knowledge/list/page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current: 1, pageSize: 50, fileName: name }),
          })
          const j = await res.json()
          return j.data?.records?.find((r) => r.fileName === name)?.id ?? null
        }, fileName)
      }
      if (!id) throw new Error("fixture upload failed: " + fileName)
      uploaded.push({ id, fileName })
      console.log("uploaded fixture", fileName, id)
    }
  }

  const dropFixtures = async (page) => {
    for (const { id, fileName } of uploaded) {
      await page.evaluate(async (docId) => {
        await fetch("/api/knowledge/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: docId }),
        })
      }, id)
      console.log("deleted fixture", fileName, id)
    }
  }

  // 夹具要先在库里：PDF / DOCX / DOC 由上传接口真写进去，截出来的才是真实数据。
  {
    const c = await context(1440, 900)
    const p = await c.newPage()
    track(p, "fixtures")
    await login(p, "light")
    await ensureFixtures(p)
    await c.close()
  }

  // 1) 桌面 · Markdown · 浅色 / 深色
  for (const theme of ["light", "dark"]) {
    const ctx = await context(1440, 900)
    const page = await ctx.newPage()
    track(page, `md-${theme}`)
    await login(page, theme)
    await openDoc(page, DOCS.md)
    await shot(page, `workspace-md-1440-${theme}`)

    // 切片折叠：点第 2 块标题收起，证明状态可交互
    const chunkToggles = page.locator(".admin-doc__chunk-toggle")
    if ((await chunkToggles.count()) > 1) {
      await chunkToggles.nth(1).click()
      await page.waitForTimeout(250)
    }
    await shot(page, `workspace-md-1440-${theme}-chunk-collapsed`)

    // 独立滚动：只滚切片栏，原文栏不动
    const pane = page.locator(".admin-doc__pane--chunks .admin-doc__pane-body")
    await pane.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(400)
    await shot(page, `workspace-md-1440-${theme}-chunks-scrolled`)
    await ctx.close()
  }

  // 2) 桌面 · PDF / DOCX / DOC / TXT
  const ctx2 = await context(1440, 900)
  const p2 = await ctx2.newPage()
  track(p2, "formats")
  await login(p2, "light")
  for (const [kind, name] of [["pdf", DOCS.pdf], ["docx", DOCS.docx], ["doc", DOCS.doc], ["txt", DOCS.txt]]) {
    await openDoc(p2, name)
    // PDF iframe 由浏览器内置查看器渲染，等它的网络请求落地
    if (kind === "pdf") await p2.waitForTimeout(2500)
    await shot(p2, `workspace-${kind}-1440-light`)
    await p2.keyboard.press("Escape")
    await p2.waitForTimeout(500)
  }
  await ctx2.close()

  // 3) 窄屏：390 上是「原文 / 切片」分页签
  const ctx3 = await context(390, 844)
  const p3 = await ctx3.newPage()
  track(p3, "w390")
  await login(p3, "light")
  await openDoc(p3, DOCS.md)
  await shot(p3, "workspace-md-390-light")
  const chunkTab = p3.getByRole("tab", { name: /切片/ })
  if (await chunkTab.count()) {
    await chunkTab.click()
    await p3.waitForTimeout(500)
    await shot(p3, "workspace-md-390-light-chunks")
  }
  await p3.keyboard.press("Escape")
  await p3.waitForTimeout(400)
  await openDoc(p3, DOCS.pdf)
  await shot(p3, "workspace-pdf-390-light")
  await ctx3.close()

  // 4) 平板 768
  const ctx4 = await context(768, 1024)
  const p4 = await ctx4.newPage()
  track(p4, "w768")
  await login(p4, "light")
  await openDoc(p4, DOCS.md)
  await shot(p4, "workspace-md-768-light")
  await ctx4.close()

  // 5) 1280
  const ctx5 = await context(1280, 800)
  const p5 = await ctx5.newPage()
  track(p5, "w1280")
  await login(p5, "light")
  await openDoc(p5, DOCS.docx)
  await shot(p5, "workspace-docx-1280-light")
  await ctx5.close()

  // 6) 补齐 DESIGN §3.8 的宽屏与深色覆盖
  {
    const c = await context(1920, 1080)
    const p = await c.newPage()
    track(p, "w1920")
    await login(p, "light")
    await openDoc(p, DOCS.md)
    await shot(p, "workspace-md-1920-light")
    await c.close()
  }
  {
    const c = await context(1920, 1080)
    const p = await c.newPage()
    track(p, "w1920-dark")
    await login(p, "dark")
    await openDoc(p, DOCS.md)
    await shot(p, "workspace-md-1920-dark")
    await c.close()
  }
  for (const [w, h, tag] of [[768, 1024, "768"], [390, 844, "390"]]) {
    const c = await context(w, h)
    const p = await c.newPage()
    track(p, `${tag}-dark`)
    await login(p, "dark")
    await openDoc(p, DOCS.md)
    await shot(p, `workspace-md-${tag}-dark`)
    await c.close()
  }
  {
    const c = await context(390, 844)
    const p = await c.newPage()
    track(p, "docx-390")
    await login(p, "light")
    await openDoc(p, DOCS.docx)
    await shot(p, "workspace-docx-390-light")
    // 表格在首屏折线以下：滚到表格再截一张，证明窄屏下表格确实逐列可读。
    const table = p.locator(".admin-doc__prose table").first()
    if (await table.count()) {
      await table.scrollIntoViewIfNeeded()
      await p.waitForTimeout(600)
      await shot(p, "workspace-docx-390-light-table")
    }
    await c.close()
  }
  for (const [kind, name] of [["pdf", DOCS.pdf], ["docx", DOCS.docx], ["doc", DOCS.doc], ["txt", DOCS.txt]]) {
    const c = await context(1440, 900)
    const p = await c.newPage()
    track(p, `${kind}-dark`)
    await login(p, "dark")
    await openDoc(p, name)
    if (kind === "pdf") await p.waitForTimeout(2200)
    await shot(p, `workspace-${kind}-1440-dark`)
    await c.close()
  }

  // 收尾：删掉本脚本上传的夹具，库里只留仓库本来的文档。
  {
    const c = await context(1440, 900)
    const p = await c.newPage()
    track(p, "cleanup")
    await login(p, "light")
    await dropFixtures(p)
    await c.close()
  }

  await browser.close()
  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"))
    process.exit(2)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })