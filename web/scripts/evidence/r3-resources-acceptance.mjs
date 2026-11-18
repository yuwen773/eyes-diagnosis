/**
 * Phase R 资源与证据闭环验收（真实浏览器，合成事件）。
 *
 * 用法（先在 web/ 起 vite）：
 *
 *   ACCEPT_BASE=http://localhost:5199 node scripts/evidence/r3-resources-acceptance.mjs
 *
 * 边界（与 r3-agent-acceptance.mjs 同一套约定）：
 * - **合成**：SSE 分片与上传接口由页面内 patch 的 fetch / Playwright 路由提供，
 *   这样才能稳定复现「重复链接」「失败工具却带资源」「断流」这些真实模型难以
 *   复现的分支。
 * - **真实**：资源派生、协议校验、去重、面板渲染、定位滚动、主题与视口全部走
 *   产品代码。
 * - 真实 Java 后端 + 真实 Chroma 检索由 `r3-resources-real-backend.mjs` 单独验证。
 *
 * 产物：ACCEPT_OUT（默认 web/test-results/r3-resources）/ 截图 + report.json。
 */
import { chromium } from "@playwright/test"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.ACCEPT_BASE ?? "http://localhost:5199"
const OUT = process.env.ACCEPT_OUT ?? join(process.cwd(), "test-results", "r3-resources")

mkdirSync(OUT, { recursive: true })

function resolveChromium() {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH
  try {
    const expected = chromium.executablePath()
    if (expected && existsSync(expected)) return expected
  } catch {
    /* 没装浏览器时继续找本机已有的修订版 */
  }
  const root = join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
  if (!existsSync(root)) return undefined
  const revisions = readdirSync(root)
    .map((name) => name.match(/^chromium-(\d+)$/))
    .filter(Boolean)
    .map((m) => ({ name: m[0], rev: Number(m[1]) }))
    .sort((a, b) => b.rev - a.rev)
  for (const { name } of revisions) {
    const candidate = join(root, name, "chrome-win64", "chrome.exe")
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/* ── 合成事件 ─────────────────────────────────────────────── */

const CITATION = {
  id: "doc:42",
  kind: "document",
  title: "干眼症诊疗共识",
  source: "knowledge-base",
  documentId: "42",
  score: 0.81,
  snippet: "睑板腺功能障碍是干眼的主要原因之一，热敷与睑缘清洁是一线处理。",
  toolCallId: "call_doc",
}

/** 完整一轮：上传影像 → 检索命中 → 助手给出链接（含重复与危险协议） */
const FULL_FLOW = [
  { delay: 0, payload: { messageType: "assistant", content: "我先查一下知识库。" } },
  {
    delay: 120,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_doc", name: "searchDocuments", arguments: '{"query":"干眼 睑板腺"}' }],
    },
  },
  {
    delay: 300,
    payload: {
      messageType: "tool-result",
      content: "【文档片段】睑板腺功能障碍是干眼的主要原因之一。",
      toolCallId: "call_doc",
      toolName: "searchDocuments",
      status: "success",
      resources: [CITATION],
    },
  },
  {
    delay: 200,
    payload: {
      messageType: "assistant",
      content:
        "检索到 1 段来源：睑板腺功能障碍是干眼的主要原因之一。\n\n" +
        "可参考 [干眼诊疗共识](https://med.example.com/guide)，" +
        "同一篇的 [不同锚点](https://med.example.com/guide#section) 不重复计数；" +
        "[危险链接](javascript:alert(1)) 会被丢弃。",
    },
  },
  { delay: 60, event: "done", payload: {} },
]

/** 失败的工具结果却带着资源：前端必须按状态拒绝，不能长出一份假证据 */
const FAILED_WITH_RESOURCES = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_f", name: "searchDocuments", arguments: '{"query":"白内障"}' }],
    },
  },
  {
    delay: 250,
    payload: {
      messageType: "tool-result",
      content: "知识库检索暂时不可用，请稍后重试。",
      toolCallId: "call_f",
      toolName: "searchDocuments",
      status: "error",
      resources: [{ ...CITATION, id: "doc:99", documentId: "99", toolCallId: "call_f" }],
    },
  },
  { delay: 150, payload: { messageType: "assistant", content: "这次检索没有成功，请以医生面诊为准。" } },
  { delay: 60, event: "done", payload: {} },
]

/** 断流：工具没回执就断了，资源栏不得出现来源 */
const INTERRUPTED = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_i", name: "searchDocuments", arguments: '{"query":"视网膜脱落"}' }],
    },
  },
  { delay: 120, payload: { messageType: "assistant", content: "正在检索" } },
]

const HISTORY = {
  messages: [
    {
      id: "h1",
      role: "USER",
      subType: "",
      content: JSON.stringify({
        text: "帮我看看这张眼底照片。",
        images: ["https://cos.example.com/history.jpg"],
      }),
      isSummary: false,
      createdTime: "2026-11-16T10:20:00Z",
    },
    {
      id: "h2",
      role: "ASSISTANT",
      subType: "tool-call",
      content: JSON.stringify({
        toolCallId: "call_h",
        name: "searchDocuments",
        arguments: '{"query":"糖尿病视网膜病变"}',
      }),
      isSummary: false,
      createdTime: "2026-11-16T10:20:03Z",
    },
    {
      id: "h3",
      role: "ASSISTANT",
      subType: "tool-result",
      content: JSON.stringify({
        toolCallId: "call_h",
        name: "searchDocuments",
        status: "success",
        output: "【文档片段】建议每年散瞳眼底检查一次。",
        resources: [
          {
            id: "doc:7",
            kind: "document",
            title: "糖尿病视网膜病变筛查共识",
            source: "knowledge-base",
            documentId: "7",
            score: 0.76,
            snippet: "建议每年散瞳眼底检查一次。",
            toolCallId: "call_h",
          },
        ],
      }),
      isSummary: false,
      createdTime: "2026-11-16T10:20:08Z",
    },
    {
      id: "h4",
      role: "ASSISTANT",
      subType: "",
      content: "建议按年度做**散瞳眼底检查**。",
      isSummary: false,
      createdTime: "2026-11-16T10:20:12Z",
    },
  ],
  hasMore: false,
  nextCursor: null,
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

const report = { base: BASE, shots: [], checks: [], failures: [] }

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail })
  if (!pass) report.failures.push(`${name}${detail ? `: ${detail}` : ""}`)
}

async function mockApi(context, history = { messages: [], hasMore: false, nextCursor: null }) {
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/user/get/login")) {
      return route.fulfill({
        json: {
          code: 0,
          msg: "ok",
          data: { id: "9", userName: "合成用户", userAccount: "synthetic", userRole: "user" },
        },
      })
    }
    if (path.includes("/agent/image/upload")) {
      return route.fulfill({ json: { code: 0, msg: "ok", data: "https://cos.example.com/seed.jpg" } })
    }
    if (path.includes("/agent/chat/stream")) {
      return route.fulfill({ status: 500, body: "should be patched" })
    }
    if (path.includes("/agent/history/")) {
      return route.fulfill({ json: { code: 0, msg: "ok", data: history } })
    }
    if (path.includes("/agent/sessions")) {
      return route.fulfill({ json: { code: 0, msg: "ok", data: [] } })
    }
    return route.fulfill({ json: { code: 0, msg: "ok", data: null } })
  })
}

async function scriptStream(context, frames) {
  await context.addInitScript((framesArg) => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url
      if (url.includes("/agent/chat/stream")) {
        const encoder = new TextEncoder()
        const body = new ReadableStream({
          start(controller) {
            let at = 0
            for (const frame of framesArg) {
              at += frame.delay
              const head = frame.event ? `event: ${frame.event}\n` : ""
              const line = `${head}data: ${JSON.stringify(frame.payload)}\n\n`
              setTimeout(() => controller.enqueue(encoder.encode(line)), at)
            }
            setTimeout(() => controller.close(), at + 30)
          },
        })
        return Promise.resolve(
          new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        )
      }
      return realFetch(input, init)
    }
  }, frames)
}

async function newPage(browser, { theme, width, frames, history }) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 430 ? 900 : 960 },
    timezoneId: "Asia/Shanghai",
    deviceScaleFactor: 1,
  })
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme)
  await mockApi(context, history)
  await scriptStream(context, frames)
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  return { context, page, errors }
}

async function screenshot(page, name) {
  const path = join(OUT, `${name}.jpg`)
  await page.screenshot({ path, type: "jpeg", quality: 78 })
  report.shots.push(path)
}

async function openAgent(page) {
  await page.goto(`${BASE}/agent`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("textarea", { timeout: 20000 })
  await page.waitForTimeout(600)
}

async function openPanel(page) {
  await page.locator('button[aria-label="资源面板"]').first().click()
  await page.waitForSelector(".agent-panel", { timeout: 10000 })
}

async function tab(page, label) {
  await page.locator(".agent-panel__tab", { hasText: label }).first().click()
  await page.waitForTimeout(120)
}

const panelText = (page) => page.locator(".agent-panel").innerText()

/**
 * 等这一轮真的流完：先等执行过程出现，再等最后一句可见，最后让收尾动效落定。
 * 只等 `caret-blink` 消失是不够的——发送被上传拖延时那一刻还没有任何回复。
 */
async function waitForFinal(page, marker) {
  await page.waitForSelector(".thought__step", { timeout: 20000 })
  await page.waitForFunction((text) => document.body.innerText.includes(text), marker, {
    timeout: 20000,
  })
  await page.waitForTimeout(300)
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromium(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })

  try {
    /* 1. 上传 → 检索命中 → 链接：三类资源同时可见，去重与协议校验生效 */
    for (const theme of ["light", "dark"]) {
      const { context, page, errors } = await newPage(browser, {
        theme,
        width: 1440,
        frames: FULL_FLOW,
      })
      await openAgent(page)
      await page.setInputFiles('input[type="file"]', {
        name: "fundus.png",
        mimeType: "image/png",
        buffer: PNG_1PX,
      })
      await page.waitForTimeout(400)
      await page.locator("textarea").first().fill("帮我看看这张眼底照片")
      await page.locator("textarea").first().press("Enter")
      await waitForFinal(page, "会被丢弃")
      await openPanel(page)

      const tabs = await page.locator(".agent-panel__tab").allInnerTexts()
      check(`${theme} 影像计数为 1`, /影像\s*1/.test(tabs.join(" ")), tabs.join(" | "))
      check(`${theme} 知识来源计数为 1`, /知识来源\s*1/.test(tabs.join(" ")), tabs.join(" | "))
      check(`${theme} 链接去重后计数为 1`, /链接\s*1/.test(tabs.join(" ")), tabs.join(" | "))

      const badge = await page.locator(".agent-iconbtn__badge").innerText()
      check(`${theme} 顶栏角标合计 3`, badge.trim() === "3", badge)

      // 影像：上传的可以自动加载，点击开启预览
      const thumb = page.locator(".agent-panel__img img").first()
      check(`${theme} 上传影像出现在缩略图`, (await thumb.count()) === 1)
      await page.locator(".agent-panel__img").first().click()
      check(`${theme} 点击缩略图打开预览层`, (await page.locator(".agent-preview").count()) === 1)
      await screenshot(page, `${theme}-resources-preview-1440`)
      await page.locator(".agent-preview__close").click()

      // 知识来源：相关度 / 片段 / 文档 ID 都来自后端结构化引用
      await tab(page, "知识来源")
      const docText = await panelText(page)
      check(`${theme} 展示真实相关度 0.81`, docText.includes("0.81"), docText.slice(0, 160))
      check(`${theme} 展示检索片段`, docText.includes("睑板腺功能障碍"), docText.slice(0, 160))
      check(`${theme} 展示文档 ID`, docText.includes("#42"), docText.slice(0, 160))
      check(`${theme} 不把来源说成模型生成`, docText.includes("不是模型生成的引用"))

      // 定位回执行步骤
      await page.locator(".agent-panel__locate").first().click()
      await page.waitForTimeout(200)
      check(`${theme} 定位后执行步骤高亮`, (await page.locator(".thought__step.is-located").count()) === 1)
      await screenshot(page, `${theme}-resources-panel-1440`)

      // 链接：去重 + 协议校验
      await tab(page, "链接")
      const linkText = await panelText(page)
      const linkCount = await page.locator(".agent-panel__link").count()
      check(`${theme} 链接只出现一次（锚点差异去重）`, linkCount === 1, String(linkCount))
      check(`${theme} 危险协议链接未被收录`, !linkText.includes("javascript"), linkText.slice(0, 160))
      check(`${theme} 链接带出处标签`, linkText.includes("助手引用"), linkText.slice(0, 160))
      check(`${theme} 外链新窗口打开且 noopener`, await page.locator(".agent-panel__link a").first().evaluate(
        (a) => a.target === "_blank" && (a.rel ?? "").includes("noreferrer"),
      ))
      check(`${theme} 无页面错误`, errors.length === 0, errors.join(" | "))

      await context.close()
    }

    /* 2. 移动端：面板是抽屉，三类计数与内容仍完整 */
    {
      const { context, page, errors } = await newPage(browser, {
        theme: "light",
        width: 375,
        frames: FULL_FLOW,
      })
      await openAgent(page)
      await page.locator("textarea").first().fill("眼底照片帮我看下")
      await page.locator("textarea").first().press("Enter")
      await waitForFinal(page, "会被丢弃")
      await openPanel(page)
      check("375 面板以抽屉呈现", (await page.locator(".agent-drawer .agent-panel").count()) === 1)
      await tab(page, "知识来源")
      check("375 抽屉内展示来源", (await panelText(page)).includes("睑板腺功能障碍"))
      await screenshot(page, "light-resources-drawer-375")
      check("375 无页面错误", errors.length === 0, errors.join(" | "))
      await context.close()
    }

    /* 3. 失败的工具结果：即使后端带着资源，前端也不当作证据 */
    {
      const { context, page } = await newPage(browser, {
        theme: "light",
        width: 1440,
        frames: FAILED_WITH_RESOURCES,
      })
      await openAgent(page)
      await page.locator("textarea").first().fill("白内障怎么办")
      await page.locator("textarea").first().press("Enter")
      await waitForFinal(page, "请以医生面诊为准")
      await openPanel(page)
      const tabs = (await page.locator(".agent-panel__tab").allInnerTexts()).join(" ")
      check("失败工具不产生知识来源", /知识来源\s*0/.test(tabs), tabs)
      await tab(page, "知识来源")
      check("失败时空态文案诚实", (await panelText(page)).includes("只有检索工具真实命中的文档"), await panelText(page))
      await screenshot(page, "light-resources-failed-tool-1440")
      await context.close()
    }

    /* 4. 断流：没有回执的回合不产出来源 */
    {
      const { context, page } = await newPage(browser, {
        theme: "dark",
        width: 1440,
        frames: INTERRUPTED,
      })
      await openAgent(page)
      await page.locator("textarea").first().fill("视网膜脱落怎么处理")
      await page.locator("textarea").first().press("Enter")
      await page.waitForSelector(".thought__step", { timeout: 20000 })
      await page.waitForTimeout(1200)
      await openPanel(page)
      const tabs = (await page.locator(".agent-panel__tab").allInnerTexts()).join(" ")
      check("断流后资源栏没有来源", /知识来源\s*0/.test(tabs) && /影像\s*0/.test(tabs), tabs)
      await screenshot(page, "dark-resources-interrupted-1440")
      await context.close()
    }

    /* 5. 历史恢复：刷新 / 换会话后影像与来源都能重建 */
    {
      const { context, page, errors } = await newPage(browser, {
        theme: "light",
        width: 1440,
        frames: FULL_FLOW,
        history: HISTORY,
      })
      await context.addInitScript(() =>
        localStorage.setItem("agent_current_thread_id:9", "history-thread"),
      )
      await openAgent(page)
      await page.waitForSelector(".thought__step", { timeout: 20000 })
      await page.waitForTimeout(400)
      await openPanel(page)

      const tabs = (await page.locator(".agent-panel__tab").allInnerTexts()).join(" ")
      check("历史恢复出 1 张影像", /影像\s*1/.test(tabs), tabs)
      check("历史恢复出 1 条知识来源", /知识来源\s*1/.test(tabs), tabs)
      await tab(page, "知识来源")
      const docText = await panelText(page)
      check("历史来源保留相关度与文档 ID", docText.includes("0.76") && docText.includes("#7"), docText)
      check("历史恢复无页面错误", errors.length === 0, errors.join(" | "))
      await screenshot(page, "light-resources-history-1440")

      // 新建对话：资源随会话切换清空，不把上一个会话的影像留在侧栏
      await page.locator(".agent-sessions__newchat").first().click()
      await page.waitForTimeout(600)
      // 新建会话会把面板收起（不把上一个会话的资源留在眼前），重新打开再看计数。
      if ((await page.locator(".agent-panel").count()) === 0) await openPanel(page)
      const afterTabs = (await page.locator(".agent-panel__tab").allInnerTexts()).join(" ")
      check(
        "新建会话后资源清空（不跨会话串数据）",
        /影像\s*0/.test(afterTabs) && /知识来源\s*0/.test(afterTabs) && /链接\s*0/.test(afterTabs),
        afterTabs,
      )
      await context.close()
    }
  } catch (error) {
    report.failures.push(`脚本异常: ${error.message}`)
    throw error
  } finally {
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2))
    await browser.close()
  }

  console.log(`\n截图 ${report.shots.length} 张 → ${OUT}`)
  console.log(`断言 ${report.checks.length} 条，失败 ${report.failures.length} 条`)
  if (report.failures.length > 0) {
    for (const failure of report.failures) console.log(`  ✗ ${failure}`)
    process.exitCode = 1
  }
}

run()
