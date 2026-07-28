/**
 * Agent Execution Timeline —— 事件/进度 → Agent 节点 的纯映射函数。
 *
 * 设计约束：
 * - 这只是「Backend Workflow View → Frontend Renderer」的派生，不维护任何业务状态机；
 * - 5 个 Agent 节点（4 个 AI Agent + 可选 Human Review）的「已完成 / 进行中 / 未开始」
 *   完全由后端 progress / events / status 推导；
 * - 后端 segment 名称是自由展示串，这里用关键词映射，未匹配到的 segment 不强行归因，
 *   保证不臆造状态；
 * - Human Review 节点仅在确有复核环节时出现（状态或事件或 segment 指向复核）。
 */
import type {
  WorkflowEventView,
  WorkflowProgressView,
  WorkflowStatus,
} from '@/api/workflow'

export type AgentKey =
  | 'image-quality'
  | 'vision'
  | 'evidence'
  | 'explanation'
  | 'human-review'

export type AgentState = 'completed' | 'current' | 'pending'

export interface AgentNode {
  key: AgentKey
  name: string
  description: string
  state: AgentState
}

export interface AgentTimelineInput {
  status?: string | null
  progress?: WorkflowProgressView | null
  events?: WorkflowEventView[] | null
}

interface AgentSpec {
  key: Exclude<AgentKey, 'human-review'>
  name: string
  description: string
  /** segment 命中关键词（包含匹配，大小写不敏感） */
  keywords: string[]
}

/** 4 个 AI Agent 的固定流水线顺序 */
export const AGENT_PIPELINE: AgentSpec[] = [
  {
    key: 'image-quality',
    name: 'Image Quality Agent',
    description: '图像质量与采集校验',
    keywords: ['image quality', 'quality', 'intake', 'preprocess', 'acquire'],
  },
  {
    key: 'vision',
    name: 'Vision Agent',
    description: '眼部影像视觉分析',
    keywords: ['vision', 'observation', 'perception', 'detect', 'lesion', 'analysis'],
  },
  {
    key: 'evidence',
    name: 'Evidence Agent',
    description: '医学证据检索与比对',
    keywords: ['evidence', 'retrieval', 'knowledge', 'literature', 'reference', 'rag'],
  },
  {
    key: 'explanation',
    name: 'Explanation Agent',
    description: '诊断解释与风险提示',
    keywords: ['explanation', 'explain', 'risk', 'report', 'summary', 'conclusion'],
  },
]

/** Human Review 节点命中关键词（用于 segment 判别） */
export const HUMAN_REVIEW_KEYWORDS = ['review', 'clinical', 'human', 'doctor', 'audit']
/** 后端在医生提交复核决定时推送的事件类型 */
export const HUMAN_REVIEW_DONE_EVENT = 'HUMAN_REVIEW_DECISION_SUBMITTED'
/** 进入终态且必然经过人工复核的状态 */
export const HUMAN_REVIEW_DONE_STATUSES: WorkflowStatus[] = [
  'COMPLETED_LIMITED',
  'REJECTED',
]
/** 正在等待人工复核的状态 */
export const HUMAN_REVIEW_WAITING_STATUS: WorkflowStatus = 'WAITING_HUMAN_REVIEW'

function includesAny(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase()
  return keywords.some((k) => normalized.includes(k))
}

/** 将单个 segment 名称映射到对应的 AI Agent（首命中优先；无匹配返回 null） */
export function matchSegmentToAgent(
  segment: string,
): Exclude<AgentKey, 'human-review'> | null {
  for (const agent of AGENT_PIPELINE) {
    if (includesAny(segment, agent.keywords)) {
      return agent.key
    }
  }
  return null
}

function matchHumanReview(segment: string): boolean {
  return includesAny(segment, HUMAN_REVIEW_KEYWORDS)
}

/**
 * 推导 Agent Execution Timeline 节点列表。
 * - 4 个 AI Agent 恒出现，状态由 completed / current segment 推导；
 * - Human Review 节点仅在确有复核环节时出现：
 *   · 状态为 WAITING_HUMAN_REVIEW → current（进行中）
 *   · 其余适用情形（复核完成事件 / 复核类终态 / 复核 segment 已完成）→ completed
 */
export function deriveAgentNodes(input: AgentTimelineInput): AgentNode[] {
  const status = input.status ?? null
  const progress = input.progress ?? null
  const events = input.events ?? []

  const states: Record<Exclude<AgentKey, 'human-review'>, AgentState> = {
    'image-quality': 'pending',
    vision: 'pending',
    evidence: 'pending',
    explanation: 'pending',
  }

  for (const segment of progress?.completed ?? []) {
    const key = matchSegmentToAgent(segment)
    if (key) states[key] = 'completed'
  }
  const current = progress?.current
  if (current) {
    const key = matchSegmentToAgent(current)
    if (key && states[key] !== 'completed') states[key] = 'current'
  }

  const aiNodes: AgentNode[] = AGENT_PIPELINE.map((agent) => ({
    key: agent.key,
    name: agent.name,
    description: agent.description,
    state: states[agent.key],
  }))

  const reviewStatuses = [
    HUMAN_REVIEW_WAITING_STATUS,
    ...HUMAN_REVIEW_DONE_STATUSES,
  ]
  const hasReviewEvent = events.some((e) => e.type === HUMAN_REVIEW_DONE_EVENT)
  const anyReviewSegment = [...(progress?.completed ?? []), current]
    .filter((s): s is string => !!s)
    .some(matchHumanReview)
  const applicable =
    (status !== null && reviewStatuses.includes(status as WorkflowStatus)) ||
    hasReviewEvent ||
    anyReviewSegment

  if (!applicable) {
    return aiNodes
  }

  let reviewState: AgentState
  if (status === HUMAN_REVIEW_WAITING_STATUS) {
    reviewState = 'current'
  } else {
    reviewState = 'completed'
  }

  return [
    ...aiNodes,
    {
      key: 'human-review',
      name: 'Human Review',
      description: '医生人工复核',
      state: reviewState,
    },
  ]
}
