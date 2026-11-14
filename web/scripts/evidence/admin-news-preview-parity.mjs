// 管理端资讯预览 · 版式同值核对（PR-B）。
//
// 主张是「预览就是公开页那篇文章」。这句话可以被证伪，本脚本负责证伪它：
// 同一篇文章、同一宽度下，预览设备框里的文章与公开页文章**渲染出来的结果**
// 是否一致——不只是 CSS 计算样式，还包括实际列宽与断行。
//
// 用法：CAP_USER=... CAP_PASS=... node web/scripts/evidence/admin-news-preview-parity.mjs [输出目录]
// 凭据只走环境变量，不打印、不进截图。
//
// 宽度口径：设备框的**逻辑宽度**固定（桌面 1240 / 手机 390），画布装不下时
// 整幅版式等比缩小。所以「同宽」指的是逻辑宽度同宽——公开页按逻辑宽度开窗口，
// 预览侧量到的渲染宽度是视觉宽度（已含缩放），比之前先除掉缩放系数还原成
// 逻辑宽度。断行行数与缩放无关，直接比。
//
// 文章：脚本自己建一篇**临时发布**的对照稿（多级标题 + 列表 + 引用 + 长段落 +
// 封面），因为库里现有的 13 篇已发布文章没有一篇带章节或封面——目录与封面
// 这两条路径在公开页上根本没被走过，不造一篇就量不到。采集结束删除该文章，
// 并在收尾核对库里无残留。
import { mkdirSync } from "node:fs"

const base = process.env.CAP_BASE ?? "http://localhost:5184"
const user = process.env.CAP_USER
const pass = process.env.CAP_PASS
if (!user || !pass) throw new Error("CAP_USER / CAP_PASS required")

const CHROME = "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const TOLERANCE = 0.6
const outDir = process.argv[2] ?? "/tmp/news-parity"

/**
 * 对照稿正文：**HTML**，与编辑部在后台保存后落库的形态一致。
 *
 * <p>这里必须是 HTML，不能直接塞 Markdown 源码：编辑页保存时会把 Markdown 走
 * 渲染管线存成 HTML，公开页读的就是 HTML。第一版脚本图省事直接存了 Markdown
 * 源码，于是公开页把 `#`、`##` 当普通文字渲染（没有 h2、没有目录、没有段落），
 * 预览却按 Markdown 渲染——量出来的差异全是**夹具造出来的**，不是产品的。
 * 夹具要还原真实落库形态，对比才有意义。
 */
const ARTICLE_CONTENT = `<p>干眼症是泪膜稳定性下降导致的眼干、异物感与视疲劳，常见于长时间盯屏、空调房空气干燥、隐形眼镜佩戴过久的人群。它的诊断不靠单一症状，需要结合裂隙灯检查、泪液分泌量与眼表染色结果综合判断，必要时还要排除角膜炎与睑缘炎。</p>
<blockquote>
<p>本段是引用块，用来对照它在两种上下文里的断行：公开页与后台预览若宽度不同，同一段话排出的行数就会不同——这正是要量的东西。</p>
</blockquote>
<h2>一、什么是干眼症</h2>
<p>干眼症的常见诱因包括长时间盯屏、空调房空气干燥、隐形眼镜佩戴过久与泪液分泌不足。它的诊断不靠单一症状，需要结合裂隙灯检查、泪液分泌量与眼表染色结果综合判断，必要时还要排除角膜炎与睑缘炎。</p>
<h2>二、日常护理怎么做</h2>
<ul>
<li>规律作息，保证每用眼二十分钟就远眺或闭眼休息一会儿</li>
<li>屏幕亮度与环境光接近，夜里不要在暗处看手机</li>
<li>空调房可以加湿，但加湿器要每日换水，否则容易滋生微生物</li>
<li>隐形眼镜连续佩戴不要超过六小时，镜片按说明更换</li>
</ul>
<h2>三、何时必须就医</h2>
<p>出现持续疼痛、明显畏光、视力下降，或者异物感持续两周以上不缓解时，应尽快就诊，不要自行长期使用眼药水——有些含激素的滴眼液短期缓解、长期反而会加重病情。</p>`

/**
 * 在页面里量文章：计算样式 + 渲染结果。
 *
 * <p>渲染结果这一半是这一版补上的：上一版只量计算样式，于是「机身内边距吃掉
 * 了视口宽度、正文列宽差 18px、同段文字少排一行」这类问题全是绿的——
 * 计算样式相同，不代表排出来的结果相同。
 */
const MEASURE = () => {
  const pick = (sel) => document.querySelector(sel)
  const box = (sel) => {
    const el = pick(sel)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { width: round(rect.width), height: round(rect.height) }
  }
  const round = (n) => Math.round(n * 100) / 100
  const styles = (sel, keys) => {
    const el = pick(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const out = {}
    for (const key of keys) out[key] = cs[key]
    return out
  }
  /** 行盒数：把一个块级节点的内容按行分组，distinct top 的个数 = 行数。 */
  const lineCount = (node) => {
    if (!node) return null
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0 && r.width > 0)
    const tops = new Set(rects.map((r) => Math.round(r.top)))
    return tops.size
  }
  const blocks = Array.from(document.querySelectorAll(".news-paper__body p, .news-paper__body blockquote, .news-paper__body li"))
  const body = pick(".news-article__body")
  const bodyStyle = body ? getComputedStyle(body) : null
  const toc = pick(".news-toc")

  return {
    computed: {
      title: styles(".news-article__title", ["fontSize", "lineHeight", "maxWidth"]),
      head: styles(".news-article__head", ["paddingTop", "paddingBottom"]),
      paper: styles(".news-paper", [
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "maxWidth",
        "fontSize",
        "lineHeight",
      ]),
      plate: styles(".news-article__plate", ["marginBottom", "borderRadius"]),
    },
    rendered: {
      articleWidth: box(".news-article")?.width ?? null,
      paperWidth: box(".news-paper")?.width ?? null,
      paperBodyWidth: box(".news-paper__body")?.width ?? null,
      tocWidth: box(".news-toc")?.width ?? null,
      gridColumns: bodyStyle ? bodyStyle.gridTemplateColumns : null,
      columnGap: bodyStyle ? bodyStyle.columnGap : null,
      hasToc: Boolean(toc),
      hasPlate: Boolean(pick(".news-article__plate")),
      tocPosition: toc ? getComputedStyle(toc).position : "absent",
      // 每段的行数：宽度差一点点，这里就会差一行。
      lineCounts: blocks.map((b) => lineCount(b)),
    },
    text: pick(".news-article__title")?.textContent?.trim() ?? "",
  }
}

const failures = []
const notes = []

/** 数值按容差比，字符串逐字比，数组逐项比。 */
function compare(label, left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    if (left !== right) {
      failures.push(`${label}: 有一侧没量到（public=${left} preview=${right}）`)
    }
    return
  }
  if (typeof left === "object" && !Array.isArray(left)) {
    for (const key of Object.keys(left)) compare(`${label}.${key}`, left[key], right[key])
    return
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      failures.push(`${label}: 数组长度不同（public=${JSON.stringify(left)} preview=${JSON.stringify(right)}）`)
      return
    }
    left.forEach((item, index) => compare(`${label}[${index}]`, item, right[index]))
    return
  }
  if (typeof left === "number" && typeof right === "number") {
    if (Math.abs(left - right) > TOLERANCE) {
      failures.push(`${label}: 公开页 ${left} vs 预览 ${right}（差 ${(left - right).toFixed(2)}）`)
    }
    return
  }
  if (String(left).trim() !== String(right).trim()) {
    failures.push(`${label}: 公开页 ${JSON.stringify(left)} vs 预览 ${JSON.stringify(right)}`)
  }
}

/**
 * 预览的渲染宽度是**视觉**宽度（含等比缩放），除以缩放系数才还原成逻辑宽度。
 * 计算样式与断行行数与缩放无关，原样比。
 */
function normalizePreview(metrics, scale) {
  if (!scale || scale === 1) return metrics
  const out = { ...metrics, rendered: { ...metrics.rendered } }
  for (const key of ["articleWidth", "paperWidth", "paperBodyWidth", "tocWidth"]) {
    const value = out.rendered[key]
    if (typeof value === "number") out.rendered[key] = value / scale
  }
  return out
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

  /**
   * 切主题并断言生效。
   *
   * <p>不点界面上的主题开关：那个开关只存在于后台外壳与产品页顶栏，在没有它的
   * 页面上「点了」是静默失败（count 0 直接跳过）——采集脚本曾因此拍出两张
   * 逐字节相同的「暗色 / 浅色」图。这里统一写 localStorage（键见
   * theme-provider.tsx），并在切完之后断言 `html.dark` 真的在：断言能把
   * 「无声失败」变成硬错误。
   */
  const setTheme = async (page, theme) => {
    await page.evaluate((t) => {
      try {
        localStorage.setItem("theme", t)
      } catch {
        /* 无痕模式：忽略，断言会拦住 */
      }
    }, theme)
    await page.reload({ waitUntil: "networkidle" })
    await page.waitForTimeout(400)
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    )
    if (theme === "dark" && !isDark) throw new Error("主题没切到暗色：html.dark 不存在")
    if (theme === "light" && isDark) throw new Error("主题没切回浅色：html.dark 还在")
  }

  /**
   * 截图 + **截图时**断言主题。
   *
   * <p>`setTheme()` 已经断言过主题，但那是「切主题时」；截图发生在其后（中间还
   * 有 tab / 设备档位点击）。别的两个采集脚本是按文件名在 `shot()` 里硬断言，
   * 这里保持同一口径：暗色图必须在截图那一刻验到 `html.dark` 在，否则报错退出
   * ——不接受「拿浅色冒充暗色」。
   */
  const shotTheme = async (page, path, expectDark) => {
    if (expectDark) {
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      )
      if (!isDark) throw new Error(`截图前发现主题不是暗色：html.dark 不存在（${path}）`)
    }
    await page.screenshot({ path, fullPage: true })
    console.log("captured", path)
  }

  // 1) 造一篇临时发布的对照稿（真实走 /news/edit 与 /news/uploadCover）。
  const setupCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const setupPage = await setupCtx.newPage()
  await login(setupPage)
  const created = await setupPage.evaluate(async (body) => {
    const res = await fetch("/api/news/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return await res.json()
  }, {
    title: "【版式对照】干眼症日常护理与注意事项",
    content: ARTICLE_CONTENT,
    status: 1,
  })
  const newsId = String(created?.data ?? "")
  if (!newsId || newsId === "null") {
    await setupCtx.close()
    await browser.close()
    throw new Error("对照稿创建失败：" + JSON.stringify(created))
  }
  const cover = await setupPage.evaluate(async (id) => {
    const blob = await (await fetch("/fundus-demo.jpg")).blob()
    const fd = new FormData()
    fd.append("file", new File([blob], "cover.jpg", { type: "image/jpeg" }))
    fd.append("id", String(id))
    const up = await fetch("/api/news/uploadCover", { method: "POST", body: fd })
    return await up.json()
  }, newsId)
  await setupCtx.close()

  try {
    // 2) 后台预览：量出设备框的**逻辑宽度**（版式按它算）与呈现缩放系数。
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const adminPage = await adminCtx.newPage()
    await login(adminPage)
    await adminPage.goto(`${base}/admin/news/${newsId}/edit`, { waitUntil: "networkidle" })
    await adminPage.getByRole("tab", { name: "预览" }).click()
    await adminPage.waitForTimeout(600)

    /** 逻辑宽度（断点与字号按它算）与缩放系数（画布装不下时 < 1）。 */
    const frameGeometry = async () =>
      adminPage.evaluate(() => {
        const el = document.querySelector(".admin-newsedit__device")
        if (!el) return { logical: 0, scale: 1 }
        const cs = getComputedStyle(el)
        return {
          logical: Math.round(parseFloat(cs.getPropertyValue("--news-preview-logical-width")) || 0),
          scale: parseFloat(cs.getPropertyValue("--news-preview-scale")) || 1,
        }
      })

    const modes = []
    await adminPage.getByRole("button", { name: "手机" }).click()
    await adminPage.waitForTimeout(400)
    modes.push({ name: "mobile", height: 844, ...(await frameGeometry()) })
    await adminPage.getByRole("button", { name: "桌面" }).click()
    await adminPage.waitForTimeout(400)
    modes.push({ name: "desktop", height: 900, ...(await frameGeometry()) })

    // 双主题都跑：版式量值应当与主题无关，只跑浅色就等于拿一个主题代表两个主题。
    for (const theme of ["light", "dark"]) {
      await setTheme(adminPage, theme)
      await adminPage.getByRole("tab", { name: "预览" }).click()
      await adminPage.waitForTimeout(600)

      for (const mode of modes) {
        await adminPage.getByRole("button", { name: mode.name === "mobile" ? "手机" : "桌面" }).click()
        await adminPage.waitForTimeout(500)
        const previewMetrics = normalizePreview(
          await adminPage.evaluate(MEASURE),
          mode.scale,
        )
        await shotTheme(
          adminPage,
          `${outDir}/parity-preview-${mode.name}${theme === "dark" ? "-dark" : ""}.png`,
          theme === "dark",
        )

        // 公开页按**逻辑宽度**开窗口：预览的版式就是这一档的版式。
        const publicCtx = await browser.newContext({
          viewport: { width: mode.logical, height: mode.height },
        })
        const publicPage = await publicCtx.newPage()
        await publicPage.goto(`${base}/news/${newsId}`, { waitUntil: "networkidle" })
        await setTheme(publicPage, theme)
        await publicPage.waitForTimeout(900)
        const publicMetrics = await publicPage.evaluate(MEASURE)
        await shotTheme(
          publicPage,
          `${outDir}/parity-public-${mode.name}${theme === "dark" ? "-dark" : ""}.png`,
          theme === "dark",
        )
        await publicCtx.close()

        const tag = `[${theme} ${mode.name} ${mode.logical}px] `
        compare(tag + "title", publicMetrics.computed.title, previewMetrics.computed.title)
        compare(tag + "head", publicMetrics.computed.head, previewMetrics.computed.head)
        compare(tag + "paper", publicMetrics.computed.paper, previewMetrics.computed.paper)
        compare(tag + "plate", publicMetrics.computed.plate, previewMetrics.computed.plate)
        compare(tag + "articleWidth", publicMetrics.rendered.articleWidth, previewMetrics.rendered.articleWidth)
        compare(tag + "paperWidth", publicMetrics.rendered.paperWidth, previewMetrics.rendered.paperWidth)
        compare(tag + "paperBodyWidth", publicMetrics.rendered.paperBodyWidth, previewMetrics.rendered.paperBodyWidth)
        compare(tag + "tocWidth", publicMetrics.rendered.tocWidth, previewMetrics.rendered.tocWidth)
        compare(tag + "lineCounts", publicMetrics.rendered.lineCounts, previewMetrics.rendered.lineCounts)
        compare(tag + "columnGap", publicMetrics.rendered.columnGap, previewMetrics.rendered.columnGap)
        compare(tag + "hasToc", publicMetrics.rendered.hasToc, previewMetrics.rendered.hasToc)
        compare(tag + "hasPlate", publicMetrics.rendered.hasPlate, previewMetrics.rendered.hasPlate)
        compare(tag + "titleText", publicMetrics.text, previewMetrics.text)

        // gridTemplateColumns 是像素串，两侧的可用宽度可能只差亚像素——按列数比更稳。
        const cols = (v) => (v ? v.split(" ").filter(Boolean).length : 0)
        if (cols(publicMetrics.rendered.gridColumns) !== cols(previewMetrics.rendered.gridColumns)) {
          failures.push(
            `${tag}列数: 公开页 ${publicMetrics.rendered.gridColumns} vs 预览 ${previewMetrics.rendered.gridColumns}`,
          )
        }
        if (!publicMetrics.rendered.hasToc || !publicMetrics.rendered.hasPlate) {
          notes.push(`${tag}对照稿未覆盖目录/封面路径（hasToc=${publicMetrics.rendered.hasToc} hasPlate=${publicMetrics.rendered.hasPlate}）`)
        }
        if (publicMetrics.rendered.tocPosition !== previewMetrics.rendered.tocPosition) {
          notes.push(
            `${tag}目录 position 不同：公开页 ${publicMetrics.rendered.tocPosition} vs 预览 ${previewMetrics.rendered.tocPosition}`,
          )
        }

        console.log(`[${theme} ${mode.name} ${mode.logical}px] public :`, JSON.stringify(publicMetrics.rendered))
        console.log(`[${theme} ${mode.name} ${mode.logical}px] preview:`, JSON.stringify(previewMetrics.rendered))
      }
    }

    // ── 情形 B：未保存的表单状态 → 保存 → 公开页 ──────────────────────
    // 情形 A 核对的是「库里那篇文章在两处的版式」；情形 B 核对的是任务书里
    // 另一条主张：预览要**实时反映未保存的表单状态**，而且保存之后公开页要
    // 与刚才看到的预览是同一篇文章（正文走同一条渲染管线）。
    const DIRTY_MARKDOWN = `## 编辑中的小标题

这是管理员**尚未保存**的正文，用来核对「预览反映未保存的表单状态」，
以及「保存之后公开页与刚才看到的预览是同一篇文章」。

- 甲等条目
- 乙等条目
`
    // 情形 B 的两侧都固定在暗色：公开页显式切主题，管理端这一步也显式切，
    // 不依赖上面循环留下的主题状态（那个状态会随循环顺序漂移）。
    await setTheme(adminPage, "dark")
    await adminPage.getByRole("tab", { name: "编辑" }).click()
    const editor = adminPage.locator('textarea[aria-label="正文"]')
    await editor.waitFor({ timeout: 10000 })
    await editor.fill(DIRTY_MARKDOWN)
    await adminPage.getByRole("tab", { name: "预览" }).click()
    await adminPage.waitForTimeout(800)
    const dirtyPreviewRaw = await adminPage.evaluate(MEASURE)
    await shotTheme(adminPage, `${outDir}/parity-preview-dirty.png`, true)

    await adminPage.getByRole("button", { name: "保存" }).click()
    await adminPage.waitForTimeout(2000)
    const saveState = await adminPage.evaluate(() => {
      const el = document.querySelector(".admin-newsedit__rail")
      return el ? el.textContent?.slice(0, 200) ?? "" : ""
    })
    if (!saveState.includes("已保存")) {
      failures.push(`保存后状态读数不是「已保存」：${saveState.replace(/\s+/g, " ").trim()}`)
    }

    // 情形 B 同样按逻辑宽度开公开页窗口，并把预览的渲染宽度还原成逻辑宽度。
    const dirtyGeometry = await frameGeometry()
    const dirtyPreview = normalizePreview(dirtyPreviewRaw, dirtyGeometry.scale)
    const publicCtx2 = await browser.newContext({
      viewport: { width: dirtyGeometry.logical, height: 900 },
    })
    const publicPage2 = await publicCtx2.newPage()
    await publicPage2.goto(`${base}/news/${newsId}`, { waitUntil: "networkidle" })
    // 两侧同一主题才可比：公开页也要切到与管理端预览一致的主题。
    await setTheme(publicPage2, "dark")
    await publicPage2.waitForTimeout(900)
    const savedPublic = await publicPage2.evaluate(MEASURE)
    await shotTheme(publicPage2, `${outDir}/parity-public-after-save.png`, true)
    await publicCtx2.close()

    const tagB = "[未保存→保存后] "
    compare(tagB + "title", savedPublic.computed.title, dirtyPreview.computed.title)
    compare(tagB + "paper", savedPublic.computed.paper, dirtyPreview.computed.paper)
    compare(tagB + "articleWidth", savedPublic.rendered.articleWidth, dirtyPreview.rendered.articleWidth)
    compare(tagB + "paperWidth", savedPublic.rendered.paperWidth, dirtyPreview.rendered.paperWidth)
    compare(tagB + "paperBodyWidth", savedPublic.rendered.paperBodyWidth, dirtyPreview.rendered.paperBodyWidth)
    compare(tagB + "tocWidth", savedPublic.rendered.tocWidth, dirtyPreview.rendered.tocWidth)
    compare(tagB + "lineCounts", savedPublic.rendered.lineCounts, dirtyPreview.rendered.lineCounts)
    compare(tagB + "titleText", savedPublic.text, dirtyPreview.text)
    console.log("[未保存→保存后] preview:", JSON.stringify(dirtyPreview.rendered))
    console.log("[未保存→保存后] public :", JSON.stringify(savedPublic.rendered))

    await adminCtx.close()
  } finally {
    // 3) 收尾：删掉对照稿，库里不留痕迹。
    const cleanupCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const cleanupPage = await cleanupCtx.newPage()
    await login(cleanupPage)
    const removed = await cleanupPage.evaluate(async (id) => {
      const res = await fetch(`/api/news/delete/${id}`, { method: "POST" })
      return await res.json()
    }, newsId)
    console.log("对照稿已删除", newsId, JSON.stringify(removed).slice(0, 60))
    await cleanupCtx.close()
  }

  await browser.close()

  if (notes.length) {
    console.log("\nNOTES")
    for (const line of notes) console.log(" -", line)
  }
  if (failures.length > 0) {
    console.log("\nFAIL")
    for (const line of failures) console.log(" -", line)
    process.exit(1)
  }
  console.log("\nPARITY OK：预览设备框与公开页同宽时，计算样式与渲染结果均同值")
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
