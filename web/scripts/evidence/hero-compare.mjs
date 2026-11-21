// E-09 · OpticFlow × Prism 三方案真实浏览器对照（截图 + 性能证据）
//
// 用法：
//   1. 在 E-09 分支上：VITE_DESIGN_PREVIEW=true npx vite build
//      npx vite preview --port 4173 --strictPort
//   2. 原生 OpticFlow 页面（另一个分支的构建）：
//      npx vite preview --port 4174 --strictPort
//   3. node web/scripts/evidence/hero-compare.mjs
//
// 可用环境变量覆盖：
//   HERO_COMPARE_BASE（对照台，默认 http://localhost:4173）
//   HERO_OPTIC_BASE  （原生 OpticFlow，默认 http://localhost:4174）
//   E2E_CHROMIUM_PATH
//   HERO_COMPARE_PERF_ONLY=1（只重跑性能与降级读数，截图沿用上一轮，
//                            结果并回上一轮的 manifest.json）
//   HERO_EVIDENCE=r2（E-09 R2 定向取证：只跑 C 方案的矩阵 / 定格 / 降级 /
//                     裁剪 / 录屏 / 交错性能 / 遮挡几何与像素复核，
//                     产出写到 docs/reviews/assets/iris-hero-fusion-r2/）
//
// 产出：
//   docs/reviews/assets/iris-hero-comparison/   核心桌面截图 + 三版对照拼图（入库）
//   target/iris-hero-comparison/               全量截图 + manifest + 录屏（本地）
//   docs/reviews/assets/iris-hero-fusion-r2/    R2 定向取证（入库）
//   target/iris-hero-fusion-r2/                 R2 全量截图 + manifest + 录屏（本地）
//
// 为什么要真实浏览器：jsdom 只能验生命周期契约，验不了 WebGL 实际出图、
// 首屏 FPS、GPU 渲染器与 draw call 频次。静态降级结果绝不能当成真实 GPU 动效。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"

const ROOT = resolve(import.meta.dirname, "../../..")
/** `compare` = 三方案对照（E-09 首轮）；`r2` = C 方案定向精修取证。 */
const EVIDENCE = process.env.HERO_EVIDENCE === "r2" ? "r2" : "compare"
const DOC_REL =
  EVIDENCE === "r2" ? "docs/reviews/assets/iris-hero-fusion-r2" : "docs/reviews/assets/iris-hero-comparison"
const DOC_DIR = resolve(ROOT, DOC_REL)
const TARGET_DIR = resolve(ROOT, EVIDENCE === "r2" ? "target/iris-hero-fusion-r2" : "target/iris-hero-comparison")
const COMPARE_BASE = process.env.HERO_COMPARE_BASE ?? "http://localhost:4173"
const OPTIC_BASE = process.env.HERO_OPTIC_BASE ?? "http://localhost:4174"
const PERF_ONLY = process.env.HERO_COMPARE_PERF_ONLY === "1"
const CHROME =
  process.env.E2E_CHROMIUM_PATH ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"

mkdirSync(DOC_DIR, { recursive: true })
mkdirSync(TARGET_DIR, { recursive: true })

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
const COMMIT = git("rev-parse", "HEAD")
const BRANCH = git("rev-parse", "--abbrev-ref", "HEAD")

/** 三方案：代号、名称、渲染器根选择器、URL。 */
const VARIANTS = [
  { key: "optic", code: "A", name: "OpticFlow", selector: ".optic-flow" },
  { key: "prism", code: "B", name: "Prism", selector: ".hero-prism" },
  { key: "fusion", code: "C", name: "OpticFlow × Prism", selector: ".hero-fusion" },
]

const VIEWPORTS = [
  { key: "phone", width: 390, height: 844, label: "390×844" },
  { key: "tablet", width: 820, height: 1180, label: "820×1180" },
  { key: "desktop", width: 1440, height: 900, label: "1440×900" },
  { key: "wide", width: 1920, height: 1080, label: "1920×1080" },
]

/**
 * 首屏构图有两版，两版之间本来就有分歧：
 *   bleed    —— `ui@b805377f` 现行：主视觉铺满整个 hero 区段。
 *   contained—— `feat/iris21-multiagent-integration`：主视觉整块裁在玻璃壳内。
 * （`DESIGN.md` §3.6 写的是第三种组合：画布全幅 + 光带裁在壳里。）
 * 分开取帧，才能把「渲染器差异」和「构图差异」各归各的。
 */
const SHELLS = [
  { key: "bleed", label: "全幅（ui 现行）" },
  { key: "contained", label: "壳内（multiagent 分支）" },
]

/** 对照台 URL。参数化是为了让每一段证据都指向一个确定的落点。 */
function compareUrl(variantKey, { bare = true, paused = false, shell = "bleed" } = {}) {
  const params = new URLSearchParams({ variant: variantKey })
  if (shell !== "bleed") params.set("shell", shell)
  if (bare) params.set("bare", "1")
  if (paused) params.set("paused", "1")
  return `${COMPARE_BASE}/design/hero-compare?${params.toString()}`
}

/** 动效取帧时点：从渲染器进入 live 起算的毫秒数。三方案用同一个时点。 */
const FRAME_AT_MS = 3000

const browserPath = existsSync(CHROME)
  ? CHROME
  : (() => {
      try {
        return chromium.executablePath()
      } catch {
        return "playwright-default"
      }
    })()

// headful：软件光栅下 Prism 几乎不发光，会得到「没渲染」的错误结论。
const browser = await chromium.launch({
  headless: false,
  ...(browserPath === "playwright-default" ? {} : { executablePath: browserPath }),
})

/**
 * 页面注入：主题、webgl2 上下文计数、draw call 计数、可选禁用 WebGL。
 *
 * <p>draw call 计数是判断「动画停了没有」的关键：rAF 一直在跑不代表 GPU 还在画。
 */
function initScript({ theme, disableWebgl }) {
  try {
    localStorage.setItem("theme", theme)
  } catch {
    // 不透明源没有 localStorage，忽略。
  }
  window.__webgl2Created = 0
  window.__drawCalls = 0
  const created = new WeakSet()
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (disableWebgl && String(type).startsWith("webgl")) return null
    const context = original.call(this, type, ...rest)
    if (type === "webgl2" && context && !created.has(this)) {
      created.add(this)
      window.__webgl2Created += 1
    }
    return context
  }
  for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    if (!proto?.drawArrays) continue
    const draw = proto.drawArrays
    proto.drawArrays = function (...args) {
      window.__drawCalls += 1
      return draw.apply(this, args)
    }
  }
}

async function openContext({ viewport, theme, reducedMotion = "no-preference", disableWebgl = false }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion,
  })
  await context.addInitScript(initScript, { theme, disableWebgl })
  return context
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

/** 页面自述：渲染器状态、GPU、上下文数、横向溢出、动画计数。 */
function collectMeta(selector) {
  const root = document.querySelector(selector)
  const canvas = root?.querySelector("canvas")
  const gl = canvas?.getContext("webgl2")
  const debug = gl?.getExtension("WEBGL_debug_renderer_info")
  const rect = canvas?.getBoundingClientRect()
  const animations = root ? root.getAnimations({ subtree: true }).length : 0
  return {
    mode: root?.getAttribute("data-mode") ?? null,
    theme: root?.getAttribute("data-theme") ?? null,
    webgl2Contexts: window.__webgl2Created,
    drawCalls: window.__drawCalls,
    canvas: canvas
      ? {
          buffer: `${canvas.width}×${canvas.height}`,
          css: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
        }
      : null,
    renderer: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : (gl?.getParameter(gl.RENDERER) ?? null),
    cssAnimations: animations,
    horizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    heroHeight: Math.round(document.querySelector(".landing-hero")?.getBoundingClientRect().height ?? 0),
  }
}

/** 中位数。 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** 一个采样窗口内的帧时间、掉帧、长任务与 draw call 频次。 */
async function sampleOnce(target, durationMs) {
  return await target.evaluate(async (durationMs) => {
    const longTasks = []
    let observer = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      })
      observer.observe({ type: "longtask" })
    } catch {
      // 不支持 longtask 的浏览器只少一项读数。
    }
    const frames = []
    const start = performance.now()
    // draw call 是累计计数器：必须取**窗口内的增量**，否则「停机后」读到的是
    // 历史总数，看不出还在不在画。
    const drawsBefore = window.__drawCalls
    let last = start
    await new Promise((done) => {
      const tick = (now) => {
        frames.push(now - last)
        last = now
        if (now - start < durationMs) requestAnimationFrame(tick)
        else done()
      }
      requestAnimationFrame(tick)
    })
    observer?.disconnect()
    const sorted = [...frames].sort((a, b) => a - b)
    const average = frames.reduce((sum, value) => sum + value, 0) / frames.length
    const drawCalls = window.__drawCalls - drawsBefore
    return {
      sampledFrames: frames.length,
      // 注意：这是**采样循环自己的 rAF 节拍**，不是页面渲染帧率。页面完全空闲时
      // rAF 跑满 220 Hz，这个数会读到 200 以上，只能用来横向比较两个方案。
      averageFps: Number((1000 / average).toFixed(1)),
      averageFrameMs: Number(average.toFixed(2)),
      p95FrameMs: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
      maxFrameMs: Number(Math.max(...frames).toFixed(2)),
      droppedFrames: frames.filter((value) => value > 20).length,
      longTasksMs: longTasks.map((value) => Number(value.toFixed(1))),
      drawCalls,
      drawCallsPerSec: Number((drawCalls / (durationMs / 1000)).toFixed(1)),
      // 把采样时看到的 mode 一并记下来：脱离 mode 的 draw 增量无法判断是不是
      // 「定格之后又被唤醒」。
      mode: document.querySelector(".hero-fusion")?.getAttribute("data-mode") ?? null,
    }
  }, durationMs)
}

const entries = []

async function capture({
  name,
  variantKey,
  group,
  url,
  selector,
  viewport,
  theme,
  reducedMotion = "no-preference",
  disableWebgl = false,
  waitMs = FRAME_AT_MS,
  expectMode = "live",
  saveToDoc = false,
  animationState = "live",
  settleFirst = false,
  shell = "bleed",
}) {
  const context = await openContext({ viewport, theme, reducedMotion, disableWebgl })
  const tab = await context.newPage()
  const consoleErrors = []
  const failedRequests = []
  tab.on("pageerror", (error) => consoleErrors.push(String(error)))
  tab.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  tab.on("requestfailed", (request) =>
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`),
  )

  await tab.goto(url, { waitUntil: "load", timeout: 45_000 })
  if (expectMode) {
    await tab.waitForSelector(`${selector}[data-mode="${expectMode}"]`, { timeout: 20_000 })
  } else {
    await tab.waitForSelector(selector, { timeout: 20_000 })
  }
  const liveAt = Date.now()
  if (settleFirst) await tab.waitForTimeout(settleFirst)
  else await tab.waitForTimeout(waitMs)

  const meta = await tab.evaluate(collectMeta, selector)
  const buffer = await tab.screenshot({ type: "png" })
  const file = `${name}.png`
  writeFileSync(resolve(TARGET_DIR, file), buffer)
  if (saveToDoc) writeFileSync(resolve(DOC_DIR, file), buffer)

  const entry = {
    file,
    doc: saveToDoc ? `${DOC_REL}/${file}` : null,
    url,
    variant: variantKey ?? null,
    group: group ?? null,
    shell,
    resolution: viewport.label,
    width: viewport.width,
    height: viewport.height,
    theme,
    reducedMotion,
    webglDisabled: disableWebgl,
    animationState,
    animationTimepointMs: Date.now() - liveAt,
    capturedAt: new Date().toISOString(),
    commit: COMMIT,
    sha256: sha256(buffer),
    bytes: buffer.length,
    consoleErrors: consoleErrors.filter((line) => !line.includes("502")),
    failedRequests: failedRequests.filter((line) => !line.includes("502")),
    meta,
  }
  entries.push(entry)
  await context.close()
  console.log(
    `  ${file} · ${viewport.label} · ${theme} · mode=${meta.mode} · ctx=${meta.webgl2Contexts} · ` +
      `draws=${meta.drawCalls} · overflow=${meta.horizontalOverflow}`,
  )
  return { entry, buffer }
}

/** 三张图并排的对照拼图：用浏览器自己排版，避免引入图像处理依赖。 */
async function contactSheet(items, outFile, title) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:#0b1425;color:#dce7f7;
      font-family:"Segoe UI","Microsoft YaHei",sans-serif}
    h1{font-size:16px;font-weight:600;margin:0;padding:18px 20px 4px;letter-spacing:.02em}
    .row{display:flex;gap:14px;padding:12px 20px 20px;align-items:flex-start}
    figure{margin:0;flex:1 1 0;min-width:0}
    img{width:100%;display:block;border:1px solid #2b3d5c;border-radius:6px}
    figcaption{font-size:12px;color:#9db2cd;padding-top:8px;line-height:1.5}
    figcaption b{color:#eaf2ff}
  </style></head><body>
    <h1>${title}</h1>
    <div class="row">${items
      .map(
        (item) => `<figure>
          <img src="data:image/png;base64,${item.buffer.toString("base64")}">
          <figcaption><b>${item.caption}</b><br>${item.detail ?? ""}</figcaption>
        </figure>`,
      )
      .join("")}</div>
  </body></html>`
  const context = await browser.newContext({
    viewport: { width: 1800, height: 900 },
    deviceScaleFactor: 1,
  })
  const tab = await context.newPage()
  await tab.setContent(html, { waitUntil: "load" })
  await tab.waitForTimeout(400)
  await tab.screenshot({ path: resolve(TARGET_DIR, outFile), fullPage: true })
  await context.close()
  writeFileSync(resolve(DOC_DIR, outFile), readFileSync(resolve(TARGET_DIR, outFile)))
  console.log(`  拼图 ${outFile}`)
}

// ---------------------------------------------------------------------------
// E-09 R2 · C 方案定向取证（HERO_EVIDENCE=r2）
//
// 首轮三方案对照回答的是「谁更像」，这一轮回答的是「C 能不能用」：
// 四个视口里光学主体有没有出壳、有没有压住文字与信息卡、5 秒后 GPU 是不是
// 真的停了、悬停会不会把动画叫回来、降级画面是不是一片空白。
// ---------------------------------------------------------------------------

/** 线段与矩形是否相交（屏幕坐标，CSS px）。端点落在矩形内也算相交。 */
function segmentHitsRect(a, b, r) {
  const inside = (p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
  if (inside(a) || inside(b)) return true
  const cross = (p, q) => p.x * q.y - p.y * q.x
  const straddle = (p, q, s, t) => {
    const d1 = cross({ x: q.x - p.x, y: q.y - p.y }, { x: s.x - p.x, y: s.y - p.y })
    const d2 = cross({ x: q.x - p.x, y: q.y - p.y }, { x: t.x - p.x, y: t.y - p.y })
    const d3 = cross({ x: t.x - s.x, y: t.y - s.y }, { x: p.x - s.x, y: p.y - s.y })
    const d4 = cross({ x: t.x - s.x, y: t.y - s.y }, { x: q.x - s.x, y: q.y - s.y })
    return d1 * d2 < 0 && d3 * d4 < 0
  }
  const corners = [
    { x: r.left, y: r.top },
    { x: r.right, y: r.top },
    { x: r.right, y: r.bottom },
    { x: r.left, y: r.bottom },
  ]
  return corners.some((c, i) => straddle(a, b, c, corners[(i + 1) % 4]))
}

function rectsOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** 页面里量：舞台盒、棱镜盒、每条射线的两个端点、各内容块的盒子。 */
async function measureOptics(tab) {
  return await tab.evaluate(() => {
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const pick = (sel) => box(document.querySelector(sel))
    const rays = [...document.querySelectorAll(".hero-fusion__rays:not(.hero-fusion__rays--glow) line")].map(
      (line) => {
        const m = line.getScreenCTM()
        const total = line.getTotalLength()
        const a = line.getPointAtLength(0).matrixTransform(m)
        const b = line.getPointAtLength(total).matrixTransform(m)
        return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
      },
    )
    // SVG 的 getBoundingClientRect 不含描边宽度：光带按最宽那条描边自己外扩。
    const ribbonGroup = document.querySelector(".hero-fusion__ribbon")
    const ribbonPaths = ribbonGroup ? [...ribbonGroup.querySelectorAll("path")] : []
    const ribbonStroke = ribbonPaths.reduce(
      (max, path) => Math.max(max, Number(path.getAttribute("stroke-width") ?? 0)),
      0,
    )
    const ribbonBox = box(ribbonGroup)
    const ribbon = ribbonBox
      ? {
          ...ribbonBox,
          left: ribbonBox.left - ribbonStroke / 2,
          right: ribbonBox.right + ribbonStroke / 2,
          top: ribbonBox.top - ribbonStroke / 2,
          bottom: ribbonBox.bottom + ribbonStroke / 2,
          strokeWidth: ribbonStroke,
        }
      : null
    return {
      stage: pick(".hero-fusion__stage"),
      prism: pick(".hero-fusion__prism"),
      ribbon,
      rays,
      regions: {
        title: pick(".landing-hero__title"),
        sub: pick(".landing-hero__sub"),
        cta: pick(".landing-hero__cta"),
        card: pick(".landing-hero__card"),
        entries: pick(".landing-hero__entries"),
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })
}

/** 把一次几何量测变成「谁压了谁」的判据。硬约束失败 = P1。 */
function judgeOptics(measured, breakpoint) {
  const { stage, prism, ribbon, rays, regions } = measured
  const hard = []
  const info = []
  if (!stage || !prism) return { breakpoint, hard: ["光学层缺失"], info: [] }

  const content = { title: regions.title, sub: regions.sub, cta: regions.cta, card: regions.card }
  for (const [name, rect] of Object.entries(content)) {
    if (!rect) continue
    rays.forEach((ray, index) => {
      if (segmentHitsRect(ray.a, ray.b, rect)) {
        hard.push(`射线 #${index} 穿过 ${name}`)
      }
    })
    if (rectsOverlap(prism, rect)) hard.push(`棱镜压住 ${name}`)
  }
  // entries 是信息卡下面那行条目，原来只查了棱镜。色散扇同样不许扫过它。
  if (regions.entries) {
    if (rectsOverlap(prism, regions.entries)) hard.push("棱镜压住 entries")
    rays.forEach((ray, index) => {
      if (segmentHitsRect(ray.a, ray.b, regions.entries)) hard.push(`射线 #${index} 穿过 entries`)
    })
  }

  // 出壳：端点或棱镜越出舞台（舞台是 `overflow: hidden`，越出即被切）。
  const margin = 2
  const inStage = (p) =>
    p.x >= stage.left + margin &&
    p.x <= stage.right - margin &&
    p.y >= stage.top + margin &&
    p.y <= stage.bottom - margin
  rays.forEach((ray, index) => {
    if (!inStage(ray.b)) hard.push(`射线 #${index} 末端越出舞台`)
  })
  if (
    prism.left < stage.left ||
    prism.right > stage.right ||
    prism.top < stage.top ||
    prism.bottom > stage.bottom
  ) {
    hard.push("棱镜越出舞台")
  }
  if (stage.right > measured.viewport.width + 0.5) info.push("舞台宽于视口")

  // 光带是半透明的宽玻璃体，bbox 压到文字不等于像素压到文字：只记录，不判死。
  for (const name of ["title", "sub", "cta"]) {
    if (regions[name] && ribbon && rectsOverlap(ribbon, regions[name])) {
      info.push(`光带包围盒与 ${name} 相交（需看像素复核）`)
    }
  }
  return { breakpoint, hard, info }
}

/**
 * 区域像素复核：光学层显示 / 隐藏两张同尺寸截图，比较文字与卡片区域。
 *
 * <p>只看亮度均值与 p5–p95 展布会**漏掉细线**：一条 2px 的光带穿过整块标题区，
 * 均值可能只动 1–2 个色阶，展布完全不变。所以这里同时按像素逐点统计
 * 「变化超过 24/255 的像素占比」与最大单点差——那才是「有没有东西压上来」的证据。
 */
async function compareRegions(shownBuffer, hiddenBuffer, regions) {
  const context = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const tab = await context.newPage()
  const result = await tab.evaluate(
    async ({ a, b, regions }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = () => rej(new Error("decode failed"))
          img.src = src
        })
      const [shown, hidden] = await Promise.all([load(a), load(b)])
      const canvas = document.createElement("canvas")
      canvas.width = shown.width
      canvas.height = shown.height
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      const grab = (img, rect) => {
        const x = Math.max(0, Math.round(rect.left))
        const y = Math.max(0, Math.round(rect.top))
        const w = Math.min(canvas.width - x, Math.round(rect.width))
        const h = Math.min(canvas.height - y, Math.round(rect.height))
        if (w <= 0 || h <= 0) return null
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(x, y, w, h).data
        const lum = []
        for (let i = 0; i < data.length; i += 4) {
          lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
        }
        const sorted = [...lum].sort((p, q) => p - q)
        const at = (f) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]
        return {
          lum,
          mean: Number((lum.reduce((s, v) => s + v, 0) / lum.length).toFixed(2)),
          p5: Number(at(0.05).toFixed(2)),
          p95: Number(at(0.95).toFixed(2)),
        }
      }
      const out = {}
      for (const [key, rect] of Object.entries(regions)) {
        if (!rect) continue
        const withOptics = grab(shown, rect)
        const withoutOptics = grab(hidden, rect)
        if (!withOptics || !withoutOptics || withOptics.lum.length !== withoutOptics.lum.length) {
          continue
        }
        let changed = 0
        let maxDelta = 0
        for (let i = 0; i < withOptics.lum.length; i += 1) {
          const diff = Math.abs(withOptics.lum[i] - withoutOptics.lum[i])
          if (diff > 24) changed += 1
          if (diff > maxDelta) maxDelta = diff
        }
        out[key] = {
          withOptics: { mean: withOptics.mean, p5: withOptics.p5, p95: withOptics.p95 },
          withoutOptics: { mean: withoutOptics.mean, p5: withoutOptics.p5, p95: withoutOptics.p95 },
          deltaMean: Number(Math.abs(withOptics.mean - withoutOptics.mean).toFixed(2)),
          deltaSpread: Number(
            Math.abs(
              withOptics.p95 - withOptics.p5 - (withoutOptics.p95 - withoutOptics.p5),
            ).toFixed(2),
          ),
          maxDelta: Number(maxDelta.toFixed(1)),
          changedPixelRatio: Number((changed / withOptics.lum.length).toFixed(4)),
        }
      }
      return out
    },
    {
      a: `data:image/png;base64,${shownBuffer.toString("base64")}`,
      b: `data:image/png;base64,${hiddenBuffer.toString("base64")}`,
      regions,
    },
  )
  await context.close()
  return result
}

/**
 * 交错的性能轮次：A / C 交替，轮次顺序每轮反过来，压掉预热与热降频的顺序偏差。
 *
 * <p>**必须偶数轮**：三轮时 A 有两次排在前面（1、3），先跑的那一方占掉预热，
 * 读数的差异会变成测序的差异。四轮两种顺序各两次。
 */
async function interleavedPerf(rounds = 4) {
  const out = []
  for (let round = 1; round <= rounds; round += 1) {
    const order = round % 2 === 1 ? ["optic", "fusion"] : ["fusion", "optic"]
    const row = { round, order, samples: {} }
    for (const key of order) {
      const variant = VARIANTS.find((item) => item.key === key)
      const context = await openContext({ viewport: VIEWPORTS[2], theme: "light" })
      const tab = await context.newPage()
      await tab.goto(compareUrl(key), { waitUntil: "load", timeout: 45_000 })
      await tab.waitForSelector(`${variant.selector}[data-mode="live"]`, { timeout: 20_000 })
      await tab.waitForTimeout(1600)
      const samples = []
      for (let index = 0; index < 2; index += 1) samples.push(await sampleOnce(tab, 1200))
      row.samples[key] = {
        medianFps: median(samples.map((s) => s.averageFps)),
        medianP95FrameMs: median(samples.map((s) => s.p95FrameMs)),
        medianDrawCallsPerSec: median(samples.map((s) => s.drawCallsPerSec)),
        droppedFrames: samples.reduce((sum, s) => sum + s.droppedFrames, 0),
      }
      await context.close()
    }
    out.push(row)
    console.log(
      `  第 ${round} 轮（${order.join(" → ")}）：` +
        Object.entries(row.samples)
          .map(([key, value]) => `${key} ${value.medianFps}fps / ${value.medianDrawCallsPerSec} draws/s`)
          .join(" · "),
    )
  }
  return out
}

/** 棱镜局部裁剪：只截棱镜包围盒外扩 `pad` 的那一块，用来判断玻璃材质。 */
async function captureCrop({ name, viewport, theme, pad = 150 }) {
  const context = await openContext({ viewport, theme })
  const tab = await context.newPage()
  await tab.goto(compareUrl("fusion"), { waitUntil: "load", timeout: 45_000 })
  await tab.waitForSelector(".hero-fusion[data-mode]", { timeout: 20_000 })
  await tab.waitForTimeout(FRAME_AT_MS)
  const box = await tab.evaluate(() => {
    const node = document.querySelector(".hero-fusion__prism")
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  if (!box || box.width < 2) {
    await context.close()
    return null
  }
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  const clip = {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + pad * 2),
    height: Math.min(viewport.height - y, box.height + pad * 2),
  }
  const buffer = await tab.screenshot({ type: "png", clip })
  const file = `${name}.png`
  writeFileSync(resolve(TARGET_DIR, file), buffer)
  writeFileSync(resolve(DOC_DIR, file), buffer)
  entries.push({
    file,
    doc: `${DOC_REL}/${file}`,
    url: compareUrl("fusion"),
    variant: "fusion",
    group: "crop",
    resolution: viewport.label,
    width: Math.round(clip.width),
    height: Math.round(clip.height),
    theme,
    reducedMotion: "no-preference",
    webglDisabled: false,
    animationState: "live",
    animationTimepointMs: FRAME_AT_MS,
    capturedAt: new Date().toISOString(),
    commit: COMMIT,
    sha256: sha256(buffer),
    bytes: buffer.length,
    consoleErrors: [],
    failedRequests: [],
    meta: await tab.evaluate(collectMeta, ".hero-fusion"),
  })
  await context.close()
  console.log(`  裁剪 ${file}`)
  return file
}

async function runFusionR2() {
  const report = { matrix: [], states: {}, crops: [], geometry: {}, regions: {}, c4: {}, perf: [], video: null }

  // --- 1) 矩阵：3 方案 × 4 视口 × 2 主题 = 24 张 -----------------------------
  console.log("· R2 矩阵（3 方案 × 4 视口 × 2 主题）")
  for (const viewport of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      for (const variant of VARIANTS) {
        const { entry } = await capture({
          name: `r2-matrix-${variant.code}-${variant.key}-${viewport.key}-${theme}`,
          variantKey: variant.key,
          group: "matrix",
          url: compareUrl(variant.key),
          selector: variant.selector,
          viewport,
          theme,
          saveToDoc: true,
        })
        report.matrix.push({
          file: entry.file,
          variant: variant.code,
          viewport: viewport.key,
          theme,
          mode: entry.meta.mode,
          overflow: entry.meta.horizontalOverflow,
        })
      }
    }
  }

  // --- 2) C 的三个状态帧：定格 / reduced-motion / WebGL 降级 -----------------
  console.log("· C 状态帧")
  const states = [
    {
      key: "settled",
      name: "r2-c-settled-desktop-light",
      expectMode: "settled",
      waitMs: 1500,
      animationState: "settled（5s 自动定格）",
    },
    {
      key: "reduced-motion",
      name: "r2-c-reduced-motion-desktop-light",
      expectMode: "frozen",
      waitMs: 1200,
      reducedMotion: "reduce",
      animationState: "prefers-reduced-motion: reduce",
    },
    {
      key: "webgl-disabled",
      name: "r2-c-webgl-disabled-desktop-light",
      expectMode: "static",
      waitMs: 1200,
      disableWebgl: true,
      animationState: "WebGL2 不可用（静态降级）",
    },
  ]
  for (const state of states) {
    const { entry } = await capture({
      name: state.name,
      variantKey: "fusion",
      group: "states",
      url: compareUrl("fusion"),
      selector: ".hero-fusion",
      viewport: VIEWPORTS[2],
      theme: "light",
      expectMode: state.expectMode,
      waitMs: state.waitMs,
      reducedMotion: state.reducedMotion ?? "no-preference",
      disableWebgl: state.disableWebgl ?? false,
      animationState: state.animationState,
      saveToDoc: true,
    })
    report.states[state.key] = { file: entry.file, mode: entry.meta.mode, drawCalls: entry.meta.drawCalls }
  }

  // --- 3) 局部裁剪：桌面与手机的棱镜 ----------------------------------------
  console.log("· 棱镜局部裁剪")
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[0]]) {
    for (const theme of ["light", "dark"]) {
      const file = await captureCrop({
        name: `r2-crop-prism-${viewport.key}-${theme}`,
        viewport,
        theme,
        pad: viewport.key === "phone" ? 90 : 150,
      })
      if (file) report.crops.push(file)
    }
  }

  // --- 4) 遮挡复核：几何 + 像素（定格态，画面不再变化） ----------------------
  console.log("· 遮挡复核（几何 + 像素）")
  for (const viewport of VIEWPORTS) {
    const context = await openContext({ viewport, theme: "light" })
    const tab = await context.newPage()
    await tab.goto(compareUrl("fusion"), { waitUntil: "load", timeout: 45_000 })
    await tab.waitForSelector('.hero-fusion[data-mode="settled"]', { timeout: 20_000 })
    await tab.waitForTimeout(400)

    const measured = await measureOptics(tab)
    const breakpoint =
      viewport.key === "phone" ? "phone" : viewport.key === "tablet" ? "tablet" : "wide"
    const verdict = judgeOptics(measured, breakpoint)
    // 三张同尺寸截图：全显示 / 只藏光学主体 / 连环境光一起藏。
    // 两组差分分别回答「主体层压没压内容」与「环境光有没有把文字对比度吃掉」。
    const shownBuffer = await tab.screenshot({ type: "png" })
    await tab.addStyleTag({
      content: ".hero-fusion__optics{visibility:hidden !important}",
    })
    await tab.waitForTimeout(200)
    const noSubjectBuffer = await tab.screenshot({ type: "png" })
    await tab.addStyleTag({
      content: ".hero-fusion__canvas{visibility:hidden !important}",
    })
    await tab.waitForTimeout(200)
    const bareBuffer = await tab.screenshot({ type: "png" })
    writeFileSync(resolve(TARGET_DIR, `r2-optics-hidden-${viewport.key}.png`), bareBuffer)
    const regions = {
      subject: await compareRegions(shownBuffer, noSubjectBuffer, measured.regions),
      ambient: await compareRegions(noSubjectBuffer, bareBuffer, measured.regions),
    }
    report.geometry[viewport.key] = {
      ...verdict,
      prism: measured.prism && {
        left: Math.round(measured.prism.left),
        top: Math.round(measured.prism.top),
        width: Math.round(measured.prism.width),
        height: Math.round(measured.prism.height),
      },
      stage: measured.stage && {
        left: Math.round(measured.stage.left),
        top: Math.round(measured.stage.top),
        width: Math.round(measured.stage.width),
        height: Math.round(measured.stage.height),
      },
      rayCount: measured.rays.length,
      rayEnds: measured.rays.map((ray) => ({
        x: Math.round(ray.b.x),
        y: Math.round(ray.b.y),
      })),
    }
    report.regions[viewport.key] = regions
    console.log(
      `  ${viewport.label}: 硬约束 ${verdict.hard.length === 0 ? "通过" : verdict.hard.join("；")}` +
        ` · 主体层 Δ展布 ${Object.entries(regions.subject)
          .map(([key, value]) => `${key} ${value.deltaSpread}`)
          .join(" / ")}` +
        ` · 环境光 Δ展布 ${Object.entries(regions.ambient)
          .map(([key, value]) => `${key} ${value.deltaSpread}`)
          .join(" / ")}`,
    )
    await context.close()
  }

  // --- 5) C-4：5 秒定格之后 GPU 到底停没停 ----------------------------------
  console.log("· C-4 停机行为")
  {
    const context = await openContext({ viewport: VIEWPORTS[2], theme: "light" })
    const tab = await context.newPage()
    await tab.goto(compareUrl("fusion", { bare: false }), { waitUntil: "load", timeout: 45_000 })
    await tab.waitForSelector('.hero-fusion[data-mode="live"]', { timeout: 20_000 })
    // 用**页面自己的时钟**量：CDP 往返与轮询延迟会凭空加进读数。
    const liveAtPageMs = await tab.evaluate(() => performance.now())
    await tab.waitForSelector('.hero-fusion[data-mode="settled"]', { timeout: 15_000 })
    const settledAtPageMs = await tab.evaluate(() => performance.now())
    // ⚠ 两个读数都从「导航开始」起算，不是从组件挂载起算：`waitForSelector`
    // 每 100ms 轮询一次，所以它必然**晚于**真实状态切换。窗口本身的实现是
    // 挂载后 5000ms（只在可见时计时）。
    const settleDelayMs = Math.round(settledAtPageMs - liveAtPageMs)
    const settleDelayFromNavMs = Math.round(settledAtPageMs)

    const settledSample = await sampleOnce(tab, 2000)

    const canvasCentre = await tab.evaluate(() => {
      const canvas = document.querySelector(".hero-fusion__canvas")
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    let hoverSample = null
    if (canvasCentre) {
      // 指针必须在**整个采样窗口内持续移动**。原来的写法是「先移四次、停 1.2s、
      // 最后才采样 1.5s」，窗口内指针完全静止——那只证明了「指针不动时不画」，
      // 证明不了「悬停不会把已定格的动效唤醒」。现在采样与手势同时进行。
      const pending = sampleOnce(tab, 1500)
      for (let step = 0; step < 12; step += 1) {
        const t = step / 11
        await tab.mouse.move(
          canvasCentre.x - 120 + 240 * t,
          canvasCentre.y - 60 + 120 * Math.sin(t * Math.PI),
        )
        await tab.waitForTimeout(105)
      }
      hoverSample = await pending
    }

    const beforeTheme = await tab.evaluate(() => ({
      draws: window.__drawCalls,
      contexts: window.__webgl2Created,
    }))
    await tab.getByRole("button", { name: "切换到暗色主题" }).click()
    await tab.waitForTimeout(1000)
    const afterTheme = await tab.evaluate(() => ({
      draws: window.__drawCalls,
      contexts: window.__webgl2Created,
      mode: document.querySelector(".hero-fusion")?.getAttribute("data-mode"),
      theme: document.querySelector(".hero-fusion")?.getAttribute("data-theme"),
    }))

    const beforeNav = await tab.evaluate(() => window.__drawCalls)
    await tab.evaluate(() => document.querySelector('a[href="/news"]')?.click())
    await tab.waitForTimeout(1200)
    const afterNav = await tab.evaluate(() => ({
      draws: window.__drawCalls,
      canvases: document.querySelectorAll("canvas").length,
    }))
    await tab.waitForTimeout(1200)
    const afterNavLater = await tab.evaluate(() => window.__drawCalls)

    report.c4 = {
      settleDelayMs,
      settleDelayFromNavMs,
      settled: {
        drawCallsIn2s: settledSample.drawCalls,
        drawCallsPerSec: settledSample.drawCallsPerSec,
        fps: settledSample.averageFps,
        mode: settledSample.mode,
      },
      hoverAfterSettled: {
        // 采样窗口内指针一直在动；读数为 0 才说明悬停没把定格唤醒。
        pointerMovingThroughoutWindow: true,
        drawCallsIn1_5s: hoverSample?.drawCalls ?? null,
        drawCallsPerSec: hoverSample?.drawCallsPerSec ?? null,
        mode: hoverSample?.mode ?? null,
      },
      themeSwitchWhileSettled: {
        drawCalls: afterTheme.draws - beforeTheme.draws,
        newContexts: afterTheme.contexts - beforeTheme.contexts,
        mode: afterTheme.mode,
        theme: afterTheme.theme,
      },
      routeLeave: {
        canvasesAfter: afterNav.canvases,
        stoppedDrawing: afterNavLater === afterNav.draws,
      },
    }
    console.log(
      `  定格 ${settleDelayMs}ms 后 2s 内 ${settledSample.drawCalls} draws · ` +
        `悬停(全程移动) 1.5s ${hoverSample?.drawCalls ?? "n/a"} draws · 换主题重绘 ${afterTheme.draws - beforeTheme.draws} 次 · ` +
        `换页后画布 ${afterNav.canvases} 个`,
    )
    await context.close()
  }

  // --- 5.5) C 的三条额外停机路径 -------------------------------------------
  console.log("· C 的额外停机路径")
  {
    // reduced-motion：挂载即定格，之后 2s 内不许再有 draw。
    const context = await openContext({
      viewport: VIEWPORTS[2],
      theme: "light",
      reducedMotion: "reduce",
    })
    const tab = await context.newPage()
    await tab.goto(compareUrl("fusion"), { waitUntil: "load", timeout: 45_000 })
    await tab.waitForSelector('.hero-fusion[data-mode="frozen"]', { timeout: 20_000 })
    await tab.waitForTimeout(2500)
    const sample = await sampleOnce(tab, 2000)
    const cssAnimations = await tab.evaluate(
      () => document.querySelector(".hero-fusion")?.getAnimations({ subtree: true }).length ?? -1,
    )
    report.c4.reducedMotion = {
      drawCallsIn2s: sample.drawCalls,
      drawCallsPerSec: sample.drawCallsPerSec,
      cssAnimations,
    }
    await context.close()

    // 上下文丢失：不靠「禁用 WebGL」，而是在跑起来之后真的丢一次上下文。
    const lostContext = await openContext({ viewport: VIEWPORTS[2], theme: "light" })
    const lostTab = await lostContext.newPage()
    await lostTab.goto(compareUrl("fusion"), { waitUntil: "load", timeout: 45_000 })
    await lostTab.waitForSelector('.hero-fusion[data-mode="live"]', { timeout: 20_000 })
    await lostTab.waitForTimeout(1200)
    const lost = await lostTab.evaluate(() => {
      const canvas = document.querySelector(".hero-fusion__canvas")
      const gl = canvas?.getContext("webgl2")
      const ext = gl?.getExtension("WEBGL_lose_context")
      if (!ext) return { supported: false }
      ext.loseContext()
      return { supported: true }
    })
    await lostTab.waitForTimeout(800)
    const afterLost = await lostTab.evaluate(() => ({
      mode: document.querySelector(".hero-fusion")?.getAttribute("data-mode") ?? null,
      canvases: document.querySelectorAll(".hero-fusion canvas").length,
      staticWash: !!document.querySelector(".hero-fusion__static-wash"),
      prism: !!document.querySelector(".hero-fusion__prism"),
    }))
    report.c4.contextLost = { ...lost, ...afterLost }
    await lostContext.close()

    // 页面隐藏**不在这里测**。headful Playwright 造不出真正的 hidden：
    // `bringToFront()` 之后原页 `document.hidden` 仍是 false（`Page.setWebLifecycleState`
    // 也不改可见性），`Emulation.setPageVisibilityOverride` 不存在。以前这里量到的
    // 「少量 draws」是窗口失焦的 rAF 节流，被误读成「隐藏时仍在绘制」。
    // 该路径改由可控桩的单测覆盖：`src/components/brand/beamsMount.test.ts`。
    report.c4.pageHidden = {
      measured: false,
      note: "Playwright 无法制造真实的 document.hidden；由 beamsMount.test.ts 的可控桩覆盖",
    }
    console.log(
      `  reduced-motion 2s 内 ${sample.drawCalls} draws / CSS 动画 ${cssAnimations} · ` +
        `上下文丢失后 mode=${afterLost.mode} 画布 ${afterLost.canvases} 个 · ` +
        `页面隐藏改由单测覆盖（浏览器侧造不出真 hidden）`,
    )
  }

  // --- 6) 交错性能轮次 ------------------------------------------------------
  console.log("· 交错性能轮次（A ↔ C，4 轮，顺序每轮反转）")
  report.perf = await interleavedPerf(4)

  // --- 7) 录屏：C 的 5 秒动效窗口 -------------------------------------------
  console.log("· C 录屏")
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      recordVideo: { dir: resolve(TARGET_DIR, "video"), size: { width: 1440, height: 900 } },
    })
    await context.addInitScript(initScript, { theme: "light", disableWebgl: false })
    const tab = await context.newPage()
    await tab.goto(compareUrl("fusion"), { waitUntil: "load", timeout: 45_000 })
    await tab.waitForSelector('.hero-fusion[data-mode="live"]', { timeout: 20_000 })
    await tab.waitForTimeout(5000)
    const video = tab.video()
    await tab.close()
    if (video) {
      const target = resolve(TARGET_DIR, "r2-c-motion-desktop-light.webm")
      await video.saveAs(target)
      report.video = target
      console.log("  录屏 r2-c-motion-desktop-light.webm")
    }
    await context.close()
  } catch (error) {
    console.log(`  跳过录屏：${String(error).split("\n")[0]}`)
  }

  // --- 8) 拼图 --------------------------------------------------------------
  console.log("· R2 拼图")
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[0]]) {
    for (const theme of ["light", "dark"]) {
      const items = VARIANTS.map((variant) => ({
        buffer: readFileSync(
          resolve(TARGET_DIR, `r2-matrix-${variant.code}-${variant.key}-${viewport.key}-${theme}.png`),
        ),
        caption: `${variant.code} · ${variant.name}`,
        detail: `${viewport.label} · ${theme}`,
      }))
      await contactSheet(
        items,
        `r2-compare-${viewport.key}-${theme}.png`,
        `E-09 R2 · 三方案 · ${viewport.label} · ${theme}`,
      )
    }
  }
  for (const theme of ["light", "dark"]) {
    const items = VIEWPORTS.map((viewport) => ({
      buffer: readFileSync(resolve(TARGET_DIR, `r2-matrix-C-fusion-${viewport.key}-${theme}.png`)),
      caption: `C · ${viewport.label}`,
      detail: `${viewport.key} · ${theme}`,
    }))
    await contactSheet(items, `r2-c-viewports-${theme}.png`, `E-09 R2 · C 方案四视口 · ${theme}`)
  }
  {
    const items = states.map((state) => ({
      buffer: readFileSync(resolve(TARGET_DIR, `${state.name}.png`)),
      caption: state.key,
      detail: state.animationState,
    }))
    await contactSheet(items, "r2-c-states.png", "E-09 R2 · C 的三个终止状态")
  }

  return report
}

// ---------------------------------------------------------------------------
// 1) 核心矩阵：3 方案 × 4 视口 × 2 主题 × 2 构图
// ---------------------------------------------------------------------------
if (!PERF_ONLY && EVIDENCE === "compare") {
    console.log("· 核心矩阵")
  for (const shell of SHELLS) {
    for (const viewport of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        for (const variant of VARIANTS) {
          await capture({
            name: `matrix-${shell.key}-${variant.code}-${variant.key}-${viewport.key}-${theme}`,
            variantKey: variant.key,
            group: "matrix",
            shell: shell.key,
            url: compareUrl(variant.key, { shell: shell.key }),
            selector: variant.selector,
            viewport,
            theme,
            saveToDoc: viewport.key === "desktop",
          })
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2) 原生页面参考：ui@b805377f 的 /（Prism）与 9a6dbcb6 的 /（OpticFlow）
  // ---------------------------------------------------------------------------
  console.log("· 原生页面参考")
  for (const theme of ["light", "dark"]) {
    await capture({
      name: `native-prism-ui-b805377f-desktop-${theme}`,
      variantKey: "prism",
      group: "native",
      url: `${COMPARE_BASE}/`,
      selector: ".hero-prism",
      viewport: VIEWPORTS[2],
      theme,
      saveToDoc: true,
      animationState: "live (Prism 自动循环 5s 窗口内)",
    })
    await capture({
      name: `native-optic-9a6dbcb6-desktop-${theme}`,
      variantKey: "optic",
      group: "native",
      url: `${OPTIC_BASE}/`,
      selector: ".optic-flow",
      viewport: VIEWPORTS[2],
      theme,
      saveToDoc: true,
      animationState: "live",
    })
  }
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await capture({
      name: `native-optic-9a6dbcb6-${viewport.key}-light`,
      variantKey: "optic",
      group: "native",
      url: `${OPTIC_BASE}/`,
      selector: ".optic-flow",
      viewport,
      theme: "light",
    })
  }

  // ---------------------------------------------------------------------------
  // 3) 冻结帧：A/C 用 ?paused=1，B 等过 Prism 的 5s 自动停住
  // ---------------------------------------------------------------------------
  console.log("· 冻结帧")
  for (const variant of VARIANTS) {
    await capture({
      name: `settled-${variant.code}-${variant.key}-desktop-light`,
      variantKey: variant.key,
      group: "settled",
      url: compareUrl(variant.key, { paused: variant.key !== "prism" }),
      selector: variant.selector,
      viewport: VIEWPORTS[2],
      theme: "light",
      settleFirst: variant.key === "prism" ? 6500 : 600,
      expectMode: null,
      animationState: "settled / paused",
      saveToDoc: true,
    })
  }

  // ---------------------------------------------------------------------------
  // 4) Reduced Motion 与 WebGL 降级
  // ---------------------------------------------------------------------------
  console.log("· Reduced Motion / WebGL 降级")
  for (const variant of VARIANTS) {
    await capture({
      name: `reduced-motion-${variant.code}-${variant.key}-desktop-light`,
      variantKey: variant.key,
      group: "reduced-motion",
      url: compareUrl(variant.key),
      selector: variant.selector,
      viewport: VIEWPORTS[2],
      theme: "light",
      reducedMotion: "reduce",
      expectMode: null,
      animationState: "prefers-reduced-motion: reduce",
      saveToDoc: true,
    })
    await capture({
      name: `webgl-disabled-${variant.code}-${variant.key}-desktop-light`,
      variantKey: variant.key,
      group: "webgl-disabled",
      url: compareUrl(variant.key),
      selector: variant.selector,
      viewport: VIEWPORTS[2],
      theme: "light",
      disableWebgl: true,
      expectMode: null,
      animationState: "WebGL2 不可用（静态降级）",
      saveToDoc: true,
    })
  }
}

// ---------------------------------------------------------------------------
// 5) 性能：动效窗口 / 停机后 / 页面不可见 / 路由离开后的回收 / 主题切换
// ---------------------------------------------------------------------------
const perf = {}
if (EVIDENCE === "compare") {
console.log("· 性能与资源回收")
for (const variant of VARIANTS) {
  const context = await openContext({ viewport: VIEWPORTS[2], theme: "light" })
  const tab = await context.newPage()
  // 这里**不能**用 bare=1：暂停按钮在对照台工具栏上，藏掉工具栏就没法停机。
  await tab.goto(compareUrl(variant.key, { bare: false }), {
    waitUntil: "load",
    timeout: 45_000,
  })
  await tab.waitForSelector(`${variant.selector}[data-mode="live"]`, { timeout: 20_000 })
  await tab.waitForTimeout(1600)

  // 动效窗口内：intro 之后、Prism 的 5s 停机之前。
  const samples = []
  for (let index = 0; index < 3; index += 1) samples.push(await sampleOnce(tab, 1000))

  const animation = {
    samples,
    medianFps: median(samples.map((s) => s.averageFps)),
    minFps: Math.min(...samples.map((s) => s.averageFps)),
    medianP95FrameMs: median(samples.map((s) => s.p95FrameMs)),
    droppedFrames: samples.reduce((sum, s) => sum + s.droppedFrames, 0),
    sampledFrames: samples.reduce((sum, s) => sum + s.sampledFrames, 0),
    longTasksMs: samples.flatMap((s) => s.longTasksMs),
    drawCallsPerSec: median(samples.map((s) => s.drawCallsPerSec)),
  }

  // 停机之后：Prism 5s 自动停；A / C 切到暂停帧。
  let pauseQuirk = null
  if (variant.key === "prism") {
    await tab.waitForTimeout(4000)
  } else {
    await tab.getByRole("button", { name: "暂停动效" }).click()
    // Beams 引擎的 `paused` 只是**停止状态推进**，不直接停 rAF 循环；循环要等
    // `settling` 条件全部落空才收尾，其中 `state.reach`（指针参与度）从 ≈1 衰减到
    // 0.002 需要 ln(500)/1.8 ≈ 3.45 s。先量一段「点完暂停立刻采样」，把这段尾巴
    // 如实记下来。
    pauseQuirk = await sampleOnce(tab, 1000)
    // 要量的是「动效停了以后还画不画」，所以先把指针移出画布，再等 reach 衰减完。
    await tab.mouse.move(4, 4)
    await tab.waitForTimeout(4200)
  }
  const settledSample = await sampleOnce(tab, 2000)
  const settledPointerInside = await tab.evaluate((selector) => {
    const canvas = document.querySelector(selector)?.querySelector("canvas")
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { inside: 4 >= rect.left && 4 <= rect.right && 4 >= rect.top && 4 <= rect.bottom }
  }, variant.selector)

  // 页面不可见：另开一页抢焦点，原页应停机。
  const other = await context.newPage()
  await other.goto("about:blank")
  await other.bringToFront()
  await tab.waitForTimeout(700)
  const hiddenSample = await sampleOnce(tab, 1500)
  const hiddenMeta = await tab.evaluate(collectMeta, variant.selector)
  await tab.bringToFront()
  await other.close()
  await tab.waitForTimeout(400)

  // 路由离开：SPA 内跳到 /news，首屏组件卸载 → dispose。
  const beforeNav = await tab.evaluate(() => window.__drawCalls)
  await tab.evaluate(() => {
    const link = document.querySelector('a[href="/news"]')
    link?.click()
  })
  await tab.waitForTimeout(1200)
  const afterNav = await tab.evaluate(() => ({
    drawCalls: window.__drawCalls,
    canvases: document.querySelectorAll("canvas").length,
    hero: document.querySelectorAll(".landing-hero").length,
  }))
  await tab.waitForTimeout(1200)
  const afterNav2 = await tab.evaluate(() => window.__drawCalls)

  // 主题切换：不应该重建渲染器（不新建 webgl2 上下文）。
  await tab.goBack()
  await tab.waitForSelector(`${variant.selector}`, { timeout: 20_000 })
  await tab.waitForTimeout(800)
  const beforeTheme = await tab.evaluate(() => ({
    contexts: window.__webgl2Created,
    theme: document.documentElement.classList.contains("dark"),
  }))
  await tab.getByRole("button", { name: "切换到暗色主题" }).click()
  await tab.waitForTimeout(600)
  const afterTheme = await tab.evaluate(() => ({
    contexts: window.__webgl2Created,
    theme: document.documentElement.classList.contains("dark"),
    heroTheme: document.querySelector("[data-theme]")?.getAttribute("data-theme"),
    canvases: document.querySelectorAll("canvas").length,
  }))

  const meta = await tab.evaluate(collectMeta, variant.selector)

  // 「页面一打开就是暂停态」的独立读数：指针从未进入画布，`state.reach` 恒为 0，
  // 循环应当在 intro 结束后立刻收尾——这才是「暂停态本身会不会停机」的干净读数。
  // B（Prism）没有手动暂停概念（`HeroPrism` 不接 `paused`），它 5s 后自动停，
  // 所以这里只量 A / C。
  let freshPaused = null
  if (variant.key !== "prism") {
    const probe = await context.newPage()
    await probe.goto(compareUrl(variant.key, { paused: true }), {
      waitUntil: "load",
      timeout: 45_000,
    })
    await probe.waitForSelector(variant.selector, { timeout: 20_000 })
    await probe.waitForTimeout(3200)
    freshPaused = await sampleOnce(probe, 2000)
    await probe.close()
  }

  perf[variant.key] = {
    variant: `${variant.code} ${variant.name}`,
    animation,
    settled: { sample: settledSample, pointerOutsideCanvas: settledPointerInside },
    pauseQuirk: pauseQuirk
      ? {
          sample: pauseQuirk,
          note:
            "点完「暂停动效」后的 1s 窗口：Beams 的 reach 指针参与度尚未衰减完，rAF 仍在逐帧 draw",
        }
      : null,
    freshPaused: freshPaused
      ? { sample: freshPaused, note: "直接以 ?paused=1 打开，指针从未进入画布" }
      : null,
    hidden: { sample: hiddenSample, meta: hiddenMeta },
    navigationCleanup: {
      drawCallsBefore: beforeNav,
      drawCallsAfter: afterNav.drawCalls,
      drawCallsLater: afterNav2,
      canvasesAfter: afterNav.canvases,
      heroAfter: afterNav.hero,
      stoppedDrawing: afterNav2 === afterNav.drawCalls,
    },
    themeSwitch: { before: beforeTheme, after: afterTheme, newContexts: afterTheme.contexts - beforeTheme.contexts },
    meta,
  }
  console.log(
    `  ${variant.code} ${variant.name}: 动效 ${animation.medianFps}fps · p95 ${animation.medianP95FrameMs}ms · ` +
      `draws/s ${animation.drawCallsPerSec} · 停机后 draws/s ${settledSample.drawCallsPerSec} · ` +
      `暂停瞬间 draws/s ${pauseQuirk?.drawCallsPerSec ?? "—"} · 全新暂停态 draws/s ${freshPaused?.drawCallsPerSec ?? "—"} · ` +
      `离屏 draws/s ${hiddenSample.drawCallsPerSec} · 换页后停止绘制 ${afterNav2 === afterNav.drawCalls}`,
  )
  await context.close()
}
}

// Reduced Motion 是否真的停动画（独立复核）
const reducedChecks = {}
if (EVIDENCE === "compare") {
for (const variant of VARIANTS) {
  const context = await openContext({
    viewport: VIEWPORTS[2],
    theme: "light",
    reducedMotion: "reduce",
  })
  const tab = await context.newPage()
  await tab.goto(compareUrl(variant.key), {
    waitUntil: "load",
  })
  await tab.waitForSelector(variant.selector, { timeout: 20_000 })
  await tab.waitForTimeout(2500)
  const before = await tab.evaluate(() => window.__drawCalls)
  await tab.waitForTimeout(2000)
  const after = await tab.evaluate(() => window.__drawCalls)
  const animations = await tab.evaluate((selector) => {
    const root = document.querySelector(selector)
    return root ? root.getAnimations({ subtree: true }).length : -1
  }, variant.selector)
  reducedChecks[variant.key] = {
    drawCallsIn2s: after - before,
    cssAnimations: animations,
    mode: await tab.evaluate((selector) => document.querySelector(selector)?.getAttribute("data-mode"), variant.selector),
  }
  console.log(
    `  reduced-motion ${variant.code}: 2s 内 draw calls ${after - before} · CSS 动画 ${animations}`,
  )
  await context.close()
}
}

// ---------------------------------------------------------------------------
// 5.5) 动效录屏：每方案 5 秒，证明「动起来了」而不只是「截到一帧」
//
// 录屏是**可选**产物：Playwright 录视频要额外的 ffmpeg 二进制，本机不一定有。
// 缺了就跳过，不能让整轮取证挂在这一个非必需步骤上。
// ---------------------------------------------------------------------------
console.log("· 动效录屏")
const videos = []
if (!PERF_ONLY && EVIDENCE === "compare") {
  for (const variant of VARIANTS) {
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        recordVideo: { dir: resolve(TARGET_DIR, "video"), size: { width: 1440, height: 900 } },
      })
      await context.addInitScript(initScript, { theme: "light", disableWebgl: false })
      const tab = await context.newPage()
      await tab.goto(compareUrl(variant.key), {
        waitUntil: "load",
      })
      await tab.waitForSelector(`${variant.selector}[data-mode="live"]`, { timeout: 20_000 })
      await tab.waitForTimeout(5000)
      const video = tab.video()
      await tab.close()
      if (video) {
        const target = resolve(TARGET_DIR, `motion-${variant.code}-${variant.key}-desktop-light.webm`)
        await video.saveAs(target)
        videos.push(target)
        console.log(`  录屏 motion-${variant.code}-${variant.key}-desktop-light.webm`)
      }
      await context.close()
    } catch (error) {
      console.log(`  跳过 ${variant.code} 录屏：${String(error).split("\n")[0]}`)
    }
}


// ---------------------------------------------------------------------------
// 6) 对照拼图
// ---------------------------------------------------------------------------
  console.log("· 对照拼图")
  async function sheet(name, title, shell, theme, viewport) {
    const items = []
    for (const variant of VARIANTS) {
      const file = `matrix-${shell}-${variant.code}-${variant.key}-${viewport.key}-${theme}.png`
      const buffer = readFileSync(resolve(TARGET_DIR, file))
      items.push({
        buffer,
        caption: `${variant.code} · ${variant.name}`,
        detail: `${viewport.label} · ${theme} · ${file}`,
      })
    }
    await contactSheet(items, name, title)
  }

  for (const shell of SHELLS) {
    const tag = shell.key === "bleed" ? "全幅" : "壳内"
    await sheet(
      `compare-${shell.key}-light-desktop.png`,
      `E-09 · 三方案统一外壳 · ${tag}构图 · Light · 1440×900（同一布局 / 同一尺寸 / 同一取帧时点）`,
      shell.key,
      "light",
      VIEWPORTS[2],
    )
    await sheet(
      `compare-${shell.key}-dark-desktop.png`,
      `E-09 · 三方案统一外壳 · ${tag}构图 · Dark · 1440×900`,
      shell.key,
      "dark",
      VIEWPORTS[2],
    )
    await sheet(
      `compare-${shell.key}-light-phone.png`,
      `E-09 · 三方案统一外壳 · ${tag}构图 · Light · 390×844`,
      shell.key,
      "light",
      VIEWPORTS[0],
    )
    await sheet(
      `compare-${shell.key}-dark-phone.png`,
      `E-09 · 三方案统一外壳 · ${tag}构图 · Dark · 390×844`,
      shell.key,
      "dark",
      VIEWPORTS[0],
    )
  }
  {
    const items = []
    for (const theme of ["light", "dark"]) {
      for (const variant of VARIANTS) {
        const file = `matrix-bleed-${variant.code}-${variant.key}-desktop-${theme}.png`
        items.push({
          buffer: readFileSync(resolve(TARGET_DIR, file)),
          caption: `${variant.code} · ${variant.name} · ${theme}`,
          detail: file,
        })
      }
    }
    await contactSheet(items, "compare-all-desktop.png", "E-09 · 三方案 × 双主题 · 全幅构图 · 1440×900")
  }
  {
    const items = []
    for (const theme of ["light", "dark"]) {
      for (const variant of VARIANTS) {
        const file = `matrix-contained-${variant.code}-${variant.key}-desktop-${theme}.png`
        items.push({
          buffer: readFileSync(resolve(TARGET_DIR, file)),
          caption: `${variant.code} · ${variant.name} · ${theme}`,
          detail: file,
        })
      }
    }
    await contactSheet(items, "compare-all-contained-desktop.png", "E-09 · 三方案 × 双主题 · 壳内构图 · 1440×900")
  }
  {
    const items = []
    for (const theme of ["light", "dark"]) {
      for (const variant of VARIANTS) {
        const file = `native-${variant.key === "optic" ? "optic-9a6dbcb6" : "prism-ui-b805377f"}-desktop-${theme}.png`
        items.push({
          buffer: readFileSync(resolve(TARGET_DIR, file)),
          caption: `${variant.code} 原生 · ${theme}`,
          detail: file,
        })
      }
    }
    await contactSheet(items, "compare-native-desktop.png", "E-09 · 原生页面参考（各分支自己的构图）")
  }
}

// ---------------------------------------------------------------------------
// 7) manifest
// ---------------------------------------------------------------------------
const r2 = EVIDENCE === "r2" ? await runFusionR2() : null

if (r2) {
  const manifest = {
    task: "E-09 R2 · Fusion Refinement（C 方案定向视觉精修与真实浏览器复验）",
    status: "VISUAL_REVIEW_PENDING",
    capturedAt: new Date().toISOString(),
    commit: COMMIT,
    branch: BRANCH,
    browser: browserPath,
    browserVersion: browser.version(),
    frameTimepointMs: FRAME_AT_MS,
    viewports: VIEWPORTS,
    variants: VARIANTS,
    bases: { compare: COMPARE_BASE },
    regenerate: [
      "cd web && VITE_DESIGN_PREVIEW=true npx vite build && npx vite preview --port 4173 --strictPort",
      "cd web && HERO_EVIDENCE=r2 node scripts/evidence/hero-compare.mjs",
    ],
    entries,
    matrix: r2.matrix,
    states: r2.states,
    crops: r2.crops,
    geometry: r2.geometry,
    regions: r2.regions,
    c4: r2.c4,
    interleavedPerf: r2.perf,
    video: r2.video,
  }
  writeFileSync(resolve(TARGET_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  writeFileSync(
    resolve(DOC_DIR, "manifest-summary.json"),
    `${JSON.stringify(
      {
        task: manifest.task,
        status: manifest.status,
        commit: COMMIT,
        branch: BRANCH,
        browserVersion: browser.version(),
        capturedAt: manifest.capturedAt,
        frames: entries.length,
        states: r2.states,
        c4: r2.c4,
        interleavedPerf: r2.perf,
        geometry: Object.fromEntries(
          Object.entries(r2.geometry).map(([key, value]) => [
            key,
            { hard: value.hard, info: value.info, rayCount: value.rayCount },
          ]),
        ),
        video: r2.video,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
} else {
  // PERF_ONLY：只重测性能与降级读数，截图沿用上一轮，但 manifest 必须写全，
  // 否则报告会引用到一份只剩性能段落的清单。
  // -------------------------------------------------------------------------
  const previous = PERF_ONLY
    ? JSON.parse(readFileSync(resolve(TARGET_DIR, "manifest.json"), "utf8"))
    : null
  if (PERF_ONLY && !previous) {
    throw new Error("HERO_COMPARE_PERF_ONLY=1 但找不到上一轮的 manifest.json，请先完整跑一轮。")
  }
  const allEntries = previous ? previous.entries : entries
  const allVideos = previous ? previous.videos : videos

  const manifest = {
    task: "E-09 · OpticFlow × Prism 三方案真实浏览器对照",
    status: "VISUAL_REVIEW_PENDING",
    capturedAt: previous?.capturedAt ?? new Date().toISOString(),
    perfMeasuredAt: new Date().toISOString(),
    commit: COMMIT,
    branch: BRANCH,
    browser: browserPath,
    browserVersion: browser.version(),
    frameTimepointMs: FRAME_AT_MS,
    shells: SHELLS,
    bases: { compare: COMPARE_BASE, opticNative: OPTIC_BASE },
    regenerate: [
      "cd web && VITE_DESIGN_PREVIEW=true npx vite build && npx vite preview --port 4173 --strictPort",
      "cd <feat/iris21-multiagent-integration 的 web> && npx vite build && npx vite preview --port 4174 --strictPort",
      "node web/scripts/evidence/hero-compare.mjs",
    ],
    entries: allEntries,
    performance: perf,
    reducedMotionChecks: reducedChecks,
    videos: allVideos,
  }

writeFileSync(
  resolve(TARGET_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
)
writeFileSync(
  resolve(DOC_DIR, "manifest-summary.json"),
  `${JSON.stringify(
    {
      commit: COMMIT,
      branch: BRANCH,
      browserVersion: browser.version(),
      capturedAt: manifest.capturedAt,
      perfMeasuredAt: manifest.perfMeasuredAt,
      frames: allEntries.length,
      performance: perf,
      reducedMotionChecks: reducedChecks,
      videos: allVideos,
    },
    null,
    2,
  )}\n`,
  "utf8",
)
}

await browser.close()

console.log(`\n共 ${entries.length} 张截图。`)
console.log(`全量：${TARGET_DIR}`)
console.log(`入库：${DOC_DIR}`)
