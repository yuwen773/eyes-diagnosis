/** TASK-03 v1: metadata only. No draft text, reasoning or image URLs. */
export const roles = ["VISION", "EVIDENCE", "EXPLANATION", "CRITIC"] as const
export type Role = (typeof roles)[number]
export const executionStatuses = [
  "ACCEPTED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "SUCCEEDED",
  "RESTRICTED",
  "FAILED",
  "CANCELLED",
] as const
export type ExecutionStatus = (typeof executionStatuses)[number]
export const reviewStatuses = [
  "NOT_SUBMITTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "INVALIDATED",
] as const
export type ReviewStatus = (typeof reviewStatuses)[number]
export type RoleStatus = "RUNNING" | "COMPLETED" | "STOPPED"
export type CollaborationSnapshot = {
  runId: string
  taskId: string
  threadId: string
  runtimeKind: "COORDINATOR" | "GRAPH"
  workflowVersion: string
  executionStatus: ExecutionStatus
  reviewStatus: ReviewStatus
  reason: string | null
  roles: Partial<Record<Role, RoleStatus>>
  snapshotSequence: number
  resumeCursor: string
  projectionVersion: string
}

type Payloads = {
  "run.accepted": { status: "ACCEPTED" }
  "run.started": { status: "RUNNING" }
  "run.review_ready": { draftVersion: number; reviewStatus: "PENDING" }
  "run.completed": { status: "SUCCEEDED"; reviewStatus: "PENDING" }
  "run.restricted": { status: "RESTRICTED"; reason: string }
  "run.failed": { status: "FAILED"; reason: string }
  "run.cancel_requested": { status: "CANCEL_REQUESTED" }
  "run.cancelled": { status: "CANCELLED" }
  "agent.started": { call: number }
  "agent.completed": { call: number }
  // 2026-11-13 后端新增（P0-03/R2 首片）：summary 只携带结构化事实标记，绝不携带临床正文。
  // summaryToken 是受控枚举前缀；原样字符串由 labels 层映射，未知 token 只显示「阶段完成」。
  "agent.summary": {
    call: number
    summary: string
    limitationCount: number
  }
  // 医生投影：content 是该角色已校验结构化输出记录（与服务端 encode 的一致 JSON 字符串）。
  // 仅 v1:admin / v1:doctor:<reviewId> 投影会收到本类事件；患者投影在服务端已被过滤。
  "agent.readable": {
    call: number
    messageId: string
    to: string
    kind: string
    content: string
  }
  "agent.feedback.requested": { action: "REWRITE" | "SUPPLEMENT"; call: number }
  "agent.handoff": { messageId: string; to: string; kind: string; call: number }
  "evidence.verified": { evidenceVersion: number }
  "agent.revision.completed": { draftVersion: number; evidenceVersion: number }
}
export type CollaborationEvent = {
  [K in keyof Payloads]: {
    eventId: string
    schemaVersion: 1
    runId: string
    threadId: string
    sequence: number
    occurredAt: string
    type: K
    actor: Role | "COORDINATOR"
    visibility: "PATIENT" | "CLINICIAN"
    payload: Payloads[K]
  }
}[keyof Payloads]
export type CollaborationFrame = {
  cursor: string
  event: CollaborationEvent | null
}

export class CollaborationProtocolError extends Error {
  constructor() {
    super("SNAPSHOT_REQUIRED")
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CollaborationProtocolError()
  return value as Record<string, unknown>
}
function ensure(valid: unknown): asserts valid {
  if (!valid) throw new CollaborationProtocolError()
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}
function integer(value: unknown, min = 1): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min
}
// JsonConfig serializes Java long as decimal strings; fixtures/tools may use numbers.
function sequence(value: unknown): number {
  const n =
    typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
      ? Number(value)
      : value
  ensure(integer(n, 0))
  return n
}
function exact(value: Record<string, unknown>, keys: string[]) {
  ensure(
    Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key))
  )
}

export function parseSnapshot(value: unknown): CollaborationSnapshot {
  const s = record(value)
  exact(s, [
    "runId",
    "taskId",
    "threadId",
    "runtimeKind",
    "workflowVersion",
    "executionStatus",
    "reviewStatus",
    "reason",
    "roles",
    "snapshotSequence",
    "resumeCursor",
    "projectionVersion",
  ])
  ensure(
    [
      s.runId,
      s.taskId,
      s.threadId,
      s.workflowVersion,
      s.resumeCursor,
      s.projectionVersion,
    ].every(nonempty)
  )
  ensure(s.runtimeKind === "COORDINATOR" || s.runtimeKind === "GRAPH")
  ensure(executionStatuses.some((status) => status === s.executionStatus))
  ensure(reviewStatuses.some((status) => status === s.reviewStatus))
  ensure(s.reason === null || nonempty(s.reason))
  const watermark = sequence(s.snapshotSequence)
  ensure(
    Object.entries(record(s.roles)).every(
      ([role, status]) =>
        roles.some((r) => r === role) &&
        ["RUNNING", "COMPLETED", "STOPPED"].includes(String(status))
    )
  )
  return { ...s, snapshotSequence: watermark } as CollaborationSnapshot
}

const payloadKeys: Record<CollaborationEvent["type"], string[]> = {
  "run.accepted": ["status"],
  "run.started": ["status"],
  "run.review_ready": ["draftVersion", "reviewStatus"],
  "run.completed": ["status", "reviewStatus"],
  "run.restricted": ["status", "reason"],
  "run.failed": ["status", "reason"],
  "run.cancel_requested": ["status"],
  "run.cancelled": ["status"],
  "agent.started": ["call"],
  "agent.completed": ["call"],
  "agent.summary": ["call", "summary", "limitationCount"],
  "agent.readable": ["call", "messageId", "to", "kind", "content"],
  "agent.feedback.requested": ["action", "call"],
  "agent.handoff": ["messageId", "to", "kind", "call"],
  "evidence.verified": ["evidenceVersion"],
  "agent.revision.completed": ["draftVersion", "evidenceVersion"],
}
const eventStatuses: Record<string, string> = {
  "run.accepted": "ACCEPTED",
  "run.started": "RUNNING",
  "run.completed": "SUCCEEDED",
  "run.restricted": "RESTRICTED",
  "run.failed": "FAILED",
  "run.cancel_requested": "CANCEL_REQUESTED",
  "run.cancelled": "CANCELLED",
}

export function parseFrame(
  name: string,
  cursor: string,
  data: string
): CollaborationFrame {
  ensure(nonempty(cursor) && new TextEncoder().encode(data).length <= 32_768)
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    throw new CollaborationProtocolError()
  }
  const e = record(raw)
  ensure(e.schemaVersion === 1)
  if (name === "run.heartbeat") {
    exact(e, ["schemaVersion"])
    return { cursor, event: null }
  }
  exact(e, [
    "eventId",
    "schemaVersion",
    "runId",
    "threadId",
    "sequence",
    "occurredAt",
    "type",
    "actor",
    "visibility",
    "payload",
  ])
  const seq = sequence(e.sequence)
  ensure(nonempty(e.runId) && nonempty(e.threadId) && seq > 0)
  ensure(
    e.eventId === `${e.runId}:${seq}` &&
      nonempty(e.occurredAt) &&
      Number.isFinite(Date.parse(e.occurredAt))
  )
  ensure(name === e.type && Object.hasOwn(payloadKeys, name))
  const payload = record(e.payload)
  exact(payload, payloadKeys[name as CollaborationEvent["type"]])
  for (const [key, value] of Object.entries(payload)) {
    ensure(
      ["call", "draftVersion", "evidenceVersion", "limitationCount"].includes(
        key
      )
        ? integer(value, key === "limitationCount" ? 0 : 1)
        : nonempty(value)
    )
  }
  // agent.summary 只接受服务端受控的结构化事实标记（见 docs/collaboration-runs.md）；
  // 任何自由文本都是协议违规——fail-closed 触发快照自愈，而不是渲染未知内容。
  if (name === "agent.summary") {
    const summary = payload.summary as string
    ensure(
      summary === "EVIDENCE_FROZEN" ||
        summary === "DRAFT_PENDING_REVIEW" ||
        summary.startsWith("VISION_REVIEW_QUALITY:") ||
        summary.startsWith("CRITIC_")
    )
  }
  ensure(!eventStatuses[name] || payload.status === eventStatuses[name])
  if (name === "run.review_ready" || name === "run.completed")
    ensure(payload.reviewStatus === "PENDING")
  if (name === "agent.feedback.requested")
    ensure(payload.action === "REWRITE" || payload.action === "SUPPLEMENT")
  const clinician = [
    "agent.handoff",
    "agent.readable",
    "evidence.verified",
    "agent.revision.completed",
  ].includes(name)
  ensure(e.visibility === (clinician ? "CLINICIAN" : "PATIENT"))
  ensure(
    name.startsWith("run.")
      ? e.actor === "COORDINATOR"
      : roles.some((role) => role === e.actor)
  )
  if (name === "agent.feedback.requested") ensure(e.actor === "CRITIC")
  if (name === "evidence.verified") ensure(e.actor === "EVIDENCE")
  if (name === "agent.revision.completed") ensure(e.actor === "EXPLANATION")
  return { cursor, event: { ...e, sequence: seq } as CollaborationEvent }
}

export function isTerminal(status: ExecutionStatus) {
  return ["SUCCEEDED", "RESTRICTED", "FAILED", "CANCELLED"].includes(status)
}
