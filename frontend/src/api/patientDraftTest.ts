import request from '@/request'

/**
 * 运维入口：手动触发四 Agent 草稿流程并读取逐角色轨迹。
 * 后端仅在 `eye-diagnosis.draft.test-entry.enabled=true` 时注册，且只对管理员开放。
 */
export interface DraftTestTask {
  taskId: string
  status: string
  runStatus: string | null
  stopReason: string | null
  calls: number
  createdAt: string
}

export interface CollabMessage {
  messageId: string
  taskId: string
  workflowVersion: string
  senderRole: string
  recipientRole: string
  kind: string
  sourceSequence: number
  causationMessageId: string | null
  inferenceDigest: string
  evidenceVersion: number | null
  draftVersion: number | null
  sentAt?: string | number
  payload: unknown
}

export interface DraftTestRole {
  collaboration?: { workflowVersion: string; inbox: CollabMessage[]; outgoing: CollabMessage[] } | null
  sequence: number
  role: 'VISION' | 'EVIDENCE' | 'EXPLANATION' | 'CRITIC' | string
  state: string
  startedAt: string | null
  completedAt: string | null
  elapsedMs: number | null
  hasResult: boolean
  /** 该角色实际收到的结构化上下文；不含推理快照、对象地址或患者身份。 */
  context: Record<string, unknown> | null
  /** 该角色的结构化输出；停止的角色没有结果。 */
  result: Record<string, unknown> | null
}

export interface ReferenceCheck {
  citationIndex: number
  matched: boolean
  quote: string
}

export interface ClaimCheck {
  id: string
  section: string
  text: string
  references: ReferenceCheck[]
}

export interface DraftAttempt {
  sequence: number
  saved: boolean
  evidenceVersion: number
  allSectionsPresent: boolean
  missingSections: string[]
  claims: ClaimCheck[]
}

export interface CitationSource {
  index: number
  title: string
  source: string
  chunkIndex: number
  excerpt: string
}

export interface EvidenceView {
  version: number
  citations: CitationSource[]
}

export interface DraftTestTrace {
  workflowVersion?: string | null
  taskId: string
  taskStatus: string
  status: string | null
  stopReason: string | null
  calls: number
  supplements: number
  rewrites: number
  startedAt: string | null
  deadlineAt: string | null
  elapsedMs: number | null
  predictedLabel: string | null
  roles: DraftTestRole[]
  evidence: EvidenceView[]
  attempts: DraftAttempt[]
  budget: { maxCalls: number; totalMillis: number; callMillis: number }
}

function unwrap<T>(response: { data: { code: number; data: T; msg?: string } }): T {
  if (response.data.code !== 0) throw new Error(response.data.msg || '试验台操作失败')
  return response.data.data
}

export const listDraftTestTasks = async () => unwrap<DraftTestTask[]>(await request.get('/patient-draft-test/tasks'))

export const draftTestTrace = async (taskId: string) =>
  unwrap<DraftTestTrace>(await request.get(`/patient-draft-test/tasks/${encodeURIComponent(taskId)}`))

export const runDraftTest = async (taskId: string) =>
  unwrap<DraftTestTrace>(await request.post(`/patient-draft-test/tasks/${encodeURIComponent(taskId)}/run`))

/** 需要一个额外的 allow-seed 开关；写入的是标注为合成来源的任务与资料。 */
export const seedDraftTestTask = async (label: string) =>
  unwrap<string>(await request.post('/patient-draft-test/seed', null, { params: { label } }))
