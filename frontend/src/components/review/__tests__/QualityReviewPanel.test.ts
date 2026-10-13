import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import QualityReviewPanel from '@/components/review/QualityReviewPanel.vue'
import * as api from '@/api/reviewController'

const route = reactive({ query: {} as Record<string, string> })
vi.mock('vue-router', () => ({ useRoute: () => route,
  useRouter: () => ({ replace: async ({ query }: { query: Record<string, string> }) => { route.query = query } }) }))
vi.mock('@/api/reviewController', () => ({ listQualityReviews: vi.fn(), getQualityReview: vi.fn(),
  claimQualityReview: vi.fn(), submitQualityReview: vi.fn(), qualityReviewImageUrl: () => '/test-image.png' }))

const task = { reviewTaskId: 'quality-1', workflowId: 'workflow-1', reviewType: 'IMAGE_QUALITY_GATE' as const,
  status: 'OPEN' as const, taskVersion: '0', workflowVersion: '6', assignedDoctorId: null,
  decisionCode: null, reasonCode: null }
const detail = { ...task, question: '本次图片', allowedDecisions: ['APPROVE_CONTINUE', 'REJECT_RESUBMIT'] as const,
  inferenceEnvelopeId: 'envelope-1', inferenceEpoch: '0', inputDigest: 'abc', qualityOutcome: 'REVIEW',
  qualityScore: 40, qualityReasons: ['blur'], modelVersion: 'model-v1', modelWeightFingerprint: 'a'.repeat(64),
  preprocessVersion: 'v1', inferencePolicyVersion: 'policy-v1', graphDefinitionVersion: 'v3' }

beforeEach(() => {
  vi.resetAllMocks()
  route.query = {}
  vi.mocked(api.listQualityReviews).mockResolvedValue([task])
  vi.mocked(api.getQualityReview).mockResolvedValue({ ...detail, allowedDecisions: [...detail.allowedDecisions] })
})

describe('doctor quality review page', () => {
  it('claims a task then submits only a quality decision with current versions', async () => {
    const wrapper = mount(QualityReviewPanel)
    await flushPromises()
    await wrapper.get('button[data-task-id="quality-1"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('本次图片')
    expect(wrapper.find('button[data-action="submit"]').exists()).toBe(false)
    vi.mocked(api.claimQualityReview).mockResolvedValue({ ...task, status: 'CLAIMED', taskVersion: '1',
      workflowVersion: '7', assignedDoctorId: '9' })
    vi.mocked(api.getQualityReview).mockResolvedValue({ ...detail, status: 'CLAIMED', taskVersion: '1',
      workflowVersion: '7', assignedDoctorId: '9', allowedDecisions: [...detail.allowedDecisions] })
    await wrapper.get('button[data-action="claim"]').trigger('click')
    await flushPromises()
    expect(api.claimQualityReview).toHaveBeenCalledWith('quality-1', {
      expectedTaskVersion: '0', expectedWorkflowVersion: '6' })
    vi.mocked(api.submitQualityReview).mockResolvedValue({ ...task, status: 'SUBMITTED', taskVersion: '2',
      assignedDoctorId: '9', decisionCode: 'APPROVE_CONTINUE', reasonCode: 'QUALITY_APPROVED' })
    vi.mocked(api.getQualityReview).mockResolvedValue({ ...detail, status: 'SUBMITTED', taskVersion: '2',
      assignedDoctorId: '9', decisionCode: 'APPROVE_CONTINUE', reasonCode: 'QUALITY_APPROVED', allowedDecisions: [] })
    await wrapper.get('input[value="APPROVE_CONTINUE"]').setValue()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.submitQualityReview).toHaveBeenCalledWith('quality-1', {
      expectedTaskVersion: '1', expectedWorkflowVersion: '7',
      decisionCode: 'APPROVE_CONTINUE', reasonCode: 'QUALITY_APPROVED' })
    expect(wrapper.text()).toContain('不是用户保存授权')
    expect(wrapper.find('form').exists()).toBe(false)
    wrapper.unmount()
  })

  it('restores selected task on reload and requires refresh after a version conflict', async () => {
    route.query = { task: 'quality-1' }
    vi.mocked(api.claimQualityReview).mockRejectedValue({ response: { status: 409,
      data: { msg: '版本已变化，请刷新后重试' } } })
    const wrapper = mount(QualityReviewPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('本次图片')
    await wrapper.get('button[data-action="claim"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('版本已变化')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('button[data-action="claim"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
