/**
 * R3 Agent 前端验收（真实浏览器，合成事件）。
 *
 * 用法（先在 web/ 起 vite，指到真实后端或不需要后端）：
 *
 *   ACCEPT_BASE=http://localhost:5199 node scripts/evidence/r3-agent-acceptance.mjs
 *
 * 说明与边界：
 * - **合成**：SSE 分片由页面内 patch 的 fetch 按时间逐条吐出，历史/会话接口由
 *   Playwright 拦截。这样能确定性地覆盖成功、失败、空结果、乱序、无回执、
 *   断流这些真实模型难以稳定复现的分支。
 * - **真实**：渲染、滚动、停止、主题、视口、时区换算全部走产品代码；没有任何
 *   组件被替换或绕过。
 * - 真实模型链（真 SSE + 真工具）由 `r3-agent-real-backend.mjs` 单独验证，
 *   两者的结果不互相代替。
 *
 * 产物：ACCEPT_OUT（默认 web/test-results/r3-acceptance）/ 截图 + report.json。
 */
import { chromium } from "@playwright/test"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.ACCEPT_BASE ?? "http://localhost:5199"
const OUT = process.env.ACCEPT_OUT ?? join(process.cwd(), "test-results", "r3-acceptance")
const WIDTHS = [375, 768, 1024, 1440, 1920]
const THEMES = ["light", "dark"]

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

const RICH_CHUNKS = [
  "## 初步判断\n\n",
  "从你描述的症状看，需要先排除**急性闭角型青光眼**的可能。\n\n",
  "### 需要立刻注意的\n\n",
  "- 眼痛伴随恶心、呕吐\n",
  "- 看灯光出现彩虹圈\n",
  "- 视力在数小时内明显下降\n\n",
  "### 常见检查\n\n",
  "| 检查 | 目的 | 是否紧急 |\n",
  "| --- | --- | --- |\n",
  "| 眼压测量 | 判断是否急性升高 | 是 |\n",
  "| 前房角镜 | 看房角是否关闭 | 是 |\n",
  "| 视野检查 | 评估慢性损伤 | 否 |\n\n",
  "> 以上内容仅供参考，不构成诊断结论。\n\n",
  "如果出现上述任何一条，请**立即到急诊眼科**就诊，不要等到门诊。\n\n",
  "### 复查记录怎么写\n\n",
  "```text\n日期: 2026-11-18\n眼压: 右 18 / 左 21 mmHg\n处理: 建议 2 周复查视野\n```\n\n",
  "平时记录眼压与用药时间，复诊时带上，比口头回忆可靠。",
]

const TOOL_OK = [
  { delay: 0, payload: { messageType: "assistant", content: "我先查一下知识库。" } },
  {
    delay: 120,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_a", name: "searchDocuments", arguments: '{"query":"青光眼 筛查"}' }],
    },
  },
  {
    delay: 320,
    payload: {
      messageType: "tool-result",
      content: "【文档片段】青光眼早期筛查以眼压、视盘与视野三项为主。",
      toolCallId: "call_a",
      toolName: "searchDocuments",
      status: "success",
    },
  },
  {
    delay: 200,
    payload: { messageType: "assistant", content: "检索到 1 段文档：早期筛查以**眼压、视盘、视野**为主。" },
  },
]

const TOOL_ERROR = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_e", name: "searchDocuments", arguments: '{"query":"白内障"}' }],
    },
  },
  {
    delay: 250,
    payload: {
      messageType: "tool-result",
      content: "知识库检索暂时不可用，请稍后重试。",
      toolCallId: "call_e",
      toolName: "searchDocuments",
      status: "error",
    },
  },
  { delay: 150, payload: { messageType: "assistant", content: "这次检索没有成功，我先按常识回答，请以医生面诊为准。" } },
]

const TOOL_EMPTY = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_z", name: "searchDocuments", arguments: '{"query":"罕见病"}' }],
    },
  },
  { delay: 200, payload: { messageType: "tool-result", content: "", toolCallId: "call_z", toolName: "searchDocuments", status: "success" } },
  { delay: 120, payload: { messageType: "assistant", content: "知识库里没有相关资料。" } },
]

const TOOL_MULTI = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [
        { id: "call_1", name: "searchDocuments", arguments: '{"query":"青光眼"}' },
        { id: "call_2", name: "analyzeEyeImage", arguments: '{"imageUrl":"https://example.invalid/f.jpg"}' },
      ],
    },
  },
  // 乱序返回：先回第二个，再回第一个
  { delay: 200, payload: { messageType: "tool-result", content: "图像：后极部未见明显异常。", toolCallId: "call_2", toolName: "analyzeEyeImage", status: "success" } },
  { delay: 200, payload: { messageType: "tool-result", content: "文档：建议 2 周复查眼压。", toolCallId: "call_1", toolName: "searchDocuments", status: "success" } },
  { delay: 100, payload: { messageType: "assistant", content: "两项结果都已返回，详见执行过程。" } },
]

const TOOL_MISSING = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_m", name: "searchDocuments", arguments: '{"query":"视野缺损"}' }],
    },
  },
  { delay: 150, payload: { messageType: "assistant", content: "我先说结论：视野缺损需要尽快就诊。" } },
]

// 结果回来了但没拿到成败判定：框架只给了 completed，前端不许画成「完成」。
const TOOL_COMPLETED = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_c1", name: "searchDocuments", arguments: '{"query":"干眼症"}' }],
    },
  },
  {
    delay: 150,
    payload: {
      messageType: "tool-result",
      content: "文档片段：热敷每日两次。",
      toolCallId: "call_c1",
      toolName: "searchDocuments",
      status: "completed",
    },
  },
]

const TOOL_TIMEOUT = [
  {
    delay: 0,
    payload: {
      messageType: "tool-request",
      content: "",
      toolCalls: [{ id: "call_t1", name: "analyzeEyeImage", arguments: '{"imageUrl":"/fundus-demo.jpg"}' }],
    },
  },
  {
    delay: 150,
    payload: {
      messageType: "tool-result",
      content: "上游超时",
      toolCallId: "call_t1",
      toolName: "analyzeEyeImage",
      status: "timeout",
    },
  },
]

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
  // 不发 done 直接断流：模拟网络闪断
]

const SCENARIOS = {
  rich: RICH_CHUNKS.map((text, i) => ({ delay: i === 0 ? 0 : 45, payload: { messageType: "assistant", content: text } })),
  "tool-ok": TOOL_OK,
  "tool-error": TOOL_ERROR,
  "tool-empty": TOOL_EMPTY,
  "tool-multi": TOOL_MULTI,
  "tool-missing": TOOL_MISSING,
  "tool-completed": TOOL_COMPLETED,
  "tool-timeout": TOOL_TIMEOUT,
  interrupted: INTERRUPTED,
}

// 正常结束的回合都以 done 收口；只有 interrupted 故意不发，用来测断流。
for (const [name, frames] of Object.entries(SCENARIOS)) {
  if (name !== "interrupted") frames.push({ delay: 60, event: "done", payload: {} })
}

const HISTORY = {
  messages: [
    {
      id: "h1",
      role: "USER",
      subType: "",
      content: "帮我看一下这张眼底照片。",
      isSummary: false,
      createdTime: "2026-11-13T10:20:00Z",
    },
    {
      id: "h2",
      role: "ASSISTANT",
      subType: "tool-call",
      content: JSON.stringify({ toolCallId: "call_h", name: "searchDocuments", arguments: '{"query":"糖尿病视网膜病变"}' }),
      isSummary: false,
      createdTime: "2026-11-13T10:20:03Z",
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
      }),
      isSummary: false,
      createdTime: "2026-11-13T10:20:08Z",
    },
    {
      id: "h4",
      role: "ASSISTANT",
      subType: "",
      content: "从记录看，建议按年度做**散瞳眼底检查**。",
      isSummary: false,
      createdTime: "2026-11-13T10:20:12Z",
    },
  ],
  hasMore: false,
  nextCursor: null,
}

const report = { base: BASE, shots: [], checks: [], failures: [] }

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail })
  if (!pass) report.failures.push(`${name}${detail ? `: ${detail}` : ""}`)
}

async function mockApi(context, { history = HISTORY } = {}) {
  await context.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith("/user/get/login")) {
      return route.fulfill({
        json: { code: 0, msg: "ok", data: { id: "9", userName: "合成用户", userAccount: "synthetic", userRole: "user" } },
      })
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

/** 在页面里把聊天流换成分时可读的 SSE 流。 */
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

async function newPage(browser, { theme, width, frames, history, timezone = "Asia/Shanghai" }) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 430 ? 900 : width <= 820 ? 1024 : 960 },
    timezoneId: timezone,
    deviceScaleFactor: 1,
  })
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme)
  await mockApi(context, { history })
  await scriptStream(context, frames)
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  // 网络层失败（dev server 复位 keep-alive、例子域名取不到图）不是产品异常，
  // 单独记账；「无页面错误」只看 JS 异常与真正的控制台错误。
  page.on("console", (m) => {
    if (m.type() !== "error") return
    if (/Failed to load resource/.test(m.text())) return
    errors.push(m.text())
  })
  return { context, page, errors }
}

async function screenshot(page, name, options = {}) {
  const path = join(OUT, `${name}.jpg`)
  await page.screenshot({ path, type: "jpeg", quality: 78, ...options })
  report.shots.push(path)
}

async function openAgent(page) {
  await page.goto(`${BASE}/agent`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("textarea", { timeout: 20000 })
  await page.waitForTimeout(600)
}

async function send(page, text) {
  const box = page.locator("textarea").first()
  await box.fill(text)
  await box.press("Enter")
}

const stateTexts = (page) => page.locator(".thought__state").allInnerTexts()

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromium(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })

  try {

  /* 1. 长 Markdown：流式成形 + 5 档视口 × 双主题 */
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const { context, page, errors } = await newPage(browser, {
        theme,
        width,
        frames: SCENARIOS.rich,
      })
      await openAgent(page)
      await send(page, "青光眼急性发作要注意什么？")
      // 流式中间态：标题已经成形，光标还在
      await page.waitForSelector(".agent-msg__body.is-streaming h2", { timeout: 15000 })
      const midHasTable = await page.locator(".agent-msg__body table").count()
      if (width === 1440) await screenshot(page, `${theme}-rich-streaming-${width}`)
      await page.waitForFunction(
        () => !document.querySelector(".agent-msg__body.is-streaming"),
        null,
        { timeout: 20000 },
      )
      await page.waitForTimeout(300)

      const body = page.locator(".agent-msg__body").last()
      const counts = {
        h2: await body.locator("h2").count(),
        table: await body.locator("table").count(),
        li: await body.locator("li").count(),
        pre: await body.locator("pre").count(),
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
      await screenshot(page, `${theme}-rich-final-${width}`)

      check(`rich/${theme}/${width} 标题与列表成形`, counts.h2 >= 1 && counts.li >= 3, JSON.stringify(counts))
      check(`rich/${theme}/${width} 表格与代码块渲染`, counts.table >= 1 && counts.pre >= 1, JSON.stringify(counts))
      check(`rich/${theme}/${width} 无横向溢出`, !overflow)
      const richText = await page.locator(".agent-thread").innerText()
      check(
        `rich/${theme}/${width} 正常结束不误报断流`,
        !/连接中断|消息没送出去/.test(richText),
        richText.slice(0, 120),
      )
      check(`rich/${theme}/${width} 无页面错误`, errors.length === 0, errors.join(" | "))
      if (width === 1440) check(`rich/${theme} 流式期间表格尚未成形（渐进但不过早）`, midHasTable === 0, String(midHasTable))
      await context.close()
    }
  }

  /* 2. 工具生命周期：成功 / 失败 / 空结果 / 乱序 / 无回执 / 断流 */
  const toolCases = [
    { name: "tool-ok", expectStates: ["完成"], expectText: "文档片段" },
    { name: "tool-error", expectStates: ["失败"], expectText: "工具返回了错误" },
    { name: "tool-empty", expectStates: ["完成"], expectText: "工具返回了空结果" },
    { name: "tool-multi", expectStates: ["完成", "完成"], expectText: "文档：建议" },
    { name: "tool-missing", expectStates: ["未确认"], expectText: "没有收到这个工具的返回" },
    // completed 不等于 success：只许说「已返回」，并说明没有成败判定。
    { name: "tool-completed", expectStates: ["已返回"], expectText: "没有拿到成败判定" },
    { name: "tool-timeout", expectStates: ["超时"], expectText: "工具执行超时" },
    { name: "interrupted", expectStates: ["未确认"], expectText: "没有收到这个工具的返回" },
  ]

  for (const theme of ["light", "dark"]) {
    for (const toolCase of toolCases) {
      const { context, page, errors } = await newPage(browser, {
        theme,
        width: 1440,
        frames: SCENARIOS[toolCase.name],
      })
      await openAgent(page)
      await send(page, "帮我看看检查结果。")
      await page.waitForSelector(".thought__step", { timeout: 20000 })
      // 展开过程块
      const head = page.locator(".thought__head").first()
      await head.click()
      await page.waitForTimeout(500)
      const states = await stateTexts(page)
      const text = await page.locator(".thought").innerText()
      await screenshot(page, `${theme}-${toolCase.name}-1440`)

      check(
        `${toolCase.name}/${theme} 状态为 ${toolCase.expectStates.join("+")}`,
        JSON.stringify(states.slice(0, toolCase.expectStates.length)) === JSON.stringify(toolCase.expectStates),
        JSON.stringify(states),
      )
      check(`${toolCase.name}/${theme} 文案包含「${toolCase.expectText}」`, text.includes(toolCase.expectText))
      check(`${toolCase.name}/${theme} 无错误状态冒充完成`, !(toolCase.name === "tool-error" && states.includes("完成")))
      check(
        `${toolCase.name}/${theme} completed 不画成「完成」`,
        !(toolCase.name === "tool-completed" && states.includes("完成")),
        JSON.stringify(states),
      )
      if (toolCase.name === "interrupted") {
        const fault = await page.locator("body").innerText()
        check(`interrupted/${theme} 断流有可见提示`, /中断|失败|重试/.test(fault), fault.slice(0, 120))
      }
      if (toolCase.name !== "interrupted") {
        check(
          `${toolCase.name}/${theme} 正常结束不误报断流`,
          !/连接中断|消息没送出去/.test(text),
          text.slice(0, 120),
        )
      }
      check(`${toolCase.name}/${theme} 无页面错误`, errors.length === 0, errors.join(" | "))
      await context.close()
    }
  }

  /* 3. 历史恢复：时间换算 + 工具结果回放 */
  for (const theme of THEMES) {
    const { context, page } = await newPage(browser, {
      theme,
      width: 1440,
      frames: SCENARIOS.rich,
      history: HISTORY,
    })
    // 预置当前会话 id，挂载时拉一次历史
    await context.addInitScript(() => localStorage.setItem("agent_current_thread_id:9", "history-thread"))
    await openAgent(page)
    await page.waitForSelector(".thought__step", { timeout: 20000 })
    const shell = await page.locator(".agent-thread").innerText()
    const head = page.locator(".thought__head").first()
    await head.click()
    await page.waitForTimeout(400)
    const detail = await page.locator(".thought").innerText()
    await screenshot(page, `${theme}-history-1440`)

    // 10:20Z 在上海是 18:20；记录纸/消息时间必须按时间点换算
    check(`history/${theme} 显示本地时间 18:20`, shell.includes("18:20"), shell.slice(0, 200))
    check(`history/${theme} 工具结果回放为完成`, (await stateTexts(page)).includes("完成"))
    check(`history/${theme} 历史工具结果可见`, detail.includes("每年散瞳眼底检查"))
    await context.close()
  }

  } catch (error) {
    report.failures.push(`脚本异常: ${error.message}`)
    throw error
  } finally {
    // 即使中途失败也要落盘：已采集的截图与断言同样是证据。
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2))
    await browser.close()
  }

  console.log(`\n截图 ${report.shots.length} 张 → ${OUT}`)
  console.log(`断言 ${report.checks.length} 条，失败 ${report.failures.length} 条`)
  for (const failure of report.failures) console.error(`✗ ${failure}`)
  if (report.failures.length > 0) process.exitCode = 1
  else console.log("前端验收：全部通过（合成事件）")
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
