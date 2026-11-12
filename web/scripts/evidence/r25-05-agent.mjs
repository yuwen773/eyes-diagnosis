/**
 * R2.5-05 诊断 Agent 工作区 · 视觉证据采集（可复跑）
 *
 * 用法（先在 web/ 下起 vite，再另开一个终端）：
 *
 *   EVIDENCE_USER=<测试账号> EVIDENCE_PASS=<密码> \
 *   node scripts/evidence/r25-05-agent.mjs
 *
 * 可选：EVIDENCE_BASE（默认 http://localhost:5175）、EVIDENCE_OUT（默认 .shots/r25-05-agent）、
 *       EVIDENCE_CHROME（默认本机 Playwright Chromium 路径）。
 *
 * 说明：
 * - 欢迎屏、会话列表、真实历史、选图附件、窄屏折叠全部走真实后端与真实交互。
 * - 「完整消息流」用真实历史接口的响应形状做**布局夹具**（下题 TRANSCRIPT），
 *   一次覆盖 user / reasoning / assistant / tool-call / tool-result / mcp-confirm
 *   六种消息卡；本机 LLM 通道不可用时无法产生真实长对话，夹具不写入产品代码。
 * - 账号请用临时账号，采完删除；本脚本不保存任何凭据。
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.EVIDENCE_BASE ?? "http://localhost:5175"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), ".shots", "r25-05-agent")
const CHROME =
  process.env.EVIDENCE_CHROME ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const USER = process.env.EVIDENCE_USER
const PASS = process.env.EVIDENCE_PASS
const IMAGE = join(process.cwd(), "public", "fundus-demo.jpg")

if (!USER || !PASS) {
  console.error("缺少 EVIDENCE_USER / EVIDENCE_PASS（用临时账号，采完删除）")
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

const msg = (role, subType, content, createdTime) => ({
  id: String(Math.floor(Math.random() * 1e18)),
  role,
  subType,
  content,
  isSummary: false,
  createdTime,
})

const TRANSCRIPT = {
  messages: [
    msg("USER", "", "我上传了一张眼底照片，帮我看看有没有糖尿病视网膜病变的迹象。", "2026-11-13 10:20:00"),
    msg(
      "ASSISTANT",
      "reasoning",
      "需要先确认影像元数据与质量，再检索糖尿病视网膜病变的分级标准，最后结合影像分析给出解释。",
      "2026-11-13 10:20:02",
    ),
    msg(
      "ASSISTANT",
      "tool-call",
      'eyeImageAnalyzer: {"imageUrl":"https://example.invalid/fundus.jpg"}',
      "2026-11-13 10:20:04",
    ),
    msg(
      "ASSISTANT",
      "tool-result",
      "影像已读取：后极部可见散在微血管瘤，黄斑区反光正常。",
      "2026-11-13 10:20:09",
    ),
    msg(
      "ASSISTANT",
      "",
      "从图上看，后极部有一些细小的血管异常，但单张照片无法替代散瞳眼底检查。\n\n### 我能确认的\n\n- 影像已通过清晰度检查\n- 后极部存在需要临床复核的细节\n\n### 建议\n\n1. 到眼科门诊做散瞳眼底检查\n2. 带上既往的血糖、血压记录\n\n以上内容仅供参考，不构成诊断结论。",
      "2026-11-13 10:20:12",
    ),
    msg(
      "ASSISTANT",
      "mcp-confirm",
      "本地文件工具请求读取「2026-11-10-眼底检查报告.pdf」，需要人工确认后才能继续。",
      "2026-11-13 10:20:15",
    ),
  ],
  hasMore: false,
  nextCursor: null,
}

const errors = []
const report = []

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})

async function newPage(theme, width) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 430 ? 844 : width <= 820 ? 1024 : width >= 1920 ? 1080 : 900 },
    deviceScaleFactor: 1,
  })
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme)
  const response = await context.request.post(`${BASE}/api/user/login`, {
    data: { userAccount: USER, userPassword: PASS },
  })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  const page = await context.newPage()
  page.on("console", (m) => m.type() === "error" && errors.push(`${theme}/${width}: ${m.text()}`))
  page.on("pageerror", (e) => errors.push(`${theme}/${width}: ${e.message}`))
  return { context, page }
}

async function gotoAgent(page) {
  await page.goto(`${BASE}/agent`, { waitUntil: "networkidle" })
  await settle(1200)
}

async function shot(page, name, options = {}) {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 80, ...options })
}

/** 输入区局部：焦点环与附件预览都落在这个区域。 */
async function composerClip(page) {
  const box = await page.locator(".agent-input").boundingBox()
  if (!box) throw new Error("找不到输入区")
  return { x: 0, y: Math.max(0, box.y - 12), width: page.viewportSize().width, height: box.height + 24 }
}

for (const theme of ["light", "dark"]) {
  // 1. 欢迎屏：四个宽度
  for (const width of [390, 768, 1440, 1920]) {
    const { context, page } = await newPage(theme, width)
    await gotoAgent(page)
    await shot(page, `${theme}-welcome-${width}-fold`)
    if (width === 390) await shot(page, `${theme}-welcome-${width}-full`, { fullPage: true, quality: 70 })
    report.push({
      theme,
      width,
      view: "welcome",
      hScroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      welcomeVisible: await page.locator(".welcome-title").isVisible(),
    })
    await context.close()
  }

  // 2. 会话列表（真实会话）+ 真实历史
  {
    const { context, page } = await newPage(theme, 1440)
    await gotoAgent(page)
    const rows = await page.locator(".agent-session__main").count()
    await shot(page, `${theme}-sessions-1440`)
    if (rows > 0) {
      await page.locator(".agent-session__main").first().click()
      await page.waitForSelector(".agent-msg, .agent-msg--user", { timeout: 15000 })
      await settle(700)
      await shot(page, `${theme}-history-real-1440`)
    }
    report.push({ theme, view: "sessions", realSessions: rows })
    await context.close()
  }

  // 3. 完整消息流（布局夹具，接口形状真实）。
  //    夹具走「点真实会话」之外的第二条路：直接把历史接口 fulfill 成夹具，
  //    即使临时账号没有任何会话也能渲染出六种消息卡。
  {
    const { context, page } = await newPage(theme, 1440)
    await page.route("**/api/agent/history/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, msg: "ok", data: TRANSCRIPT }),
      }),
    )
    await gotoAgent(page)
    const rows = await page.locator(".agent-session__main").count()
    if (rows > 0) await page.locator(".agent-session__main").first().click()
    await page.waitForSelector(".agent-msg--confirm", { timeout: 15000 })
    await settle(700)
    await page.evaluate(() => {
      const list = document.querySelector(".agent-msglist")
      if (list) list.scrollTop = 0
    })
    await settle(300)
    await shot(page, `${theme}-transcript-1440-top`)
    await page.evaluate(() => {
      const list = document.querySelector(".agent-msglist")
      if (list) list.scrollTop = list.scrollHeight
    })
    await settle(400)
    await shot(page, `${theme}-transcript-1440-bottom`)
    report.push({
      theme,
      view: "transcript-fixture",
      // 六种卡各自计数：user / assistant / reasoning / 工具卡 / mcp-confirm。
      userCards: await page.locator(".agent-msg--user").count(),
      assistantCards: await page.locator(".agent-msg--assistant").count(),
      reasoningCards: await page.locator(".agent-msg--reasoning").count(),
      toolCards: await page.locator(".agent-toolcard").count(),
      confirmCards: await page.locator(".agent-msg--confirm").count(),
      confirmVisible: await page.locator(".agent-msg--confirm").isVisible(),
    })
    await context.close()
  }

  // 4. 输入区：键盘焦点环 + 选图附件。
  //    附件除了直接喂隐藏 input（验证预览排版），还要点一次欢迎屏的
  //    「上传眼底图像」卡片：验证 pickImage 手势链路真的打开了文件选择
  //    （Playwright 的 filechooser 事件即对话框被触发）。
  {
    const { context, page } = await newPage(theme, 1440)
    await gotoAgent(page)
    await page.focus(".agent-input__textarea")
    await settle(300)
    await shot(page, `${theme}-composer-focus-1440`, { clip: await composerClip(page) })
    await page.setInputFiles(".agent-input__file", IMAGE)
    await page.waitForSelector(".agent-input__attachment", { timeout: 10000 })
    await settle(400)
    await shot(page, `${theme}-composer-attachment-1440`, { clip: await composerClip(page) })
    let pickerOpened = false
    const [chooser] = await Promise.all([
      page
        .waitForEvent("filechooser", { timeout: 8000 })
        .then((c) => ((pickerOpened = true), c))
        .catch(() => null),
      page.locator(".guide-card").first().click(),
    ])
    report.push({
      theme,
      view: "composer",
      attachment: await page.locator(".agent-input__attachment").count(),
      welcomeCardOpensPicker: pickerOpened,
    })
    if (chooser) {
      await chooser.setFiles(IMAGE)
      await page.waitForSelector(".agent-input__attachment", { timeout: 10000 })
      await settle(300)
      await shot(page, `${theme}-composer-welcome-pick-1440`, { clip: await composerClip(page) })
      // 引导句已预填进输入框（欢迎屏卡片，不替用户发送）。
      report.push({
        theme,
        view: "welcome-prefill",
        draftText: await page.locator(".agent-input__textarea").inputValue(),
      })
    }
    await context.close()
  }

  // 5. 窄屏：会话栏默认收起，可从对话头栏展开，选完会话自动收回。
  {
    const { context, page } = await newPage(theme, 390)
    await gotoAgent(page)
    const collapsedOf = () =>
      page.locator(".agent-layout__left").evaluate((el) => el.classList.contains("is-collapsed"))
    const defaultCollapsed = await collapsedOf()
    const hamburgerVisible = await page.locator(".agent-collapsed-actions__btn").first().isVisible()
    await page.locator(".agent-collapsed-actions__btn").first().click()
    await settle(600)
    const expandedCollapsed = await collapsedOf()
    await shot(page, `${theme}-sessions-390-expanded`)
    // 会话栏内的滚动尺寸写进报告（可核验，不留口头数字）。
    const scroll = await page.evaluate(() => {
      const body = document.querySelector(".agent-sessions__body")
      return body
        ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop }
        : null
    })
    // 选一条真实会话（若有）应自动收回会话栏；没有会话则记录跳过。
    const rows = await page.locator(".agent-session__main").count()
    let autoCollapsedAfterSelect = null
    if (rows > 0) {
      await page.locator(".agent-session__main").first().click()
      await settle(800)
      autoCollapsedAfterSelect = await collapsedOf()
    }
    await shot(page, `${theme}-sessions-390-after-select`)
    report.push({
      theme,
      view: "narrow-default",
      defaultCollapsed,
      hamburgerVisible,
      expandedCollapsed,
      autoCollapsedAfterSelect,
      sessionsScroll: scroll,
      realSessions: rows,
    })
    await context.close()
  }
}

await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify({ errors, report }, null, 2))
console.log(JSON.stringify({ errors, report }, null, 2))
if (errors.length) process.exitCode = 1
