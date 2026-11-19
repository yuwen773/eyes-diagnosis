/**
 * Phase R 真实后端验收：资源闭环（上传 → 会话消息 → 检索引用 → 历史恢复）。
 *
 * 只打真实 Java 后端（默认 http://localhost:18081/api），不拦截任何请求：
 *   1. 真实上传一张 PNG（走 COS），拿到可访问地址；
 *   2. 发一条会触发 searchDocuments 的真实消息，带上这张图；
 *   3. 核对 SSE 的 tool-result 是否携带**结构化资源**（documentId / score /
 *      snippet / toolCallId），并且只在 status=success 时出现；
 *   4. 核对历史：用户消息是可解析的 `{"text","images"}` 信封，工具结果行里
 *      保留了同一批资源——刷新/切会话后资源栏据此重建；
 *   5. 收尾删除本轮上传的对象。
 *
 * 用法：
 *   R3_API_BASE=http://localhost:18081/api node scripts/evidence/r3-resources-real-backend.mjs
 *
 * 产物：EVIDENCE_OUT/r3-resources-real-backend.json（默认 web/test-results/r3-resources）。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const BASE = process.env.R3_API_BASE ?? "http://localhost:18081/api"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), "test-results", "r3-resources")

const account = `r3res${Date.now().toString(36)}`
const password = `Probe-${randomUUID().slice(0, 12)}`
const threadId = randomUUID()

/** 1×1 PNG：能通过后端 ImageIO 校验的最小合法图。 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

const report = {
  base: BASE,
  account,
  threadId,
  checks: {},
  events: [],
  history: [],
  failures: [],
}

const fail = (message) => {
  report.failures.push(message)
  console.error(`✗ ${message}`)
}
const ok = (message) => console.log(`✓ ${message}`)

async function postJson(path, body, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  return { response, json }
}

function cookieFrom(response) {
  const list =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""]
  return list
    .filter(Boolean)
    .map((raw) => raw.split(";")[0])
    .join("; ")
}

async function readSse(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let split
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      let eventName = "message"
      const dataLines = []
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim()
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
      }
      onEvent(eventName, dataLines.join("\n"))
    }
  }
}

async function main() {
  console.log(`→ ${BASE}`)

  const registered = await postJson("/user/register", {
    userAccount: account,
    userPassword: password,
    checkPassword: password,
  })
  if (registered.json?.code !== 0) throw new Error(`注册失败: ${JSON.stringify(registered.json)}`)

  const login = await postJson("/user/login", { userAccount: account, userPassword: password })
  const cookie = cookieFrom(login.response)
  if (!cookie) throw new Error("登录响应没有会话 Cookie")
  report.checks.userId = login.json?.data?.id ?? null

  // 1. 真实上传
  const form = new FormData()
  form.append("file", new Blob([PNG], { type: "image/png" }), "fundus.png")
  const uploadResponse = await fetch(`${BASE}/agent/image/upload`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  })
  const uploadBody = await uploadResponse.json()
  if (uploadBody?.code !== 0 || !uploadBody?.data) {
    throw new Error(`上传失败: ${JSON.stringify(uploadBody)}`)
  }
  const imageUrl = uploadBody.data
  report.checks.imageUrl = imageUrl
  ok(`上传成功：${imageUrl}`)

  // 预览地址必须真的可访问（不是凭字符串猜的）
  const head = await fetch(imageUrl, { method: "GET" })
  report.checks.imageReachable = head.status
  if (head.status !== 200) fail(`上传地址不可访问：HTTP ${head.status}`)
  else ok("上传地址可访问（HTTP 200）")

  // 2. 发一条会触发知识库检索的真实消息
  const streamResponse = await fetch(`${BASE}/agent/chat/stream`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      message: "请从知识库检索青光眼早期筛查的要点，并引用检索到的来源回答。",
      threadId,
      imageUrls: [imageUrl],
    }),
  })
  if (!streamResponse.ok) {
    throw new Error(`SSE 响应 ${streamResponse.status}: ${await streamResponse.text()}`)
  }

  let done = false
  await readSse(streamResponse, (eventName, data) => {
    if (eventName === "done") {
      done = true
      return
    }
    if (!data) return
    let dto
    try {
      dto = JSON.parse(data)
    } catch {
      fail(`SSE 片段不是 JSON：${data.slice(0, 120)}`)
      return
    }
    report.events.push({
      messageType: dto.messageType,
      toolCallId: dto.toolCallId ?? null,
      toolName: dto.toolName ?? null,
      status: dto.status ?? null,
      resources: dto.resources ?? null,
      contentHead: typeof dto.content === "string" ? dto.content.slice(0, 80) : null,
    })
  })
  if (!done) fail("流没有以 done 事件收口")
  else ok("SSE 以 done 事件收口")

  // 3. 工具结果里的结构化资源
  const results = report.events.filter((e) => e.messageType === "tool-result")
  report.checks.toolResults = results.length
  const withResources = results.filter((e) => Array.isArray(e.resources) && e.resources.length > 0)
  report.checks.toolResultsWithResources = withResources.length

  for (const result of results) {
    const resources = result.resources ?? []
    if (result.status !== "success" && resources.length > 0) {
      fail(`失败的调用 ${result.toolCallId} 带着 ${resources.length} 条资源`)
    }
  }

  if (results.length === 0) {
    report.checks.toolInvoked = false
    console.warn("⚠ 本次真实回答没有触发工具调用，检索引用这条不算已验证")
  } else {
    report.checks.toolInvoked = true
  }

  if (withResources.length === 0) {
    fail("工具结果没有携带任何结构化资源（检索命中但没有登记引用）")
  } else {
    for (const document of withResources.flatMap((e) => e.resources)) {
      if (document.kind !== "document") {
        fail(`意外的资源类型：${document.kind}`)
        continue
      }
      if (!document.documentId) fail(`资源缺少 documentId：${JSON.stringify(document).slice(0, 120)}`)
      if (!document.snippet) fail(`资源缺少检索片段：${JSON.stringify(document).slice(0, 120)}`)
      if (!document.toolCallId) fail(`资源没有关联到工具调用：${JSON.stringify(document).slice(0, 120)}`)
      if (typeof document.score !== "number") {
        console.warn(`⚠ 资源 ${document.documentId} 没有相关度分数（检索结果未带分数）`)
      }
    }
    const first = withResources[0].resources[0]
    ok(`工具结果携带结构化引用：doc=${first.documentId} score=${first.score} 片段=${String(first.snippet).slice(0, 24)}…`)
  }

  // 4. 历史恢复：用户消息信封 + 工具行里的同一批资源
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const historyResponse = await fetch(`${BASE}/agent/history/${threadId}?limit=50`, {
    headers: { Cookie: cookie, Accept: "application/json" },
  })
  const historyBody = await historyResponse.json()
  const messages = historyBody?.data?.messages ?? []
  report.checks.historyMessages = messages.length
  report.history = messages.map((message) => ({
    role: message.role,
    subType: message.subType,
    contentHead: String(message.content ?? "").slice(0, 120),
  }))

  const userRows = messages.filter((m) => m.role === "USER")
  const userRow = userRows[userRows.length - 1]
  let envelope = null
  try {
    envelope = userRow ? JSON.parse(userRow.content) : null
  } catch {
    envelope = null
  }
  report.checks.userEnvelope = envelope
  if (!envelope || typeof envelope.text !== "string" || !Array.isArray(envelope.images)) {
    fail(`用户消息没有落成 {\"text\",\"images\"} 信封：${String(userRow?.content).slice(0, 120)}`)
  } else {
    if (!envelope.images.includes(imageUrl)) fail("信封里的图片地址与上传结果不一致")
    if (String(envelope.text).includes("<image-analysis>")) {
      fail("信封里混进了送给模型的 <image-analysis> 标记")
    }
    ok(`用户消息信封恢复出 ${envelope.images.length} 张图，正文 ${envelope.text.length} 字`)
  }

  const resultRows = messages.filter((m) => m.subType === "tool-result")
  report.checks.historyToolResultRows = resultRows.length
  const persistedResources = []
  for (const row of resultRows) {
    let parsed
    try {
      parsed = JSON.parse(row.content)
    } catch {
      fail(`历史工具行不是 JSON：${String(row.content).slice(0, 80)}`)
      continue
    }
    if (parsed.status !== "success" && parsed.resources?.length) {
      fail(`历史里失败的工具行仍带着资源：${parsed.toolCallId}`)
    }
    for (const resource of parsed.resources ?? []) persistedResources.push(resource)
  }
  report.checks.historyResources = persistedResources.length
  if (withResources.length > 0 && persistedResources.length === 0) {
    fail("SSE 有结构化资源，但历史里没有落库——刷新后资源栏会空")
  } else if (persistedResources.length > 0) {
    ok(`历史恢复出 ${persistedResources.length} 条结构化来源`)
  }

  // 5. 收尾：删除本轮上传的对象（临时验收产物不留在存储里）
  const deleted = await postJson("/agent/image/upload/delete", { url: imageUrl }, cookie)
  report.checks.imageDeleted = deleted.json?.code === 0 && deleted.json?.data === true
  if (!report.checks.imageDeleted) {
    console.warn(`⚠ 上传对象未删除：${JSON.stringify(deleted.json)}`)
  }

  report.checks.failures = report.failures.length
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, "r3-resources-real-backend.json")
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n产物：${file}`)
  if (report.failures.length > 0) {
    console.error(`\n${report.failures.length} 项失败`)
    process.exitCode = 1
  } else {
    console.log("\n真实后端资源闭环：全部通过")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
