import { describe, expect, it } from 'vitest'
import {
  deriveAgentNodes,
  matchSegmentToAgent,
  type AgentTimelineInput,
} from '@/components/workflow/agentTimeline'
import type { WorkflowEventView, WorkflowProgressView } from '@/api/workflow'

const fourAgents = (): WorkflowProgressView => ({
  current: null,
  completed: [
    'Image Quality & Intake',
    'Vision Analysis',
    'Evidence Retrieval',
    'Risk & Explanation',
  ],
})

describe('matchSegmentToAgent（segment → Agent 关键词映射）', () => {
  it('Image Quality & Intake → image-quality', () => {
    expect(matchSegmentToAgent('Image Quality & Intake')).toBe('image-quality')
  })
  it('Vision Analysis → vision', () => {
    expect(matchSegmentToAgent('Vision Analysis')).toBe('vision')
  })
  it('Evidence Retrieval → evidence', () => {
    expect(matchSegmentToAgent('Evidence Retrieval')).toBe('evidence')
  })
  it('Risk & Explanation → explanation', () => {
    expect(matchSegmentToAgent('Risk & Explanation')).toBe('explanation')
  })
  it('未匹配任何关键词的 segment 返回 null（不臆造状态）', () => {
    expect(matchSegmentToAgent('TOTALLY_UNKNOWN_STAGE')).toBeNull()
  })
})

describe('deriveAgentNodes（状态推导）', () => {
  it('4 个 AI Agent 全部完成、无人工复核 → 仅 4 个节点', () => {
    const nodes = deriveAgentNodes({
      status: 'COMPLETED',
      progress: fourAgents(),
      events: [],
    })
    expect(nodes).toHaveLength(4)
    expect(nodes.every((n) => n.state === 'completed')).toBe(true)
    expect(nodes.some((n) => n.key === 'human-review')).toBe(false)
  })

  it('RUNNING 且当前在 Evidence：image-quality 完成、evidence 进行中、其余未开始', () => {
    const nodes = deriveAgentNodes({
      status: 'RUNNING',
      progress: {
        current: 'Evidence Retrieval',
        completed: ['Image Quality & Intake'],
      },
      events: [],
    })
    const byKey = Object.fromEntries(nodes.map((n) => [n.key, n.state]))
    expect(byKey['image-quality']).toBe('completed')
    expect(byKey['vision']).toBe('pending')
    expect(byKey['evidence']).toBe('current')
    expect(byKey['explanation']).toBe('pending')
    expect(nodes.some((n) => n.key === 'human-review')).toBe(false)
  })

  it('WAITING_HUMAN_REVIEW：4 个 AI 完成 + Human Review 节点（进行中，医生图标节点）', () => {
    const nodes = deriveAgentNodes({
      status: 'WAITING_HUMAN_REVIEW',
      progress: { current: 'Clinical Review', completed: fourAgents().completed },
      events: [],
    })
    expect(nodes).toHaveLength(5)
    const review = nodes.find((n) => n.key === 'human-review')
    expect(review?.state).toBe('current')
    expect(nodes.filter((n) => n.key !== 'human-review').every((n) => n.state === 'completed')).toBe(true)
  })

  it('COMPLETED_LIMITED + 复核完成事件：Human Review 节点为已完成', () => {
    const events: WorkflowEventView[] = [
      { type: 'HUMAN_REVIEW_DECISION_SUBMITTED', time: '2026-07-28T10:05:00', segment: null },
    ]
    const nodes = deriveAgentNodes({
      status: 'COMPLETED_LIMITED',
      progress: { current: null, completed: fourAgents().completed },
      events,
    })
    const review = nodes.find((n) => n.key === 'human-review')
    expect(review?.state).toBe('completed')
  })

  it('CREATED 且无进度：4 个节点全部未开始、无 Human Review', () => {
    const nodes = deriveAgentNodes({
      status: 'CREATED',
      progress: { current: null, completed: [] },
      events: [],
    })
    expect(nodes).toHaveLength(4)
    expect(nodes.every((n) => n.state === 'pending')).toBe(true)
  })

  it('无输入时安全返回 4 个未开始节点（不抛错）', () => {
    const input: AgentTimelineInput = {}
    const nodes = deriveAgentNodes(input)
    expect(nodes).toHaveLength(4)
    expect(nodes.every((n) => n.state === 'pending')).toBe(true)
  })
})
