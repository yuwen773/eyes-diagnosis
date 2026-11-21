// 管理端资讯预览（PR-B）证据采集。
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-news-preview.mjs <输出目录>
// 凭据只走环境变量；截图来自真实运行的前后端与数据库。
// 预览用的文章由脚本自己建（真实走 /news/edit 与 /news/uploadCover），采完删除，
// 库里不留临时草稿；NEWS_ID 可以指定用库里已有的文章（此时脚本不删它）。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5184"
const outDir = process.argv[2] ?? "/tmp/news-shots"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
const givenNewsId = process.env.NEWS_ID
const publicId = process.env.PUBLIC_NEWS_ID ?? "13"
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")
mkdirSync(outDir, { recursive: true })

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const executablePath = process.env.E2E_CHROMIUM_PATH ?? CHROME

/** 预览稿正文：有章节、有列表，够长能过 30 字符守卫。 */
const DRAFT_CONTENT = `# 干眼症日常护理

干眼症是泪膜稳定性下降导致的眼干、异物感与视疲劳。日常护理以行为调整为主：规律作息、控制屏幕时间、必要时使用人工泪液，并在眼科医生的指导下处理。

## 一、常见诱因

- 屏幕时间过长
- 空调房空气干燥
- 隐形眼镜佩戴过久

## 二、何时就医

出现持续疼痛、明显畏光或视力下降时应尽快就诊，不要自行长期使用眼药水。`

async function main() {
  const pw = await import("playwright")
  const browser = await pw.chromium.launch({ executablePath })
  const writes = []
  const errors = []

  const ctx = async (width, height) => browser.newContext({ viewport: { width, height } })


  /**
   * 切主题：写 localStorage 再重载。
   *
   * <p>不点界面上的开关——主题开关只存在于后台外壳（AdminLayout）与产品页顶栏
   * （ProductHeader），登录页与某些页面没有；在没有开关的页面上点它是**静默
   * 失败**（`if (count) click()` 直接跳过），于是拍出来的「暗色」其实是浅色。
   * localStorage 的键是 `theme`（见 theme-provider.tsx），在页面脚本之前就位，
   * 也不会闪白。切完由 `shot()` 断言 `html.dark` 真的在。
   */
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

  // 预览稿：脚本自己建（真实走 /news/edit 与 /news/uploadCover），采完删掉。
  // 这样证据可以随时重采，库里不留临时草稿。
  let newsId = givenNewsId ?? ""
  let ownDraftId = ""
  if (!newsId) {
    const p = await (await ctx(1440, 900)).newPage()
    await login(p, "light")
    const created = await p.evaluate(async (body) => {
      const res = await fetch("/api/news/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      return await res.json()
    }, { title: "【预览验证】干眼症日常护理", content: DRAFT_CONTENT, status: 0 })
    ownDraftId = String(created?.data ?? "")
    if (!ownDraftId || ownDraftId === "null") throw new Error("draft create failed: " + JSON.stringify(created))
    // 封面用仓库自带资产，不依赖外网。
    const cover = await p.evaluate(async (id) => {
      const blob = await (await fetch("/fundus-demo.jpg")).blob()
      const fd = new FormData()
      fd.append("file", new File([blob], "cover.jpg", { type: "image/jpeg" }))
      fd.append("id", String(id))
      const up = await fetch("/api/news/uploadCover", { method: "POST", body: fd })
      return await up.json()
    }, ownDraftId)
    if (!cover?.data) throw new Error("cover upload failed: " + JSON.stringify(cover))
    newsId = ownDraftId
    console.log("preview draft:", newsId)
  }

  const openEditor = async (page) => {
    page.on("request", (req) => {
      if (req.method() !== "GET" && /\/news\/(edit|uploadCover)/.test(req.url())) {
        writes.push(`${req.method()} ${req.url()}`)
      }
    })
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 240)))
    await page.goto(`${base}/admin/news/${newsId}/edit`, { waitUntil: "networkidle" })
    await page.getByRole("tab", { name: "预览" }).click()
    await page.waitForTimeout(700)
  }

  const shot = async (page, name, fullPage = true) => {
    // 暗色截图必须先断言主题真的切过去了：曾经脚本在**登录页**点主题开关，
    // 那个按钮只存在于后台外壳与产品页顶栏，登录页没有——`if (count) click()`
    // 于是静默跳过，两张「暗色」证据成了浅色图的逐字节副本。
    // 断言把这种无声失败变成硬错误：拿浅色冒充暗色，证据就不算证据。
    if (name.endsWith("-dark")) {
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      )
      if (!isDark) throw new Error(`${name} 截图前发现主题不是暗色：html.dark 不存在`)
    }
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage })
    console.log("captured", name)
  }

  // 1) 后台预览：桌面 / 手机，浅色
  {
    const c = await ctx(1440, 900)
    const p = await c.newPage()
    await login(p, "light")
    await openEditor(p)
    await shot(p, "preview-desktop-1440-light")

    await p.getByRole("button", { name: "手机" }).click()
    await p.waitForTimeout(400)
    await shot(p, "preview-mobile-1440-light")

    // 未保存编辑：改标题与正文，预览立刻反映，且不产生写请求
    await p.getByRole("tab", { name: "编辑" }).click()
    await p.getByLabel("标题").fill("【未保存】干眼症日常护理（改过的标题）")
    await p.getByLabel("正文").fill(
      "## 一、什么是干眼\n\n这是预览里正在编辑、还没有保存的正文。\n\n## 二、常见诱因\n\n- 屏幕时间过长\n- 空调房干燥\n- 隐形眼镜佩戴过久\n\n## 三、日常护理\n\n规律休息、热敷眼睑、必要时使用人工泪液。",
    )
    await p.getByRole("tab", { name: "预览" }).click()
    await p.waitForTimeout(500)
    await shot(p, "preview-unsaved-mobile-1440-light")

    await p.getByRole("button", { name: "桌面" }).click()
    await p.waitForTimeout(300)
    await shot(p, "preview-unsaved-desktop-1440-light")
    await c.close()
  }

  // 2) 后台预览：深色
  {
    const c = await ctx(1440, 900)
    const p = await c.newPage()
    await login(p, "dark")
    await openEditor(p)
    await shot(p, "preview-desktop-1440-dark")
    await p.getByRole("button", { name: "手机" }).click()
    await p.waitForTimeout(300)
    await shot(p, "preview-mobile-1440-dark")
    await c.close()
  }

  // 3) 后台预览：1280 / 768 / 390
  for (const [w, h, tag] of [[1280, 800, "1280"], [768, 1024, "768"], [390, 844, "390"]]) {
    const c = await ctx(w, h)
    const p = await c.newPage()
    await login(p, "light")
    await openEditor(p)
    await shot(p, `preview-1440-device-${tag}-light`)
    await c.close()
  }

  // 4) 公开详情页（重构后的共享组件）
  for (const [w, h, theme, tag] of [
    [1440, 900, "light", "1440-light"],
    [1440, 900, "dark", "1440-dark"],
    [1280, 800, "light", "1280-light"],
    [768, 1024, "light", "768-light"],
    [390, 844, "light", "390-light"],
  ]) {
    const c = await ctx(w, h)
    const p = await c.newPage()
    await p.goto(`${base}/news/${publicId}`, { waitUntil: "networkidle" })
    if (theme === "dark") {
      // 公开页的主题在产品页顶栏有开关，但这里不点它——统一走 localStorage +
      // 重载（见 setDarkTheme 的注释），截图前由 shot() 断言 html.dark。
      await setDarkTheme(p)
    }
    await p.waitForTimeout(900)
    await shot(p, `public-news-${tag}`)
    await c.close()
  }

  // 收尾：删掉本脚本建的预览稿。
  if (ownDraftId) {
    const p = await (await ctx(1440, 900)).newPage()
    await login(p, "light")
    const res = await p.evaluate(async (id) => {
      const r = await fetch(`/api/news/delete/${id}`, { method: "POST" })
      return await r.json()
    }, ownDraftId)
    console.log("deleted preview draft", ownDraftId, JSON.stringify(res).slice(0, 60))
  }

  // 4b) 已发布文章的后台预览：status=1 时眉线走真实发布时间，
  //     与草稿预览的「预览稿 · 尚未发布」形成对照。
  {
    const c = await ctx(1440, 900)
    const p = await c.newPage()
    await login(p, "light")
    await p.goto(`${base}/admin/news/${publicId}/edit`, { waitUntil: "networkidle" })
    await p.getByRole("tab", { name: "预览" }).click()
    await p.waitForTimeout(800)
    await shot(p, "preview-published-1440-light")
    await c.close()
  }

  await browser.close()
  if (writes.length) {
    console.error("UNEXPECTED WRITES DURING PREVIEW:\n" + writes.join("\n"))
    process.exit(3)
  }
  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"))
    process.exit(2)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
