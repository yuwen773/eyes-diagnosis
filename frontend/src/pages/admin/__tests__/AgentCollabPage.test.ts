// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLoginUserStore } from '@/stores/user'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import request from '@/request'
import AgentCollabPage from '../AgentCollabPage.vue'
import type { DraftTestTrace } from '@/api/patientDraftTest'
import { buildStages, stageUtterance, buildAutonomyEvents, buildDiscussion } from '../agentCollab'

/** RouterLink 在单测里没有 router 实例，用轻量替身渲染成锚点。 */
const stubs = { RouterLink: { template: '<a><slot /></a>' } }

const task = { taskId: 'task-1', status: 'WAITING_REVIEW', runStatus: 'REVIEW_READY', stopReason: null, calls: 4, createdAt: '2026-11-10T10:00:00Z' }
const vision = {
  sequence: 1, role: 'VISION', state: 'COMPLETED', startedAt: null, completedAt: null, elapsedMs: 3000,
  hasResult: true, context: { predictedLabel: 'other' }, result: { summary: '模型预测需复核' },
}
const trace = {
  taskId: 'task-1', taskStatus: 'WAITING_REVIEW', status: 'REVIEW_READY', stopReason: null,
  calls: 4, supplements: 0, rewrites: 0, startedAt: null, deadlineAt: null, elapsedMs: 12000,
  predictedLabel: 'other',
  roles: [
    vision,
    { ...vision, sequence: 2, role: 'EVIDENCE', elapsedMs: 1500, result: { search: { query: 'other fundus' }, citations: [{}] } },
    { ...vision, sequence: 3, role: 'EXPLANATION', elapsedMs: 6000, result: { claims: [{}, {}], evidenceVersion: 1 } },
    { ...vision, sequence: 4, role: 'CRITIC', elapsedMs: 1000, result: { action: 'NONE', objections: [] } },
  ],
  evidence: [], attempts: [],
  budget: { maxCalls: 8, totalMillis: 90000, callMillis: 20000 },
}

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  useLoginUserStore().setLoginUser({ id: 1, userRole: 'admin' })
  vi.mocked(request.get).mockImplementation(async path => ({
    data: { code: 0, data: path === '/patient-draft-test/tasks' ? [task] : trace },
  }))
})

it('derives handoffs and utterances from a real trace', () => {
  const stages = buildStages(trace as unknown as DraftTestTrace)
  expect(stages.map(s => s.role)).toEqual(['VISION', 'EVIDENCE', 'EXPLANATION', 'CRITIC'])
  expect(stages.every(s => s.state === 'DONE')).toBe(true)
  expect(stages[1].received).toBe('图像摘要与限制')
  expect(stages[3].received).toBe('分层草稿')
  expect(stages[2].handoff?.detail).toContain('2 条声明')
  expect(stageUtterance(stages[3])).toContain('没有可定位的异议')
})

it('marks missing roles as pending instead of inventing output', () => {
  const stages = buildStages({ ...trace, roles: [vision] } as unknown as DraftTestTrace)
  expect(stages[0].state).toBe('DONE')
  expect(stages.slice(1).every(s => s.state === 'PENDING')).toBe(true)
  expect(stages[3].result).toBeNull()
})

it('shows the two engineering views and links to the standalone docket page', async () => {
  const wrapper = mount(AgentCollabPage, { global: { stubs } })
  await flushPromises()
  expect(wrapper.text()).toContain('四 Agent 协作效果')
  expect(wrapper.text()).toContain('① 运行时协作')
  expect(wrapper.text()).toContain('② 自治多 Agent')
  expect(wrapper.text()).toContain('③ 多角色讨论')
  expect(wrapper.find('.docket-link').exists()).toBe(true)
  expect(wrapper.findAll('[role=tab]')).toHaveLength(2)
  expect(request.get).toHaveBeenCalledWith('/patient-draft-test/tasks')
  await wrapper.findAll('[role=tab]')[1].trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请选择任务')
  expect(wrapper.text()).toContain('并行')
  expect(wrapper.find('select').exists()).toBe(true)
  await wrapper.find('select').setValue('task-1')
  await flushPromises()
  expect(wrapper.text()).toContain('历史顺序流程')
  wrapper.unmount()
})

it('preserves every real invocation including critic feedback and explanation revision', () => {
  const feedback = { ...trace.roles[3], result: { action: 'REWRITE', objections: [{ target: 'claim:RISK', reason: '缺少限制' }] } }
  const revised = { ...trace.roles[2], sequence: 5 }
  const stages = buildStages({ ...trace, roles: [...trace.roles.slice(0, 3), feedback, revised] } as unknown as DraftTestTrace)
  expect(stages.filter(s => s.role === 'EXPLANATION')).toHaveLength(2)
  expect(stageUtterance(stages[3])).toContain('重写')
})

it('keeps the entry closed for non-admins', async () => {
  useLoginUserStore().setLoginUser({ id: 2, userRole: 'doctor' })
  const wrapper = mount(AgentCollabPage, { global: { stubs } })
  await flushPromises()
  expect(wrapper.text()).toContain('仅对管理员开放')
  expect(request.get).not.toHaveBeenCalled()
  wrapper.unmount()
})


it.each(['2026-11-10T10:00:03Z', 1794304803])('uses persisted send time %s distinct from model completion', sentAt => {
  const actual = {
    ...trace, workflowVersion: 'AUTONOMOUS_V2', startedAt: '2026-11-10T10:00:00Z',
    roles: [{ ...vision, startedAt: '2026-11-10T10:00:00Z', completedAt: '2026-11-10T10:00:01Z',
      collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [], outgoing: [{
        messageId: 'm1', taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2', senderRole: 'VISION',
        recipientRole: 'EXPLANATION', kind: 'VISION_READY', sourceSequence: 1,
        causationMessageId: null, inferenceDigest: 'digest', evidenceVersion: null, draftVersion: null,
        payload: {}, sentAt,
      }] },
    }],
  }
  const events = buildAutonomyEvents(actual)
  expect(events.find(event => event.id === '1-end')?.at).toBe(1000)
  expect(events.find(event => event.id === 'm1')?.at).toBe(3000)
  expect(events.find(event => event.id === 'm1')?.route).toBe('VISION → EXPLANATION')
})

it('clears materials when switching between two administrators and discards a late response', async () => {
  const wrapper = mount(AgentCollabPage, { global: { stubs } })
  await flushPromises()
  let finish: (value: { data: { code: number; data: typeof trace } }) => void = () => {}
  vi.mocked(request.get).mockImplementation(path => path === '/patient-draft-test/tasks'
    ? Promise.resolve({ data: { code: 0, data: [task] } })
    : new Promise(resolve => { finish = resolve }))
  await wrapper.find('select').setValue('task-1')
  useLoginUserStore().setLoginUser({ id: 99, userRole: 'admin' })
  await flushPromises()
  finish({ data: { code: 0, data: trace } })
  await flushPromises()
  expect(wrapper.find('select').element.value).toBe('')
  expect(wrapper.text()).not.toContain('模型预测需复核')
  wrapper.unmount()
})

it('renders a discussion thread that quotes the original claim and the objection', () => {
  const claimText = '风险提示须由眼科医生复核'
  const reason = '未写明不确定性，请重写'
  const draftRow = {
    ...trace.roles[2],
    result: { claims: [{ id: 'c2', section: 'RISK', text: claimText, references: [] }], evidenceVersion: 1 },
    collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [], outgoing: [{
      messageId: 'm-draft', taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2', senderRole: 'EXPLANATION',
      recipientRole: 'CRITIC', kind: 'DRAFT_READY', sourceSequence: 3, causationMessageId: null,
      inferenceDigest: 'd', evidenceVersion: 1, draftVersion: 1, payload: {}, sentAt: '2026-11-10T10:00:06Z',
    }] },
  }
  const criticRow = {
    ...trace.roles[3],
    result: { action: 'REWRITE', objections: [{ target: 'claim:c2', reason }] },
    collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [], outgoing: [{
      messageId: 'm-rewrite', taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2', senderRole: 'CRITIC',
      recipientRole: 'EXPLANATION', kind: 'REWRITE_REQUESTED', sourceSequence: 4, causationMessageId: 'm-draft',
      inferenceDigest: 'd', evidenceVersion: 1, draftVersion: 1,
      payload: { action: 'REWRITE', objections: [{ target: 'claim:c2', reason }] }, sentAt: '2026-11-10T10:00:07Z',
    }] },
  }
  const revisedRow = {
    ...draftRow, sequence: 5,
    collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [criticRow.collaboration.outgoing[0]],
      outgoing: [{ ...draftRow.collaboration.outgoing[0], messageId: 'm-draft2', recipientRole: 'CRITIC', sourceSequence: 5,
        causationMessageId: 'm-rewrite', draftVersion: 2, sentAt: '2026-11-10T10:00:09Z' }] },
  }
  const replay = { ...trace, roles: [trace.roles[0], trace.roles[1], draftRow, criticRow, revisedRow] }
  const turns = buildDiscussion(replay as unknown as DraftTestTrace)
  const critic = turns.find(turn => turn.sequence === 4)!
  expect(critic.isFeedback).toBe(true)
  expect(critic.objections[0].claimText).toBe(claimText)
  expect(critic.quotes.map(quote => quote.text)).toContain(claimText)
  expect(critic.quotes.map(quote => quote.text)).toContain(reason)
  expect(critic.addressedTo).toContain('EXPLANATION')
  expect(critic.replyTo.map(reply => reply.messageId)).toContain('m-draft')
  // 修订轮缩进成一段来回，并引用被打回的理由。
  const revised = turns.find(turn => turn.sequence === 5)!
  expect(revised.depth).toBe(1)
  expect(revised.isReply).toBe(true)
  expect(revised.quotes.map(quote => quote.text)).toContain(reason)
  expect(revised.replyTo.map(reply => reply.messageId)).toContain('m-rewrite')
})

it('quotes the reviewed draft claim, not the later revised claim', () => {
  const original = '风险提示须由眼科医生复核'
  const revised = '风险提示须由眼科医生复核，且注明不确定性'
  const makeDraft = (sequence: number, text: string, draftVersion: number, messageId: string) => ({
    ...trace.roles[2], sequence,
    result: { claims: [{ id: 'c2', section: 'RISK', text, references: [] }], evidenceVersion: 1 },
    collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [], outgoing: [{
      messageId, taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2', senderRole: 'EXPLANATION',
      recipientRole: 'CRITIC', kind: 'DRAFT_READY', sourceSequence: sequence, causationMessageId: null,
      inferenceDigest: 'd', evidenceVersion: 1, draftVersion,
      payload: { claims: [{ id: 'c2', section: 'RISK', text, references: [] }] }, sentAt: '2026-11-10T10:00:06Z',
    }] },
  })
  const firstDraft = makeDraft(3, original, 1, 'm-draft-1')
  const critic = {
    ...trace.roles[3],
    result: { action: 'REWRITE', objections: [{ target: 'claim:c2', reason: '缺少不确定性' }] },
    collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [firstDraft.collaboration.outgoing[0]],
      outgoing: [{ messageId: 'm-rewrite-1', taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2',
        senderRole: 'CRITIC', recipientRole: 'EXPLANATION', kind: 'REWRITE_REQUESTED', sourceSequence: 4,
        causationMessageId: 'm-draft-1', inferenceDigest: 'd', evidenceVersion: 1, draftVersion: 1,
        payload: { action: 'REWRITE', objections: [{ target: 'claim:c2', reason: '缺少不确定性' }] },
        sentAt: '2026-11-10T10:00:07Z' }] },
  }
  const secondDraft = makeDraft(5, revised, 2, 'm-draft-2')
  const replay = { ...trace, workflowVersion: 'AUTONOMOUS_V2',
    roles: [trace.roles[0], trace.roles[1], firstDraft, critic, secondDraft] }
  const turns = buildDiscussion(replay as unknown as DraftTestTrace)
  const objection = turns.find(turn => turn.sequence === 4)!.objections[0]
  // 异议发生在修订之前，引用必须来自当时被复核的第 1 版，不能被第 2 版覆盖。
  expect(objection.claimText).toBe(original)
  expect(objection.claimText).not.toBe(revised)
})

it('states plainly that there was no discussion when Critic raised no objection', () => {
  const turns = buildDiscussion(trace as unknown as DraftTestTrace)
  expect(turns).toHaveLength(4)
  expect(turns.every(turn => !turn.isFeedback)).toBe(true)
  expect(turns.every(turn => turn.quotes.length === 0)).toBe(true)
  expect(turns[3].isConsensus).toBe(false) // 无 collaboration 的历史顺序夹具
})
