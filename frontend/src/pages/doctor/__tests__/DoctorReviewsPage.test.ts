// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLoginUserStore } from '@/stores/user'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import request from '@/request'
import DoctorReviewsPage from '../DoctorReviewsPage.vue'

const review = {
  reviewId: 'review-1', taskId: 'task-1', status: 'PENDING', doctorId: '2', assignedBy: '1',
  assignedAt: '2026-11-09T10:00:00Z', taskVersion: '7', draftVersion: 1, evidenceVersion: 1,
  materialDigest: 'a'.repeat(64), note: '',
  materials: { draft: { claims: [{ id: 'risk', section: 'RISK', text: '合成患者解释', references: [{ citationIndex: 0, quote: '定期检查' }] }] },
    evidence: [{ documentId: 'ref-1', title: '合成资料', source: 'synthetic.invalid', excerpt: '定期检查', documentVersion: 'b'.repeat(64), governanceVersion: 1 }],
    agentMessages: [{ sequence: 1, role: 'CRITIC', state: 'COMPLETED', output: { result: { action: 'REWRITE', objections: [{ target: 'claim:risk', reason: '合成异议' }] } } }],
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  useLoginUserStore().setLoginUser({ id: 2, userRole: 'doctor' })
  vi.mocked(request.get).mockImplementation(async path => ({ data: { code: 0, data: path === '/doctor-reviews' ? [review] : review } }))
})

it('shows frozen draft, evidence and objections and submits the displayed versions', async () => {
  const wrapper = mount(DoctorReviewsPage)
  await flushPromises()
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('合成患者解释')
  expect(wrapper.text()).toContain('合成资料')
  expect(wrapper.text()).toContain('合成异议')
  await wrapper.get('[name=note]').setValue('仅为合成流程验证')
  await wrapper.get('[name=confirmed]').setValue(true)
  vi.mocked(request.post).mockResolvedValue({ data: { code: 0, data: { ...review, status: 'APPROVED', note: '仅为合成流程验证', decidedBy: 2 } } })
  await wrapper.get('[data-action=approve]').trigger('click')
  await flushPromises()
  expect(request.post).toHaveBeenLastCalledWith('/doctor-reviews/review-1/decision', {
    expectedTaskVersion: '7', expectedDraftVersion: 1, expectedEvidenceVersion: 1,
    expectedMaterialDigest: 'a'.repeat(64), decision: 'APPROVED', note: '仅为合成流程验证',
  })
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
  expect(wrapper.text()).toContain('已通过')
})

it('keeps decisions disabled until the doctor confirms the materials and gives a reason', async () => {
  const wrapper = mount(DoctorReviewsPage)
  await flushPromises()
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-action=approve]').attributes('disabled')).toBeDefined()
  await wrapper.get('[name=confirmed]').setValue(true)
  expect(wrapper.get('[data-action=reject]').attributes('disabled')).toBeDefined()
  await wrapper.get('[name=note]').setValue('   ')
  expect(wrapper.get('[data-action=approve]').attributes('disabled')).toBeDefined()
  expect(request.post).not.toHaveBeenCalled()
})

it('records a rejection reason and shows an immutable receipt', async () => {
  const wrapper = mount(DoctorReviewsPage)
  await flushPromises()
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  await wrapper.get('[name=note]').setValue('异议尚未解决')
  await wrapper.get('[name=confirmed]').setValue(true)
  vi.mocked(request.post).mockResolvedValue({ data: { code: 0, data: { ...review, status: 'REJECTED', note: '异议尚未解决', decidedBy: 2 } } })
  await wrapper.get('[data-action=reject]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('未通过')
  expect(wrapper.text()).toContain('异议尚未解决')
  expect(wrapper.text()).toContain('已有决定不可覆盖')
  expect(wrapper.find('[name=note]').exists()).toBe(false)
})

it('closes stale materials after a conflict and requires reopening', async () => {
  const wrapper = mount(DoctorReviewsPage)
  await flushPromises()
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  await wrapper.get('[name=note]').setValue('复核意见')
  await wrapper.get('[name=confirmed]').setValue(true)
  vi.mocked(request.post).mockRejectedValue(new Error('409'))
  await wrapper.get('[data-action=approve]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('重新打开任务')
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('合成患者解释')
})

it('blocks ordinary accounts from reading materials', async () => {
  useLoginUserStore().setLoginUser({ id: 42, userRole: 'user' })
  const wrapper = mount(DoctorReviewsPage)
  await flushPromises()
  expect(wrapper.text()).toContain('仅对医生与任务分配管理员开放')
  expect(request.get).not.toHaveBeenCalled()
})

it('lets administrators assign a concrete task without fetching its draft', async () => {
  useLoginUserStore().setLoginUser({ id: 1, userRole: 'admin' })
  vi.mocked(request.post).mockResolvedValue({ data: { code: 0, data: review } })
  const wrapper = mount(DoctorReviewsPage)
  await wrapper.get('[name=taskId]').setValue('task-1')
  await wrapper.get('[name=doctorId]').setValue('2')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(request.post).toHaveBeenCalledWith('/doctor-reviews/assign', { taskId: 'task-1', doctorId: '2' })
  expect(wrapper.text()).toContain('任务已分配给指定医生')
  expect(request.get).not.toHaveBeenCalled()
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
})

it('discards a late detail response after switching accounts', async () => {
  const wrapper = mount(DoctorReviewsPage)
  await flushPromises()
  let deliver: (value: unknown) => void = () => {}
  vi.mocked(request.get).mockImplementationOnce(() => new Promise(resolve => { deliver = resolve }))
  await wrapper.get('[data-action=open]').trigger('click')
  useLoginUserStore().setLoginUser({ id: 42, userRole: 'user' })
  await flushPromises()
  deliver({ data: { code: 0, data: review } })
  await flushPromises()
  expect(wrapper.text()).not.toContain('合成患者解释')
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
})
