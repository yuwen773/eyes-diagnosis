// Iris v1.1.0 README 产品截图采集
//
// 用法：
//   1. cd web && npm run build
//   2. npx vite preview --port 4290 --strictPort
//   3. node web/scripts/evidence/readme-v110.mjs
//
// 采集的是**当前分支真实构建的 React 产品界面**；后端接口由脚本在浏览器层
// 用合成数据应答（不连真实数据库、不含真实用户与患者信息），只用于截图，
// 不代表真实推理或临床验收。
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"

const ROOT = resolve(import.meta.dirname, "../../..")
const BASE = process.env.README_BASE ?? "http://localhost:4290"
const OUT = resolve(ROOT, "docs/assets/readme/v2")
const CHROME =
  process.env.E2E_CHROMIUM_PATH ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"

mkdirSync(OUT, { recursive: true })

const browserPath = existsSync(CHROME) ? CHROME : undefined

const USER = {
  id: "1001",
  userAccount: "iris.demo",
  userName: "Iris 演示",
  userRole: "admin",
  createTime: "2026-01-01T09:00:00+08:00",
}

const SESSIONS = [
  {
    sessionId: "demo-glaucoma",
    title: "青光眼筛查：杯盘比与随访建议",
    lastMessage: "建议结合视野检查与眼压随访…",
    messageCount: 6,
    summaryContent: "",
    createdTime: "2026-11-20T10:12:00+08:00",
    updatedTime: "2026-11-20T10:18:00+08:00",
    isPinned: true,
  },
  {
    sessionId: "demo-dr",
    title: "糖尿病视网膜病变分级说明",
    lastMessage: "已按 ETDRS 分级整理…",
    messageCount: 4,
    summaryContent: "",
    createdTime: "2026-11-19T16:40:00+08:00",
    updatedTime: "2026-11-19T16:52:00+08:00",
  },
  {
    sessionId: "demo-rag",
    title: "知识库：白内障术前评估要点",
    lastMessage: "检索到 3 条知识库来源…",
    messageCount: 8,
    summaryContent: "",
    createdTime: "2026-11-18T09:05:00+08:00",
    updatedTime: "2026-11-18T09:21:00+08:00",
  },
]

const HISTORY = {
  hasMore: false,
  nextCursor: null,
  messages: [
    {
      id: "m1",
      role: "USER",
      subType: "",
      content: "请结合知识库说明青光眼筛查中杯盘比的意义，并给出随访建议。",
      isSummary: false,
      createdTime: "2026-11-20T10:12:00+08:00",
    },
    {
      id: "m2",
      role: "ASSISTANT",
      subType: "tool-call",
      content: JSON.stringify({
        toolCallId: "tc-demo-1",
        name: "searchDocuments",
        arguments: JSON.stringify({ query: "青光眼 杯盘比 随访" }),
      }),
      isSummary: false,
      createdTime: "2026-11-20T10:12:02+08:00",
    },
    {
      id: "m3",
      role: "ASSISTANT",
      subType: "tool-result",
      content: JSON.stringify({
        toolCallId: "tc-demo-1",
        name: "searchDocuments",
        status: "succeeded",
        output: "检索到 2 条与「青光眼 杯盘比 随访」相关的知识库片段。",
        resources: [
          {
            id: "doc-glaucoma-1",
            kind: "document",
            title: "青光眼筛查与随访要点",
            documentId: "doc-glaucoma-1",
            score: 0.82,
            retrievalScore: 0.71,
          },
          {
            id: "doc-glaucoma-2",
            kind: "document",
            title: "视神经乳头形态评估",
            documentId: "doc-glaucoma-2",
            score: 0.76,
            retrievalScore: 0.64,
          },
        ],
      }),
      isSummary: false,
      createdTime: "2026-11-20T10:12:03+08:00",
    },
    {
      id: "m4",
      role: "ASSISTANT",
      subType: "",
      content:
        "杯盘比（C/D ratio）是视盘杯凹直径与视盘直径的比值，用于描述视神经乳头的结构改变。\n\n" +
        "**判读要点**\n\n" +
        "- 正常人群多在 0.3–0.6 之间，双眼差异通常小于 0.2。\n" +
        "- 比值增大、盘沿变窄或出现切迹时，应结合眼压、视野与 OCT 综合评估。\n" +
        "- 单次读数不能作为诊断依据，纵向变化比绝对值更有意义。\n\n" +
        "**随访建议**：建议 3–6 个月复查视盘形态与视野；如伴眼压升高或视野缺损，应尽快转诊眼科专科。\n\n" +
        "> 以上内容来自知识库检索与模型整理，仅作辅助参考，不能替代医生诊断。",
      isSummary: false,
      createdTime: "2026-11-20T10:12:06+08:00",
    },
    {
      id: "m5",
      role: "USER",
      subType: "",
      content: "如果双眼杯盘比差异明显，需要额外做哪些检查？",
      isSummary: false,
      createdTime: "2026-11-20T10:17:00+08:00",
    },
    {
      id: "m6",
      role: "ASSISTANT",
      subType: "",
      content:
        "双眼差异明显时，建议补充：视野检查（Humphrey 24-2）、OCT 视网膜神经纤维层厚度、前房角检查，以及 24 小时眼压曲线。是否需要进一步处理，应由眼科医生结合全部检查结果判断。",
      isSummary: false,
      createdTime: "2026-11-20T10:18:00+08:00",
    },
  ],
}

const trend = (n = 14) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 7 + i))
    return { day: d.toISOString().slice(0, 10), value: 6 + ((i * 7) % 11) }
  })

const STATS = {
  days: 30,
  rangeStart: "2026-10-22",
  rangeEnd: "2026-11-20",
  userTotal: 128,
  userNew: 17,
  previousUserNew: 12,
  userAdmin: 4,
  diagnosisTotal: 486,
  diagnosisInRange: 96,
  previousDiagnosisInRange: 84,
  diagnosisToday: 9,
  diagnosisAiRejected: 7,
  diagnosisAwaitingReview: 11,
  diagnosisReviewed: 68,
  diagnosisAwaitingReviewTotal: 14,
  avgConfidence: 0.78,
  knowledgeTotal: 32,
  knowledgeChunks: 1284,
  knowledgeFailed: 2,
  knowledgeByStatus: [
    { name: "READY", value: 29 },
    { name: "FAILED", value: 2 },
    { name: "PROCESSING", value: 1 },
  ],
  newsTotal: 21,
  newsByStatus: [
    { name: "1", value: 2 },
    { name: "2", value: 3 },
    { name: "3", value: 16 },
  ],
  trendDays: trend(14).map((row) => row.day),
  diagnosisTrend: trend(14),
  previousDiagnosisTrend: trend(14).map((row) => ({ ...row, value: row.value - 2 })),
  previousUserTrend: trend(14).map((row) => ({ ...row, value: 1 })),
  userTrend: trend(14).map((row) => ({ ...row, value: 2 })),
  diagnosisDistribution: [
    { name: "正常", value: 212 },
    { name: "白内障", value: 96 },
    { name: "糖尿病视网膜病变", value: 61 },
    { name: "青光眼", value: 44 },
    { name: "近视", value: 38 },
    { name: "其他", value: 35 },
  ],
  reviewDistribution: [
    { name: "已复核", value: 68 },
    { name: "待复核", value: 14 },
    { name: "无需复核", value: 14 },
  ],
  diagnosisTrendByResult: trend(14).flatMap((row) => [
    { day: row.day, name: "正常", value: Math.max(1, Math.round(row.value / 2)) },
    { day: row.day, name: "异常", value: Math.max(1, Math.round(row.value / 3)) },
  ]),
}

const envelope = (data) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ code: 0, msg: "ok", data }),
})

async function installMocks(context) {
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    if (path.endsWith("/user/get/login")) return route.fulfill(envelope(USER))
    if (path.endsWith("/agent/sessions") && method === "GET") return route.fulfill(envelope(SESSIONS))
    if (path.includes("/agent/history/")) return route.fulfill(envelope(HISTORY))
    if (path.includes("/stats/admin/overview")) return route.fulfill(envelope(STATS))
    if (path.includes("/diagnosis/list/page/vo")) {
      return route.fulfill(envelope({ records: [], total: 0, size: 20, current: 1, pages: 0 }))
    }
    return route.fulfill(envelope(null))
  })
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.waitForTimeout(1200)
}

async function capture(browser, { name, path, theme = "light", viewport = { width: 1440, height: 900 }, prepare }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: theme,
  })
  await context.addInitScript((wanted) => {
    try {
      localStorage.setItem("theme", wanted)
    } catch {
      /* ignore */
    }
  }, theme)
  await installMocks(context)
  const page = await context.newPage()
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" })
  await settle(page)
  if (prepare) await prepare(page)
  await settle(page)
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false })
  await context.close()
  return `${name}.png`
}

const browser = await chromium.launch({
  headless: true,
  executablePath: browserPath,
})
const files = []

try {
  files.push(
    await capture(browser, {
      name: "landing-light",
      path: "/",
      theme: "light",
    }),
  )
  files.push(
    await capture(browser, {
      name: "landing-dark",
      path: "/",
      theme: "dark",
    }),
  )
  files.push(
    await capture(browser, {
      name: "agent-dark",
      path: "/agent",
      theme: "dark",
      prepare: async (page) => {
        const session = page.getByText("青光眼筛查：杯盘比与随访建议").first()
        if (await session.count()) {
          await session.click().catch(() => {})
        }
      },
    }),
  )
  files.push(
    await capture(browser, {
      name: "admin-dashboard-light",
      path: "/admin/dashboard",
      theme: "light",
    }),
  )
  files.push(
    await capture(browser, {
      name: "diagnosis-light",
      path: "/diagnosis",
      theme: "light",
    }),
  )

  writeFileSync(
    resolve(OUT, "manifest.json"),
    JSON.stringify({ base: BASE, when: new Date().toISOString(), files }, null, 2) + "\n",
    "utf8",
  )
  console.log("captured:", files.join(", "))
} finally {
  await browser.close()
}
