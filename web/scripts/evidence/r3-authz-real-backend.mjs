/**
 * R3 真实后端验收：历史授权边界。
 *
 * 只打真实 Java 后端（默认 http://localhost:18081/api），不拦截任何请求：
 *   1. 注册两个真实账号 A / B；
 *   2. A 发一条消息，产生真实的会话与历史；
 *   3. B 读 A 的 /agent/history/{threadId} → 必须是拒绝（code != 0），且不泄露任何消息；
 *   4. B 的会话列表里不能出现 A 的会话；
 *   5. 未登录请求同样被拒；
 *   6. A 自己读得到，证明拒绝来自授权判断而不是接口坏了。
 *
 * 用法：
 *   R3_API_BASE=http://localhost:18081/api node scripts/evidence/r3-authz-real-backend.mjs
 *
 * 产物：EVIDENCE_OUT/r3-authz-real-backend.json（默认 web/test-results/r3-authz）。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const BASE = process.env.R3_API_BASE ?? "http://localhost:18081/api"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), "test-results", "r3-authz")

const stamp = Date.now().toString(36)
const accountA = `r3authza${stamp}`
const accountB = `r3authzb${stamp}`
const password = `Probe-${randomUUID().slice(0, 12)}`
const threadId = randomUUID()

const report = { base: BASE, accounts: [accountA, accountB], threadId, checks: {}, failures: [] }
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
    json = { raw: text.slice(0, 300) }
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

async function login(account) {
  const registered = await postJson("/user/register", {
    userAccount: account,
    userPassword: password,
    checkPassword: password,
  })
  if (registered.json?.code !== 0) throw new Error(`注册失败 ${account}: ${JSON.stringify(registered.json)}`)
  const logged = await postJson("/user/login", { userAccount: account, userPassword: password })
  if (logged.json?.code !== 0) throw new Error(`登录失败 ${account}: ${JSON.stringify(logged.json)}`)
  const cookie = cookieFrom(logged.response)
  if (!cookie) throw new Error(`${account} 登录响应没有会话 Cookie`)
  return { cookie, userId: logged.json?.data?.id ?? null }
}

/** 读 SSE 直到 done，返回收到的消息类型序列。 */
async function drainStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const messageTypes = []
  let done = false
  while (true) {
    const { value, done: finished } = await reader.read()
    if (finished) break
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
      if (eventName === "done") {
        done = true
        continue
      }
      const data = dataLines.join("\n")
      if (!data) continue
      try {
        const dto = JSON.parse(data)
        if (dto.messageType) messageTypes.push(dto.messageType)
      } catch {
        /* 非 JSON 片段不计入 */
      }
    }
  }
  return { done, messageTypes }
}

async function main() {
  console.log(`→ ${BASE}`)

  const userA = await login(accountA)
  const userB = await login(accountB)
  report.checks.userA = userA.userId
  report.checks.userB = userB.userId
  if (userA.userId && userB.userId && userA.userId === userB.userId) fail("两个账号拿到了同一个用户 ID")
  else ok("两个独立账号登录成功")

  // 1. A 发一条消息，产生真实会话与历史
  const stream = await fetch(`${BASE}/agent/chat/stream`, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json", Cookie: userA.cookie },
    body: JSON.stringify({ message: "你好，请用一句话说明你能做什么。", threadId }),
  })
  if (!stream.ok) throw new Error(`SSE 响应 ${stream.status}: ${await stream.text()}`)
  const { done, messageTypes } = await drainStream(stream)
  report.checks.streamDone = done
  report.checks.messageTypes = messageTypes
  if (!done) fail("A 的流没有以 done 收口")
  else ok(`A 的会话收到 ${messageTypes.length} 条消息并以 done 收口`)

  // 2. B 读 A 的历史：必须被拒，且响应里不能出现 A 的正文
  const crossRead = await fetch(`${BASE}/agent/history/${threadId}?limit=20`, {
    headers: { Cookie: userB.cookie, Accept: "application/json" },
  })
  const crossBody = await crossRead.json()
  report.checks.crossRead = { httpStatus: crossRead.status, code: crossBody?.code, msg: crossBody?.msg }
  const crossLeaked = Array.isArray(crossBody?.data?.messages) && crossBody.data.messages.length > 0
  if (crossLeaked) fail("B 读到了 A 的历史消息——授权边界失效")
  else if (crossBody?.code === 0) fail("B 读 A 的历史返回了成功码（data 为空也算越权放行）")
  else ok(`B 读 A 的历史被拒（code=${crossBody?.code}，${crossBody?.msg ?? ""}）`)

  // 3. B 的会话列表不含 A 的会话
  const sessions = await fetch(`${BASE}/agent/sessions?limit=20`, {
    headers: { Cookie: userB.cookie, Accept: "application/json" },
  })
  const sessionsBody = await sessions.json()
  const list = sessionsBody?.data ?? []
  report.checks.crossSessions = list.length
  if (list.some((item) => item?.threadId === threadId || item?.id === threadId || item?.sessionId === threadId)) {
    fail("B 的会话列表里出现了 A 的会话")
  } else {
    ok(`B 的会话列表（${list.length} 条）不含 A 的会话`)
  }

  // 4. 未登录：同样被拒
  const anonymous = await fetch(`${BASE}/agent/history/${threadId}?limit=20`, {
    headers: { Accept: "application/json" },
  })
  const anonymousBody = await anonymous.json()
  report.checks.anonymous = { httpStatus: anonymous.status, code: anonymousBody?.code }
  if (anonymousBody?.code === 0) fail("未登录也能读历史")
  else ok(`未登录读历史被拒（code=${anonymousBody?.code}）`)

  // 5. 正对照：A 自己读得到（证明拒绝是授权判断，不是接口坏了）
  const own = await fetch(`${BASE}/agent/history/${threadId}?limit=20`, {
    headers: { Cookie: userA.cookie, Accept: "application/json" },
  })
  const ownBody = await own.json()
  const ownMessages = ownBody?.data?.messages ?? []
  report.checks.ownMessages = ownMessages.length
  if (ownBody?.code !== 0 || ownMessages.length === 0) {
    fail(`A 读自己的历史失败：${JSON.stringify(ownBody).slice(0, 200)}`)
  } else {
    ok(`A 读自己的历史返回 ${ownMessages.length} 条消息（正对照成立）`)
  }

  report.checks.failures = report.failures.length
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, "r3-authz-real-backend.json")
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n产物：${file}`)
  if (report.failures.length > 0) {
    console.error(`\n${report.failures.length} 项失败`)
    process.exitCode = 1
  } else {
    console.log("\n历史授权边界：全部通过")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
