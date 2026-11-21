/**
 * R3 真实后端验收：时间契约 + 工具结果闭环。
 *
 * 只打真实 Java 后端（默认 http://localhost:18081/api），不拦截任何请求。
 * 它会注册一个临时账号、发一条会触发工具调用的真实消息，然后核对：
 *   1. SSE 里的每个 timestamp 都带时区偏移；
 *   2. tool-request 的 toolCallId 与 tool-result 的 toolCallId 一一对应；
 *   3. tool-result 的 status 有观察依据（success / error / timeout / cancelled /
 *      completed），不是前端猜的；
 *   4. 历史接口的 createdTime 同样带偏移，工具行是带 toolCallId 的 JSON；
 *   5. 流以 done 事件收口。
 *
 * 用法：
 *   R3_API_BASE=http://localhost:18081/api node scripts/evidence/r3-agent-real-backend.mjs
 *
 * 产物：EVIDENCE_OUT/r3-real-backend.json（默认 web/test-results/r3-acceptance）。
 * 临时账号保留在本地库里，便于复核；脚本不打印也不保存密码之外的凭据。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

const BASE = process.env.R3_API_BASE ?? "http://localhost:18081/api"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), "test-results", "r3-acceptance")
const OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/

const account = `r3probe${Date.now().toString(36)}`
const password = `Probe-${randomUUID().slice(0, 12)}`
const threadId = randomUUID()

const report = { base: BASE, account, threadId, checks: {}, events: [], history: [], failures: [] }

function fail(message) {
  report.failures.push(message)
  console.error(`✗ ${message}`)
}

function ok(message) {
  console.log(`✓ ${message}`)
}

async function postJson(path, body, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  return { response, json }
}

/** 从 Set-Cookie 里取 name=value，拼成请求用的 Cookie 头。 */
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

/** 读 SSE：按空行分帧，收集 event 名与 data。 */
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

const main = async () => {
  console.log(`→ ${BASE}`)

  const registered = await postJson("/user/register", {
    userAccount: account,
    userPassword: password,
    checkPassword: password,
  })
  if (registered.json?.code !== 0) {
    throw new Error(`注册失败: ${JSON.stringify(registered.json)}`)
  }

  const login = await postJson("/user/login", { userAccount: account, userPassword: password })
  if (login.json?.code !== 0) {
    throw new Error(`登录失败: ${JSON.stringify(login.json)}`)
  }
  const cookie = cookieFrom(login.response)
  if (!cookie) throw new Error("登录响应没有会话 Cookie")

  const current = await fetch(`${BASE}/user/get/login`, { headers: { Cookie: cookie } })
  const currentBody = await current.json()
  report.checks.login = currentBody?.data?.id ?? null
  if (!report.checks.login) throw new Error("会话未生效")

  const question =
    "请从知识库检索青光眼早期筛查的要点，并说明你检索了什么。回答用 Markdown，包含小标题和要点列表。"
  const streamResponse = await fetch(`${BASE}/agent/chat/stream`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ message: question, threadId }),
  })
  if (!streamResponse.ok) {
    throw new Error(`SSE 响应 ${streamResponse.status}: ${await streamResponse.text()}`)
  }
  const contentType = streamResponse.headers.get("content-type") ?? ""
  report.checks.contentType = contentType
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`不是 SSE 流：${contentType}`)
  }

  let done = false
  let assistantChars = 0
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
      event: eventName,
      messageType: dto.messageType,
      toolCallId: dto.toolCallId ?? null,
      toolName: dto.toolName ?? null,
      status: dto.status ?? null,
      timestamp: dto.timestamp ?? null,
      toolCalls: dto.toolCalls ?? null,
      contentLength: typeof dto.content === "string" ? dto.content.length : null,
      contentHead: typeof dto.content === "string" ? dto.content.slice(0, 80) : null,
    })
    if (dto.messageType === "assistant") assistantChars += (dto.content ?? "").length
  })

  if (!done) fail("流没有以 done 事件收口")
  else ok("SSE 以 done 事件收口")

  const timed = report.events.filter((e) => e.timestamp !== null)
  const untimed = report.events.filter((e) => e.timestamp === null && e.event !== "message")
  if (timed.length === 0) fail("SSE 里没有任何 timestamp")
  for (const event of timed) {
    if (!OFFSET.test(event.timestamp)) fail(`时间戳缺少偏移：${event.timestamp}`)
  }
  report.checks.timestampsWithOffset = timed.length
  report.checks.eventsWithoutTimestamp = untimed.length
  if (timed.length > 0 && timed.every((e) => OFFSET.test(e.timestamp))) {
    ok(`${timed.length} 个 SSE 时间戳全部带时区偏移`)
  }

  const requests = report.events.filter((e) => e.messageType === "tool-request")
  const results = report.events.filter((e) => e.messageType === "tool-result")
  report.checks.toolRequests = requests.length
  report.checks.toolResults = results.length

  for (const request of requests) {
    for (const call of request.toolCalls ?? []) {
      if (!call.id) fail(`tool-request 缺少 toolCallId: ${JSON.stringify(call)}`)
      const match = results.find((r) => r.toolCallId === call.id)
      if (!match) {
        fail(`工具 ${call.name}(${call.id}) 没有对应结果`)
        continue
      }
      const allowed = ["success", "error", "timeout", "cancelled", "completed", "unknown"]
      if (!allowed.includes(match.status)) fail(`意外的工具状态：${match.status}`)
      if (match.status === "success" && !match.contentLength) {
        fail(`工具 ${call.name} 标成功但结果为空`)
      }
      ok(`工具 ${call.name} → ${match.status}（结果 ${match.contentLength} 字符）`)
    }
  }
  if (requests.length === 0) {
    report.checks.toolInvoked = false
    console.warn("⚠ 本次真实回答没有触发工具调用（模型自己回答了），工具闭环这条不算已验证")
  } else {
    report.checks.toolInvoked = true
  }

  report.checks.assistantChars = assistantChars
  if (assistantChars === 0) fail("没有收到任何 assistant 文本")

  // 历史：时间戳同样带偏移，工具行是带 toolCallId 的 JSON。
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const historyResponse = await fetch(`${BASE}/agent/history/${threadId}?limit=50`, {
    headers: { Cookie: cookie, Accept: "application/json" },
  })
  const historyBody = await historyResponse.json()
  const messages = historyBody?.data?.messages ?? []
  report.checks.historyMessages = messages.length
  for (const message of messages) {
    report.history.push({
      role: message.role,
      subType: message.subType,
      createdTime: message.createdTime,
      contentHead: String(message.content ?? "").slice(0, 100),
    })
    if (!OFFSET.test(String(message.createdTime ?? ""))) {
      fail(`历史 createdTime 缺少偏移：${message.createdTime}`)
    }
  }
  const toolCallRows = messages.filter((m) => m.subType === "tool-call")
  const toolResultRows = messages.filter((m) => m.subType === "tool-result")
  report.checks.historyToolCallRows = toolCallRows.length
  report.checks.historyToolResultRows = toolResultRows.length
  for (const row of [...toolCallRows, ...toolResultRows]) {
    try {
      const parsed = JSON.parse(row.content)
      if (!parsed.toolCallId) fail(`历史工具行缺少 toolCallId: ${row.content.slice(0, 120)}`)
    } catch {
      fail(`历史工具行不是 JSON（旧格式不做强断言）：${String(row.content).slice(0, 80)}`)
    }
  }
  if (messages.length > 0 && messages.every((m) => OFFSET.test(String(m.createdTime)))) {
    ok(`${messages.length} 条历史消息的时间都带时区偏移`)
  }

  report.checks.failures = report.failures.length
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, "r3-real-backend.json")
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n产物：${file}`)
  if (report.failures.length > 0) {
    console.error(`\n${report.failures.length} 项失败`)
    process.exitCode = 1
  } else {
    console.log("\n真实后端验收：全部通过")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
