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
//
// 产出：
//   docs/reviews/assets/iris-hero-comparison/   核心桌面截图 + 三版对照拼图（入库）
//   target/iris-hero-comparison/               全量截图 + manifest + 录屏（本地）
//
// 为什么要真实浏览器：jsdom 只能验生命周期契约，验不了 WebGL 实际出图、
// 首屏 FPS、GPU 渲染器与 draw call 频次。静态降级结果绝不能当成真实 GPU 动效。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"

const ROOT = resolve(import.meta.dirname, "../../..")
const DOC_DIR = resolve(ROOT, "docs/reviews/assets/iris-hero-comparison")
const TARGET_DIR = resolve(ROOT, "target/iris-hero-comparison")
const COMPARE_BASE = process.env.HERO_COMPARE_BASE ?? "http://localhost:4173"
const OPTIC_BASE = process.env.HERO_OPTIC_BASE ?? "http://localhost:4174"
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
      averageFps: Number((1000 / average).toFixed(1)),
      averageFrameMs: Number(average.toFixed(2)),
      p95FrameMs: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
      maxFrameMs: Number(Math.max(...frames).toFixed(2)),
      droppedFrames: frames.filter((value) => value > 20).length,
      longTasksMs: longTasks.map((value) => Number(value.toFixed(1))),
      drawCalls,
      drawCallsPerSec: Number((drawCalls / (durationMs / 1000)).toFixed(1)),
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
    doc: saveToDoc ? `docs/reviews/assets/iris-hero-comparison/${file}` : null,
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
// 1) 核心矩阵：3 方案 × 4 视口 × 2 主题 × 2 构图
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 5) 性能：动效窗口 / 停机后 / 页面不可见 / 路由离开后的回收 / 主题切换
// ---------------------------------------------------------------------------
console.log("· 性能与资源回收")
const perf = {}
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
  if (variant.key === "prism") {
    await tab.waitForTimeout(4000)
  } else {
    await tab.getByRole("button", { name: "暂停动效" }).click()
    // 点击会把指针留在工具栏上，而工具栏压在 hero 画布范围内——Beams 的
    // `mouseInteraction` 会让光带继续跟随指针，于是「暂停」了 GPU 仍在画。
    // 要量的是「动效停了以后还画不画」，所以先把指针移出画布再采样。
    await tab.mouse.move(4, 4)
    await tab.waitForTimeout(600)
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
  perf[variant.key] = {
    variant: `${variant.code} ${variant.name}`,
    animation,
    settled: { sample: settledSample, pointerOutsideCanvas: settledPointerInside },
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
      `离屏 draws/s ${hiddenSample.drawCallsPerSec} · 换页后停止绘制 ${afterNav2 === afterNav.drawCalls}`,
  )
  await context.close()
}

// Reduced Motion 是否真的停动画（独立复核）
const reducedChecks = {}
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

// ---------------------------------------------------------------------------
// 5.5) 动效录屏：每方案 5 秒，证明「动起来了」而不只是「截到一帧」
//
// 录屏是**可选**产物：Playwright 录视频要额外的 ffmpeg 二进制，本机不一定有。
// 缺了就跳过，不能让整轮取证挂在这一个非必需步骤上。
// ---------------------------------------------------------------------------
console.log("· 动效录屏")
const videos = []
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

// ---------------------------------------------------------------------------
// 7) manifest
// ---------------------------------------------------------------------------
const manifest = {
  task: "E-09 · OpticFlow × Prism 三方案真实浏览器对照",
  status: "VISUAL_REVIEW_PENDING",
  capturedAt: new Date().toISOString(),
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
  entries,
  performance: perf,
  reducedMotionChecks: reducedChecks,
  videos,
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
      frames: entries.length,
      performance: perf,
      reducedMotionChecks: reducedChecks,
      videos,
    },
    null,
    2,
  )}\n`,
  "utf8",
)

await browser.close()

console.log(`\n共 ${entries.length} 张截图。`)
console.log(`全量：${TARGET_DIR}`)
console.log(`入库：${DOC_DIR}`)
