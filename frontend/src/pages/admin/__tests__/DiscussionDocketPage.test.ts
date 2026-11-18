// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLoginUserStore } from '@/stores/user'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import request from '@/request'
import DiscussionDocketPage from '../DiscussionDocketPage.vue'

const task = {
  taskId: 'task-1', status: 'WAITING_REVIEW', runStatus: 'REVIEW_READY',
  stopReason: null, calls: 4, createdAt: '2026-11-10T10:00:00Z',
}
const row = {
  startedAt: '2026-11-10T10:00:00Z', completedAt: '2026-11-10T10:00:03Z',
  elapsedMs: 3000, hasResult: true, state: 'COMPLETED',
}
const claimText = '风险提示须由眼科医生复核'
const reason = '未写明不确定性，请重写'
const trace = {
  taskId: 'task-1', taskStatus: 'WAITING_REVIEW', status: 'REVIEW_READY', stopReason: null,
  calls: 4, supplements: 0, rewrites: 0, workflowVersion: 'AUTONOMOUS_V2',
  startedAt: null, deadlineAt: null, elapsedMs: 12000, predictedLabel: 'glaucoma',
  roles: [
    { ...row, sequence: 1, role: 'VISION', context: { predictedLabel: 'glaucoma' }, result: { summary: '模型预测需复核' } },
    { ...row, sequence: 2, role: 'EVIDENCE', result: { search: { query: 'glaucoma' }, citations: [{}] } },
    { ...row, sequence: 3, role: 'EXPLANATION', result: { claims: [{ id: 'c2', section: 'RISK', text: claimText }] },
      collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [], outgoing: [{
        messageId: 'm-draft', taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2', senderRole: 'EXPLANATION',
        recipientRole: 'CRITIC', kind: 'DRAFT_READY', sourceSequence: 3, causationMessageId: null,
        inferenceDigest: 'd', evidenceVersion: 1, draftVersion: 1,
        payload: { claims: [{ id: 'c2', section: 'RISK', text: claimText }] }, sentAt: '2026-11-10T10:00:06Z',
      }] } },
    { ...row, sequence: 4, role: 'CRITIC', result: { action: 'REWRITE', objections: [{ target: 'claim:c2', reason }] },
      collaboration: { workflowVersion: 'AUTONOMOUS_V2', inbox: [], outgoing: [{
        messageId: 'm-rewrite', taskId: 'task-1', workflowVersion: 'AUTONOMOUS_V2', senderRole: 'CRITIC',
        recipientRole: 'EXPLANATION', kind: 'REWRITE_REQUESTED', sourceSequence: 4, causationMessageId: 'm-draft',
        inferenceDigest: 'd', evidenceVersion: 1, draftVersion: 1,
        payload: { action: 'REWRITE', objections: [{ target: 'claim:c2', reason }] }, sentAt: '2026-11-10T10:00:07Z',
      }] } },
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

it('renders a docket, not chat bubbles, and quotes the real objection in a margin note', async () => {
  const wrapper = mount(DiscussionDocketPage)
  await flushPromises()
  expect(wrapper.text()).toContain('四角色会诊议事录')
  expect(wrapper.find('.bubble').exists()).toBe(false)
  expect(wrapper.find('.avatar').exists()).toBe(false)
  await wrapper.find('select').setValue('task-1')
  await flushPromises()
  expect(wrapper.find('.readout').text()).toContain('发言记录')
  expect(wrapper.findAll('.entry')).toHaveLength(4)
  expect(wrapper.find('.readout').text()).toContain('AUTONOMOUS_V2')
  // 异议条目引用被复核的声明原文与理由，且显示语义文字标签。
  const objection = wrapper.findAll('.entry')[3]
  expect(objection.find('.kind').text()).toBe('异议 / 打回')
  expect(objection.find('.objections').text()).toContain('claim:c2')
  expect(objection.find('.margin-notes').text()).toContain(claimText)
  expect(objection.find('.margin-notes').text()).toContain(reason)
  wrapper.unmount()
})

it('opens the causation chain from real message ids', async () => {
  const wrapper = mount(DiscussionDocketPage)
  await flushPromises()
  await wrapper.find('select').setValue('task-1')
  await flushPromises()
  const objection = wrapper.findAll('.entry')[3]
  expect(objection.find('.chain').exists()).toBe(false)
  await objection.find('.disclosure').trigger('click')
  expect(objection.find('.chain').text()).toContain('m-draft')
  wrapper.unmount()
})

it('keeps the docket closed for non-admins', async () => {
  useLoginUserStore().setLoginUser({ id: 2, userRole: 'doctor' })
  const wrapper = mount(DiscussionDocketPage)
  await flushPromises()
  expect(wrapper.text()).toContain('仅对管理员开放')
  expect(request.get).not.toHaveBeenCalled()
  wrapper.unmount()
})
