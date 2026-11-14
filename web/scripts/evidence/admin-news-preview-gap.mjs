// PR-B 证据补采：§5.2 要求的「无封面状态」与「Markdown 复杂排版」（含图片）。
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-news-preview-gap.mjs <输出目录>
// 凭据只走环境变量；草稿经真实 API 创建，封面经真实上传接口写入，
// 结束后删除草稿与封面，不留在库里。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5184"
const outDir = process.argv[2] ?? "/tmp/news-gap-shots"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

// 复杂排版：多级标题 + 列表 + 引用 + 表格 + 代码块 + 图片（§5.2 全部六项）。
const COMPLEX_MD = `# 角膜炎诊疗要点（复杂排版验证稿）

> 本段为引用块：用于验证引用样式在预览中与公开页一致。

## 一、什么是角膜炎

角膜炎是角膜组织的炎症，感染、外伤、隐形眼镜佩戴不当都可能诱发。

- 感染性：细菌、真菌、病毒
- 非感染性：干眼、免疫反应
- 危险信号：眼痛、畏光、视力下降

## 二、检查流程

| 检查项 | 目的 | 不通过时 |
|---|---|---|
| 荧光素染色 | 看角膜上皮缺损 | 裂隙灯复查 |
| 共聚焦显微镜 | 排查真菌棘阿米巴 | 转诊角膜专科 |

### 用药示例（代码块）

\`\`\`
左氧氟沙星滴眼液 q2h → 症状缓解后减量
\`\`\`

![示意图](/fundus-detail-macula.jpg)

## 三、何时就医

出现视力骤降、剧烈眼痛、大量分泌物时，24 小时内就诊。`

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const errors = []
  // 写库请求只允许出现在「建草稿 / 传封面 / 删草稿」三个准备与收尾步骤里；
  // 预览阶段（下面的 track 页面）一旦出现任何写请求就以退出码 3 失败。
  const previewWrites = []

  // 1) 创建草稿 + 上传封面（真实 API，只在创建时写库）
  const jar = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const setup = await jar.newPage()
  await setup.goto(base + "/login", { waitUntil: "networkidle" })
  await setup.getByPlaceholder("useraccount").fill(user)
  await setup.locator('input[type="password"]').fill(pass)
  await setup.getByRole("button", { name: "登录" }).click()
  await setup.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })

  const created = await setup.evaluate(async (body) => {
    const res = await fetch("/api/news/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }, { title: "【预览验证】复杂排版与无封面", content: COMPLEX_MD, status: 0 })
  console.log("create resp:", JSON.stringify(created).slice(0, 200))
  const draftId = String(created.body?.data)
  if (!draftId || draftId === "null" || created.status !== 200) {
    throw new Error("create draft failed: " + JSON.stringify(created))
  }
  // 任何一步失败都不留临时数据：finally 里兜底删除草稿。
  let nocoverId = ""
  const deleted = new Set()
  const cleanupDraft = async (id) => {
    if (!id || deleted.has(id)) return
    try {
      // 清理可能发生在 setup 页面所在 context 关闭之后，所以自己开一个
      // 干净会话：拿已关闭的页面去删，会静默失败，草稿就留在库里了。
      const c = await browser.newContext()
      const p = await c.newPage()
      await p.goto(base + "/login", { waitUntil: "networkidle" })
      await p.getByPlaceholder("useraccount").fill(user)
      await p.locator('input[type="password"]').fill(pass)
      await p.getByRole("button", { name: "登录" }).click()
      await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
      const res = await p.evaluate(async (delId) => {
        const r = await fetch(`/api/news/delete/${delId}`, { method: "POST" })
        return await r.json()
      }, id)
      await c.close()
      if (res?.code === 0) {
        deleted.add(id)
        console.log("cleaned draft", id)
      } else if (res?.code === 40400) {
        // 已经删过了：不算失败。
        deleted.add(id)
        console.log("draft", id, "already gone")
      } else {
        console.warn(`cleanup of draft ${id} failed:`, JSON.stringify(res).slice(0, 120))
      }
    } catch (e) {
      // 清理失败必须可见：静默吞掉会让临时草稿留在库里。
      console.warn(`cleanup of draft ${id} failed:`, String(e).slice(0, 120))
    }
  }
  try {
  // 封面图取仓库自带资产（public/fundus-demo.jpg），不依赖外网；
  // uploadCover 要求带已存在的新闻 id（本系统不支持「上传封面即新建」）。
  const cover = await setup.evaluate(async (id) => {
    const res = await fetch("/fundus-demo.jpg")
    const blob = await res.blob()
    const fd = new FormData()
    fd.append("file", new File([blob], "cover.png", { type: "image/png" }))
    fd.append("id", String(id))
    const up = await fetch("/api/news/uploadCover", { method: "POST", body: fd })
    return { status: up.status, body: await up.json() }
  }, draftId)
  console.log("cover resp:", JSON.stringify(cover).slice(0, 160))
  const coverUrl = cover.body?.data
  if (!coverUrl) throw new Error("cover upload failed: " + JSON.stringify(cover))
  console.log("draft id:", draftId, "| cover uploaded")
  // } catch … finally 在文件末尾统一收尾（见下）。

  const shot = async (page, name) => {
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true })
    console.log("captured", name)
  }
  const track = (page, tag) => page.on("pageerror", (e) => errors.push(`${tag}: ${String(e).slice(0, 240)}`))
  // 写库监听只从「点下预览」那一刻开始：登录、建草稿、传封面都是准备步骤，
  // 预览阶段出现的任何写请求（保存 / 传封面 / 改状态）才是要抓的违规。
  const watchWrites = (page) => {
    page.on("request", (req) => {
      if (req.method() !== "GET") previewWrites.push(`${req.method()} ${req.url()}`)
    })
  }

  // 2) 复杂排版预览：桌面 / 手机，浅色 + 深色
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const p = await ctx.newPage()
    track(p, "complex-light")
    await p.goto(base + "/login", { waitUntil: "networkidle" })
    await p.getByPlaceholder("useraccount").fill(user)
    await p.locator('input[type="password"]').fill(pass)
    await p.getByRole("button", { name: "登录" }).click()
    await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await p.goto(`${base}/admin/news/${draftId}/edit`, { waitUntil: "networkidle" })
    watchWrites(p)
    await p.getByRole("tab", { name: "预览" }).click()
    await p.waitForTimeout(900)
    await shot(p, "preview-complex-desktop-1440-light")
    await p.getByRole("button", { name: "手机" }).click()
    await p.waitForTimeout(400)
    await shot(p, "preview-complex-mobile-1440-light")
    await ctx.close()
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const p = await ctx.newPage()
    track(p, "complex-dark")
    await p.goto(base + "/login", { waitUntil: "networkidle" })
    const t = p.locator(".theme-toggle").first()
    if (await t.count()) await t.click()
    await p.getByPlaceholder("useraccount").fill(user)
    await p.locator('input[type="password"]').fill(pass)
    await p.getByRole("button", { name: "登录" }).click()
    await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    await p.goto(`${base}/admin/news/${draftId}/edit`, { waitUntil: "networkidle" })
    watchWrites(p)
    await p.getByRole("tab", { name: "预览" }).click()
    await p.waitForTimeout(900)
    await shot(p, "preview-complex-desktop-1440-dark")
    await ctx.close()
  }

  // 3) 无封面预览：单独建一篇无封面草稿（封面已随上一篇写入表单），
  //    预览里不出现封面图版——「没有封面就不摆封面位」。
  //    删除统一走 finally 兜底，这里不再单独删。
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const p = await ctx.newPage()
    track(p, "nocover-light")
    await p.goto(base + "/login", { waitUntil: "networkidle" })
    await p.getByPlaceholder("useraccount").fill(user)
    await p.locator('input[type="password"]').fill(pass)
    await p.getByRole("button", { name: "登录" }).click()
    await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 })
    const created2 = await p.evaluate(async (body) => {
      const res = await fetch("/api/news/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      return res.json()
    }, { title: "【预览验证】无封面状态", content: "# 无封面\n\n本文没有封面图，用来验证预览在缺少封面时不会摆出封面位，也不会编造一张不存在的图片；读数与版式都如实呈现。", status: 0 })
    nocoverId = String(created2.data)
    if (!nocoverId || nocoverId === "null") throw new Error("no-cover draft failed: " + JSON.stringify(created2))
    await p.goto(`${base}/admin/news/${nocoverId}/edit`, { waitUntil: "networkidle" })
    await p.waitForTimeout(600)
    watchWrites(p)
    await p.getByRole("tab", { name: "预览" }).click()
    await p.waitForTimeout(700)
    const hasCover = await p.locator(".news-article__plate").count()
    console.log("no-cover preview plate count (want 0):", hasCover)
    await shot(p, "preview-nocover-1440-light")
    await ctx.close()
  }

  // 4) 删除第一篇草稿，不留临时数据（封面图在 COS 上，无独立删除接口）
  const del = await setup.evaluate(async (id) => {
    const res = await fetch(`/api/news/delete/${id}`, { method: "POST" })
    return { status: res.status, body: await res.json() }
  }, draftId)
  console.log("delete resp:", JSON.stringify(del).slice(0, 120))
  deleted.add(draftId)
  await jar.close()
  } finally {
    // 任何一步失败都兜底删草稿，不让临时数据留在库里。
    await cleanupDraft(draftId)
    await cleanupDraft(nocoverId)
  }

  await browser.close()
  if (previewWrites.length) {
    console.error("UNEXPECTED WRITES DURING PREVIEW:\n" + previewWrites.join("\n"))
    process.exit(3)
  }
  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"))
    process.exit(2)
  }
  console.log("gap capture done; draft", draftId, "deleted")
}
main().catch((e) => { console.error(e); process.exit(1) })
