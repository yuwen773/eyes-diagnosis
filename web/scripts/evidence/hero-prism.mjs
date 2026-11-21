// 首屏 Prism 视觉与性能证据采集（真实浏览器，headful）
//
// 用法：
//   1. npm run build
//   2. npm run preview -- --port 4173 --strictPort
//   3. node web/scripts/evidence/hero-prism.mjs
//      （可用 PRISM_BASE / E2E_CHROMIUM_PATH 覆盖地址与浏览器）
//
// 产出（入库）：
//   docs/assets/iris2/hero-prism-1440-light.jpg
//   docs/assets/iris2/hero-prism-1440-dark.jpg
//   docs/assets/iris2/hero-prism-performance.json
//
// 为什么要真实浏览器：jsdom 只能验生命周期契约，验不了 WebGL 实际出图、
// 首屏 FPS 与 GPU 渲染器。这里不用 SwiftShader——软件光栅下 Prism 几乎不发光，
// 会得到「没渲染」的错误结论。
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"

const BASE = process.env.PRISM_BASE ?? "http://localhost:4173"
const OUT = resolve(import.meta.dirname, "../../../docs/assets/iris2")
const CHROME =
  process.env.E2E_CHROMIUM_PATH ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"

mkdirSync(OUT, { recursive: true })

const browserPath = existsSync(CHROME)
  ? CHROME
  : (() => {
      try {
        return chromium.executablePath()
      } catch {
        return "playwright-default"
      }
    })()

const browser = await chromium.launch({
  headless: false,
  ...(browserPath === "playwright-default" ? {} : { executablePath: browserPath }),
})

/** 每张画布第一次拿到 webgl2 上下文才算一次创建；重复 getContext 不重复计数。 */
const initScript = (theme) => {
  try {
    localStorage.setItem("theme", theme)
  } catch {
    // about:blank 等不透明源没有 localStorage，忽略即可。
  }
  window.__webgl2Created = 0
  const created = new WeakSet()
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = original.call(this, type, ...rest)
    if (type === "webgl2" && context && !created.has(this)) {
      created.add(this)
      window.__webgl2Created += 1
    }
    return context
  }
}

/** 一个动效窗口内的采样（在页面里执行）。 */
async function sampleOnce(durationMs) {
  const longTasks = []
  let observer = null
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration)
    })
    // 不取 buffered：首屏加载期的长任务不属于动效窗口读数。
    observer.observe({ type: "longtask" })
  } catch {
    // 不支持 longtask 的浏览器只少一项读数。
  }

  const frames = []
  const start = performance.now()
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
  return {
    sampledFrames: frames.length,
    sampleWindowMs: Math.round(performance.now() - start),
    averageFps: Number((1000 / average).toFixed(1)),
    averageFrameMs: Number(average.toFixed(2)),
    p95FrameMs: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
    maxFrameMs: Number(Math.max(...frames).toFixed(2)),
    droppedFrames: frames.filter((value) => value > 20).length,
    longTasksMs: longTasks.map((value) => Number(value.toFixed(1))),
  }
}

/** 与采样窗口无关的环境读数（在页面里执行）。 */
function collectMeta() {
  const canvas = document.querySelector(".hero-prism canvas")
  const gl = canvas?.getContext("webgl2")
  const debug = gl?.getExtension("WEBGL_debug_renderer_info")
  const rect = canvas?.getBoundingClientRect()
  return {
    webgl2Contexts: window.__webgl2Created,
    canvas: canvas
      ? {
          buffer: `${canvas.width}×${canvas.height}`,
          css: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
        }
      : null,
    renderer: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl?.getParameter(gl.RENDERER) ?? null,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    jsHeapMB: performance.memory
      ? Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1))
      : null,
    mode: document.querySelector(".hero-prism")?.getAttribute("data-mode"),
  }
}

/**
 * 动效只跑 5 秒：采样必须落在 intro 之后、settle 之前。
 * 3 个 1s 窗口（挂载后约 1.5–4.5s），取中位数，不跨过冻结点，
 * 也不把冻结后的静态帧算进 FPS。
 */
async function measure(page) {
  const samples = []
  for (let index = 0; index < 3; index += 1) {
    samples.push(await page.evaluate(sampleOnce, 1000))
  }
  const meta = await page.evaluate(collectMeta)

  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  return {
    samples,
    summary: {
      medianFps: median(samples.map((sample) => sample.averageFps)),
      minFps: Math.min(...samples.map((sample) => sample.averageFps)),
      maxFps: Math.max(...samples.map((sample) => sample.averageFps)),
      medianP95FrameMs: median(samples.map((sample) => sample.p95FrameMs)),
      droppedFrames: samples.reduce((sum, sample) => sum + sample.droppedFrames, 0),
      sampledFrames: samples.reduce((sum, sample) => sum + sample.sampledFrames, 0),
      longTasksMs: samples.flatMap((sample) => sample.longTasksMs),
    },
    ...meta,
  }
}

async function capture(theme) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await context.addInitScript(initScript, theme)
  const page = await context.newPage()
  await page.bringToFront()
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30_000 })
  await page.waitForSelector('.hero-prism[data-mode="live"] canvas', { timeout: 10_000 })
  // intro 1.4s；从 1.5s 起采 3s，落在 5s 冻结之前。
  await page.waitForTimeout(1500)

  const metrics = await measure(page)
  await page.screenshot({
    path: resolve(OUT, `hero-prism-1440-${theme}.jpg`),
    type: "jpeg",
    quality: 88,
  })

  // 本轮新增的自动循环控制：满 5s 后必须停在当前相位。
  await page.waitForTimeout(1200)
  const settled = await page.evaluate(() => ({
    mode: document.querySelector(".hero-prism")?.getAttribute("data-mode"),
    atMs: Math.round(performance.now()),
  }))
  if (settled.mode !== "settled") {
    throw new Error(`${theme}: 期望 5s 后 data-mode=settled，实际 ${settled.mode}`)
  }

  let themeSwitch = null
  if (theme === "light") {
    await page.getByRole("button", { name: "切换到暗色主题" }).click()
    await page.waitForTimeout(900)
    themeSwitch = await page.evaluate(() => ({
      webgl2Contexts: window.__webgl2Created,
      heroTheme: document.querySelector(".hero-prism")?.getAttribute("data-theme"),
      htmlDark: document.documentElement.classList.contains("dark"),
    }))
  }

  await context.close()
  return { theme, metrics, settled, themeSwitch }
}

const results = [await capture("light"), await capture("dark")]
await browser.close()

const report = {
  capturedAt: new Date().toISOString(),
  base: BASE,
  viewport: "1440×900 @1x",
  browser: browserPath,
  results,
}
const jsonPath = resolve(OUT, "hero-prism-performance.json")
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")

for (const { theme, metrics, settled, themeSwitch } of results) {
  const { summary } = metrics
  console.log(
    `${theme}: ${summary.medianFps} fps median (${summary.minFps}–${summary.maxFps}) · ` +
      `p95 ${summary.medianP95FrameMs}ms · ` +
      `dropped ${summary.droppedFrames}/${summary.sampledFrames} · ` +
      `long tasks ${summary.longTasksMs.length} · ` +
      `ctx ${metrics.webgl2Contexts} · ${metrics.canvas?.buffer} · ` +
      `settled@${settled.atMs}ms · ${metrics.renderer}`,
  )
  if (themeSwitch) console.log("theme switch:", JSON.stringify(themeSwitch))
}
console.log("wrote", jsonPath)
