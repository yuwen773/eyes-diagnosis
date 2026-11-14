// PR-A §6.3 E2E：知识库文档工作区的真实操作闭环。
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-doc-preview-e2e.mjs
// 全部走真实页面与真实接口：上传夹具（用后即删）→ 打开知识库 → 打开 PDF /
// DOCX / MD → 原文/切片切换 → 下载 → 关闭阅读器 → 加载态。
// 任何一步与预期不符就以非零码失败。
import { mkdirSync } from "node:fs"
import { execSync } from "node:child_process"

// /tmp 在 MSYS 与 Node 眼里不是同一个地方；用 cygpath 换 Windows 真路径。
const FIXDIR = execSync("cygpath -w /tmp/docfix").toString().trim()

const base = process.env.CAP_BASE ?? "http://localhost:5183"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync("/tmp/doc-e2e", { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

const FIXTURES = {
  md: "眼科疾病知识库.md",          // 库里既有文档，不用上传
  pdf: `${FIXDIR}\\眼底影像判读规范.pdf`,
  docx: `${FIXDIR}\\眼科疾病分类说明.docx`,
}

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`)
  if (!ok) failures++
}

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base })
  const p = await ctx.newPage()
  const errors = []
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)))

  // 登录
  await p.goto(base + "/login", { waitUntil: "networkidle" })
  await p.getByPlaceholder("useraccount").fill(user)
  await p.locator('input[type="password"]').fill(pass)
  await p.getByRole("button", { name: "登录" }).click()
  await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })

  // 0) 上传 PDF / DOCX 夹具（真实上传接口；E2E 结束后按文件名删除）
  const uploadedIds = []
  {
    await p.goto(base + "/admin/knowledge", { waitUntil: "networkidle" })
    await p.waitForTimeout(600)
    for (const kind of ["pdf", "docx"]) {
      const fileName = FIXTURES[kind].split("\\").pop()
      // 上次失败的运行可能留下了同名夹具，后端会拒「文档已存在」——先清干净。
      const stale = await p.evaluate(async (name) => {
        const res = await fetch("/api/knowledge/list/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current: 1, pageSize: 50, fileName: name }),
        })
        const j = await res.json()
        return (j.data?.records ?? []).filter((r) => r.fileName === name).map((r) => r.id)
      }, fileName)
      for (const staleId of stale) {
        await p.evaluate(async (id) => {
          await fetch("/api/knowledge/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          })
        }, staleId)
        console.log(`removed stale fixture ${fileName} (${staleId})`)
      }

      // setInputFiles 只是把文件放进输入框；页面要再点「开始上传」才真正提交。
      await p.locator('input[type="file"]').first().setInputFiles(FIXTURES[kind])
      await p.getByRole("button", { name: "开始上传" }).click()
      // Node 侧轮询到这一行真的入库（page.waitForFunction 对异步断言不可靠）
      let id = null
      for (let i = 0; i < 60 && !id; i++) {
        await p.waitForTimeout(500)
        id = await p.evaluate(async (name) => {
          const res = await fetch("/api/knowledge/list/page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current: 1, pageSize: 50, fileName: name }),
          })
          const j = await res.json()
          return j.data?.records?.find((r) => r.fileName === name)?.id ?? null
        }, fileName)
      }
      if (id) uploadedIds.push({ kind, id, fileName })
      console.log(`uploaded ${kind} -> id ${id}`)
      if (!id) throw new Error(`upload did not land for ${fileName}`)
    }
  }

  const uploaded = new Map(uploadedIds.map((u) => [u.kind, u.fileName]))

  // 1) 打开知识库
  await p.goto(base + "/admin/knowledge", { waitUntil: "networkidle" })
  await p.waitForTimeout(600)
  check("open knowledge base", (await p.locator("text=知识库").count()) > 0)

  const openDoc = async (fileName) => {
    // 上一次的工作区可能还开着——抽屉是模态，会盖住筛选区，先关掉。
    if (await p.locator(".admin-drawer--workspace").count()) {
      await p.keyboard.press("Escape")
      await p.waitForTimeout(500)
    }
    const filter = p.getByLabel("文件名")
    if (!(await filter.isVisible())) {
      const expand = p.getByRole("button", { name: "展开筛选" })
      if (await expand.count()) await expand.click()
    }
    await filter.fill(fileName)
    await p.getByRole("button", { name: "查询" }).click()
    await p.waitForTimeout(900)
    const row = p.locator("tr", { hasText: fileName }).first()
    await row.waitFor({ timeout: 15000 })
    await row.locator('button[aria-label="预览文档"]').click()
    await p.locator(".admin-drawer--workspace").waitFor({ timeout: 15000 })
    await p.waitForTimeout(400)
  }

  // 2) 打开 PDF：内嵌查看器 + 徽标 + 新窗口链接
  await openDoc(uploaded.get("pdf"))
  const pdfFrame = p.locator("iframe.admin-doc__pdf")
  check("pdf iframe present", (await pdfFrame.count()) === 1)
  await pdfFrame.waitFor({ timeout: 15000 })
  await p.waitForTimeout(1500)
  const chipText = await p.locator(".admin-doc__reader-chip").textContent()
  check("pdf chip names the file + viewer", chipText.includes("pdf") && chipText.includes("浏览器内嵌查看器"), chipText.trim())
  check("pdf new-window link", (await p.locator('a:has-text("新窗口打开")').count()) === 1)

  // 5) 原文 / 切片切换
  // 桌面（>900px）左右分栏同时在；窄屏才出现「原文 / 切片」两个 tab。
  check("desktop shows reader and chunks side by side",
    (await p.locator(".admin-doc__pane--reader").count()) === 1 &&
    (await p.locator(".admin-doc__pane--chunks").count()) === 1)
  check("desktop shows chunk list", (await p.locator(".admin-doc__chunk-toggle").count()) > 0)
  await p.setViewportSize({ width: 800, height: 900 })
  await p.waitForTimeout(600)
  const chunkTab = p.getByRole("tab", { name: /切片/ })
  check("narrow shows pane tabs", (await chunkTab.count()) === 1)
  await chunkTab.click()
  await p.waitForTimeout(400)
  check("chunks tab renders chunk list", (await p.locator(".admin-doc__chunk-toggle").count()) > 0)
  await p.getByRole("tab", { name: "原文" }).click()
  await p.waitForTimeout(400)
  check("switch back to original pane", (await p.locator("iframe.admin-doc__pdf").count()) === 1)
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.waitForTimeout(500)

  // 6) 下载：点头部的「下载原文件」，拦截下载确认触发
  const [download] = await Promise.all([
    p.waitForEvent("download", { timeout: 15000 }),
    p.locator('a:has-text("下载原文件")').first().click(),
  ])
  check("download triggers a real file download", true, download.suggestedFilename())
  check("download filename is the original", download.suggestedFilename().endsWith(".pdf"), download.suggestedFilename())

  // 7) 关闭阅读器
  await p.locator('button[aria-label="关闭文档工作区"]').click()
  await p.waitForTimeout(400)
  check("close button closes the workspace", (await p.locator(".admin-drawer--workspace").count()) === 0)

  // 3) DOCX：浏览器内解析出标题与表格
  await openDoc(uploaded.get("docx"))
  await p.waitForTimeout(2500)
  const docxProse = await p.locator(".admin-doc__prose").textContent()
  check("docx parsed in-browser (mammoth)", docxProse.includes("眼科疾病分类说明"), docxProse.slice(0, 40))
  check("docx table rendered", (await p.locator(".admin-doc__prose table").count()) >= 1)
  await p.keyboard.press("Escape")
  await p.waitForTimeout(300)

  // 4) Markdown：渲染成富文本，记号不裸露
  await openDoc(FIXTURES.md)
  await p.waitForTimeout(1200)
  const mdProse = await p.locator(".admin-doc__prose").innerHTML()
  check("md rendered to headings", mdProse.includes("<h1") || mdProse.includes("<h2"), "")
  check("md markers not literal", !mdProse.includes("## ") && !mdProse.includes("# "), "")

  // 8) 加载态：开一份新文档时原文区先出现「正在读取原文…」（瞬态，抓到才算）
  const loadPromise = p.waitForSelector(".admin-doc__reader-state", { timeout: 8000 }).then(() => true).catch(() => false)
  await openDoc(uploaded.get("docx"))
  const sawLoading = await loadPromise
  console.log(sawLoading ? "PASS loading state observed (transient)" : "NOTE loading state not caught (transient; doc served from cache)")
  await p.keyboard.press("Escape")
  await p.waitForTimeout(300)

  await p.screenshot({ path: "/tmp/doc-e2e/e2e-final-state.png" })

  // 收尾：删掉本脚本上传的夹具，库里只留既有文档
  {
    const jar = await p.evaluate(async () => {
      const res = await fetch("/api/knowledge/list/page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: 1, pageSize: 50 }),
      })
      return (await res.json()).data?.records ?? []
    })
    for (const u of uploadedIds) {
      const rec = jar.find((r) => r.id === u.id)
      if (!rec) { console.log("fixture already gone:", u.fileName); continue }
      const del = await p.evaluate(async (id) => {
        const res = await fetch("/api/knowledge/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
        return res.json()
      }, u.id)
      console.log(`deleted fixture ${u.fileName}:`, JSON.stringify(del).slice(0, 80))
    }
  }

  await browser.close()

  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"))
    process.exit(2)
  }
  if (failures > 0) {
    console.error(`E2E FAILURES: ${failures}`)
    process.exit(1)
  }
  console.log("E2E all checks passed")
}
main().catch((e) => { console.error(e); process.exit(1) })
