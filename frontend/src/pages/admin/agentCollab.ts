/**
 * 协作视图共用的数据推导：把运维入口返回的真实轨迹转成
 * 「谁把什么交给了谁」的阶段/消息流，三个展示组件共用，避免各写一套解析。
 */
import type { DraftTestRole, DraftTestTrace } from '@/api/patientDraftTest'

/** 结构化输出的宽松视图：键由后端记录决定，逐字段读取时做存在性判断。 */
export type JsonRecord = Record<string, unknown>

export interface Handoff {
  label: string
  detail: string
}

export interface CollabStage {
  sequence: number
  startedAt: string | null
  completedAt: string | null
  role: 'VISION' | 'EVIDENCE' | 'EXPLANATION' | 'CRITIC'
  label: string
  duty: string
  state: 'PENDING' | 'RUNNING' | 'DONE' | 'STOPPED'
  elapsedMs: number | null
  /** 从上一个角色收到的东西（阶段之间的接力棒）。 */
  received: string | null
  /** 本角色交给下一个角色的东西。 */
  handoff: Handoff | null
  context: Record<string, unknown> | null
  result: Record<string, unknown> | null
}

export const ROLE_ORDER = ['VISION', 'EVIDENCE', 'EXPLANATION', 'CRITIC'] as const

const ROLE_META: Record<CollabStage['role'], { label: string; duty: string }> = {
  VISION: { label: '图像信息整理', duty: '只读既有推理摘要与质量限制' },
  EVIDENCE: { label: '受控资料检索', duty: '生成查询并冻结合格资料片段' },
  EXPLANATION: { label: '分层说明生成', duty: '按冻结证据写六区段草稿' },
  CRITIC: { label: '一致性检查', duty: '独立复核并提出可定位异议' },
}

const asObject = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null

/** 从一次真实运行的角色消息里推导出接力关系；尚未运行的角色显示为 PENDING。 */
export function buildStages(trace: DraftTestTrace | null): CollabStage[] {
  const rows = [...(trace?.roles ?? [])].sort((a, b) => a.sequence - b.sequence)
  const ordered = rows.filter(row => ROLE_ORDER.some(role => role === row.role))
  const missing = ROLE_ORDER.filter(role => !ordered.some(row => row.role === role))
  const stages: CollabStage[] = [...ordered, ...missing.map(role => ({ role }))].map(row => {
    const role = row.role as CollabStage['role']
    const actual = 'sequence' in row ? row as DraftTestRole : undefined
    const result = asObject(actual?.result)
    const state: CollabStage['state'] = !actual ? 'PENDING'
      : actual.state === 'COMPLETED' ? 'DONE'
      : actual.state === 'STARTED' ? 'RUNNING' : 'STOPPED'
    return {
      role, sequence: actual?.sequence ?? 0, startedAt: actual?.startedAt ?? null, completedAt: actual?.completedAt ?? null,
      label: ROLE_META[role].label, duty: ROLE_META[role].duty, state,
      elapsedMs: actual?.elapsedMs ?? null, received: actual?.collaboration
        ? actual.collaboration.inbox.map(message => `${message.senderRole} #${message.sourceSequence} · ${message.kind}`).join('；') || null
        : null,
      handoff: handoff(role, result), context: asObject(actual?.context), result,
    }
  })
  if (trace?.workflowVersion !== 'AUTONOMOUS_V2') {
    for (let i = 1; i < stages.length; i++) stages[i].received = stages[i - 1].handoff?.label ?? null
  }
  return stages
}

/** 每张「数据卡」的内容，来自该角色真实产出的结构化结果。 */
function list(value: unknown): number { return Array.isArray(value) ? value.length : 0 }
function handoff(role: CollabStage['role'], result: JsonRecord | null): Handoff | null {
  if (!result) return null
  switch (role) {
    case 'VISION': return { label: '图像摘要与限制', detail: String(result.summary ?? '—') }
    case 'EVIDENCE': return {
      label: '冻结证据',
      detail: `查询「${asObject(result.search)?.query ?? '—'}」· ${list(result.citations)} 条片段`,
    }
    case 'EXPLANATION': return {
      label: '分层草稿',
      detail: `${list(result.claims)} 条声明 · 证据版本 ${result.evidenceVersion ?? '—'}`,
    }
    case 'CRITIC': return {
      label: '复核结论',
      detail: result.action === 'NONE' ? '无异议 NONE' : `${result.action} · ${list(result.objections)} 条异议`,
    }
  }
}

/** 聊天视图用的一句话发言稿，取自真实输出。 */
export function stageUtterance(stage: CollabStage): string {
  const r = stage.result
  if (!r) return stage.state === 'STOPPED' ? '（本次没有产出结果）' : '（尚未开始）'
  const list = (key: string): number => Array.isArray(r[key]) ? (r[key] as unknown[]).length : 0
  switch (stage.role) {
    case 'VISION': return String(r.summary ?? '—')
    case 'EVIDENCE': return `我按「${(r.search as Record<string, unknown> | undefined)?.query ?? '—'}」检索到 ${list('citations')} 条合格片段，已冻结为证据集。`
    case 'EXPLANATION': return `基于冻结证据写了 ${list('claims')} 条声明，每条都标注了引用索引与原文。`
    case 'CRITIC': return r.action === 'NONE'
      ? '草稿与证据一致，没有可定位的异议。'
      : `发现 ${list('objections')} 处问题，要求 ${r.action === 'SUPPLEMENT' ? '补证' : '重写'}。`
    default: return '—'
  }
}


/** 异议指向具体 claim 或材料；把 target 解析回当时被复核的草稿声明原文。 */
export interface DiscussionObjection {
  target: string
  reason: string
  claimText: string | null
  section: string | null
}

export interface DiscussionTurn {
  key: string
  sequence: number
  role: CollabStage['role']
  label: string
  state: CollabStage['state']
  elapsedMs: number | null
  startedAt: string | null
  completedAt: string | null
  /** 议事录条目类型，全部由真实输出/消息推导，不编造。 */
  entryKind: 'work' | 'objection' | 'revision' | 'consensus'
  /** 自然语言发言稿，取自该角色真实输出；不编造讨论内容。 */
  utterance: string
  /** 本轮发言回应了谁（由 senderRole → recipientRole 推导）。 */
  addressedTo: string[]
  /** 被引用回应的原话（含对方 claim 原文与异议理由）。 */
  quotes: { from: string; text: string; label: string }[]
  objections: DiscussionObjection[]
  /** causationMessageId 串成的回复关系：本轮输出回应了哪几条真实消息。 */
  replyTo: { messageId: string; label: string }[]
  /** 缩进层级：异议打回后的修订与复核属于同一段来回。 */
  depth: number
  isReply: boolean
  isConsensus: boolean
  isFeedback: boolean
}

const roleLabel = (role: string): string =>
  (ROLE_META as Record<string, { label: string }>)[role]?.label ?? role

/** 从草稿负载（DRAFT_READY 的 payload 或 EXPLANATION 的 result）解析 claim 原文。 */
function claimsOf(value: unknown): Map<string, { text: string; section: string }> {
  const map = new Map<string, { text: string; section: string }>()
  const obj = asObject(value)
  for (const raw of Array.isArray(obj?.claims) ? obj.claims : []) {
    const claim = asObject(raw)
    const id = typeof claim?.id === 'string' ? claim.id : null
    if (id && claim) map.set(id, { text: String(claim.text ?? ''), section: String(claim.section ?? '') })
  }
  return map
}

/**
 * ③ 讨论线程：只从真实落库消息推导，不生成脚本化对话。
 * - @ 来自 senderRole → recipientRole；
 * - 引用来自 payload.objections[].target 反查「当时被复核的那一版」草稿 claims[].id；
 * - 回复关系来自 outgoing.causationMessageId，缩进来自 REWRITE/SUPPLEMENT 请求。
 */
export function buildDiscussion(trace: DraftTestTrace | null): DiscussionTurn[] {
  if (!trace) return []
  const rows = [...trace.roles].sort((a, b) => a.sequence - b.sequence)

  // messageId → 发信角色/类型，用来把 causationMessageId 解析成「回复了谁」。
  const messageIndex = new Map<string, { senderRole: string; kind: string }>()
  for (const row of rows)
    for (const m of row.collaboration?.outgoing ?? [])
      messageIndex.set(m.messageId, { senderRole: m.senderRole, kind: m.kind })

  // 按序号推进维护「当前草稿」：修订会替换，异议引用的始终是当时被复核的那一版。
  const currentClaims = new Map<string, { text: string; section: string }>()
  const feedbackBySequence = new Map<number, DiscussionObjection[]>()

  for (const row of rows) {
    const result = asObject(row.result)
    if (row.role === 'EXPLANATION') {
      // 优先采用发给 Critic 的 DRAFT_READY 负载（即真正被复核的草稿）。
      const sent = (row.collaboration?.outgoing ?? []).find(m => m.kind === 'DRAFT_READY')
      const fromSent = sent ? claimsOf(sent.payload) : null
      const claims = fromSent && fromSent.size ? fromSent : claimsOf(result)
      currentClaims.clear()
      for (const [id, claim] of claims) currentClaims.set(id, claim)
    }
    if (row.role === 'CRITIC' && result) {
      // Critic 收件箱里的 DRAFT_READY 是最精确的被复核草稿；缺失时回退到当前草稿。
      const reviewed = (row.collaboration?.inbox ?? [])
        .filter(m => m.kind === 'DRAFT_READY').map(m => claimsOf(m.payload))
        .find(claims => claims.size) ?? currentClaims
      const objections: DiscussionObjection[] = []
      for (const raw of Array.isArray(result.objections) ? result.objections : []) {
        const item = asObject(raw)
        const target = String(item?.target ?? '')
        const claim = target.startsWith('claim:') ? reviewed.get(target.slice('claim:'.length)) : undefined
        objections.push({
          target, reason: String(item?.reason ?? ''),
          claimText: claim?.text ?? null, section: claim?.section ?? null,
        })
      }
      if (objections.length) feedbackBySequence.set(row.sequence, objections)
    }
  }

  const roles = rows.filter(row => ROLE_ORDER.some(role => role === row.role))
  return roles.map(row => {
    const role = row.role as CollabStage['role']
    const result = asObject(row.result)
    const state: CollabStage['state'] = row.state === 'COMPLETED' ? 'DONE'
      : row.state === 'STARTED' ? 'RUNNING' : 'STOPPED'
    const stage: CollabStage = {
      role, sequence: row.sequence, startedAt: row.startedAt, completedAt: row.completedAt,
      label: ROLE_META[role].label, duty: ROLE_META[role].duty, state,
      elapsedMs: row.elapsedMs, received: null, handoff: null,
      context: asObject(row.context), result,
    }
    const incoming = row.collaboration?.inbox ?? []
    const outgoing = row.collaboration?.outgoing ?? []
    const feedback = feedbackBySequence.get(row.sequence) ?? []
    const isFeedback = feedback.length > 0 || outgoing.some(m => m.kind.endsWith('REQUESTED'))
    const isConsensus = outgoing.some(m => m.kind === 'REVIEW_COMPLETED')

    // 修订/复核的缩进来自「本轮收到的消息里是否带有打回请求」。
    const causedByFeedback = incoming.some(m => m.kind.endsWith('REQUESTED'))
    const priorFeedback = [...feedbackBySequence.keys()].filter(seq => seq < row.sequence).length > 0
    const depth = causedByFeedback || (priorFeedback && (role === 'EXPLANATION' || role === 'CRITIC')) ? 1 : 0

    const addressedTo = [...new Set(outgoing.map(m => m.recipientRole))]
      .filter(to => to !== 'GATE')

    // 用真实 causationMessageId 串出回复对象，而不是写死一句「回应上一轮」。
    const causationIds = [...new Set([
      ...outgoing.map(m => m.causationMessageId).filter((id): id is string => !!id),
      ...incoming.filter(m => m.kind.endsWith('REQUESTED')).map(m => m.messageId),
    ])]
    const replyTo = causationIds.map(id => {
      const source = messageIndex.get(id)
      return { messageId: id, label: source ? `${roleLabel(source.senderRole)} · ${source.kind}` : id }
    })

    const quotes: DiscussionTurn['quotes'] = []
    for (const objection of feedback) {
      if (objection.claimText) quotes.push({
        from: '分层说明生成', label: objection.target, text: objection.claimText,
      })
      quotes.push({ from: '一致性检查', label: objection.reason ? '异议' : objection.target, text: objection.reason || objection.target })
    }
    // 修订轮引用被回应的那条打回消息（causation）所指的异议理由。
    for (const message of incoming.filter(m => m.kind.endsWith('REQUESTED'))) {
      const payload = asObject(message.payload)
      for (const raw of Array.isArray(payload?.objections) ? payload.objections : []) {
        const item = asObject(raw)
        const reason = String(item?.reason ?? '')
        if (reason) quotes.push({ from: '一致性检查', label: '被打回', text: reason })
      }
    }

    const entryKind: DiscussionTurn['entryKind'] = isFeedback ? 'objection'
      : isConsensus ? 'consensus'
      : causedByFeedback ? 'revision'
      : 'work'

    return {
      key: `${role}-${row.sequence}`, sequence: row.sequence, role,
      label: ROLE_META[role].label, state, elapsedMs: row.elapsedMs,
      startedAt: row.startedAt, completedAt: row.completedAt, entryKind,
      utterance: stageUtterance(stage), addressedTo, quotes, objections: feedback, replyTo,
      depth, isReply: causedByFeedback || isFeedback, isConsensus, isFeedback,
    }
  })
}

export interface AutonomyEvent {
  id: string
  at: number
  lane: CollabStage['role']
  kind: 'work' | 'message' | 'objection' | 'rewrite' | 'review' | 'stop'
  text: string
  route?: string
}

/** Events are reconstructed from persisted times and accepted outgoing messages, never a sample script. */
export function buildAutonomyEvents(trace: DraftTestTrace | null): AutonomyEvent[] {
  if (!trace || trace.workflowVersion !== 'AUTONOMOUS_V2') return []
  const base = Date.parse(trace.startedAt ?? '')
  if (!Number.isFinite(base)) return []
  const events: AutonomyEvent[] = []
  for (const row of trace.roles) {
    if (!ROLE_ORDER.some(role => role === row.role)) continue
    const lane = row.role as CollabStage['role']
    const start = Date.parse(row.startedAt ?? '')
    const end = Date.parse(row.completedAt ?? '')
    if (Number.isFinite(start)) events.push({ id: `${row.sequence}-start`, at: Math.max(0, start - base), lane,
      kind: row.role === 'EXPLANATION' && row.sequence > 3 ? 'rewrite' : 'work', text: `#${row.sequence} ${ROLE_META[lane].label}开始` })
    if (Number.isFinite(end)) events.push({ id: `${row.sequence}-end`, at: Math.max(0, end - base), lane,
      kind: row.state === 'STOPPED' ? 'stop' : 'work', text: `#${row.sequence} ${row.state === 'STOPPED' ? '已停止' : '已返回'} · ${row.elapsedMs ?? '—'} ms` })
    for (const message of row.collaboration?.outgoing ?? []) {
      const payload = asObject(message.payload)
      const objections = Array.isArray(payload?.objections) ? payload.objections.map(item => {
        const objection = asObject(item)
        return `${objection?.target ?? ''}：${objection?.reason ?? ''}`
      }).join('；') : ''
      // Persisted Java Instant values may be epoch seconds; outer HTTP timestamps are ISO strings.
      const sent = typeof message.sentAt === 'number' ? message.sentAt * 1000 : Date.parse(message.sentAt ?? '')
      events.push({ id: message.messageId, at: Math.max(0, (Number.isFinite(sent) ? sent : Number.isFinite(end) ? end : start) - base), lane,
        kind: message.kind.endsWith('REQUESTED') ? 'objection' : message.kind === 'REVIEW_COMPLETED' ? 'review' : 'message',
        route: `${message.senderRole} → ${message.recipientRole}`, text: `${message.kind} · 证据 v${message.evidenceVersion ?? '—'} / 草稿 v${message.draftVersion ?? '—'}${objections ? ' · ' + objections : ''}` })
    }
  }
  return events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}
