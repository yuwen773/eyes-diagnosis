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
  it.each([
    ['VALID_PREDICTION', ['CONFIRM_AI_ASSESSMENT', 'CORRECT_AI_ASSESSMENT', 'INCONCLUSIVE']],
    ['SAFETY_ABSTENTION', ['CONFIRM_ABSTENTION', 'PROVIDE_INDEPENDENT_REVIEW', 'INCONCLUSIVE']],
  ] as const)('renders the final %s matrix and submits the frozen explanation version', async (outcome, decisions) => {
    route.query = { task: 'clinical-1' }
    const clinical: api.ReviewDetail = { ...detail, reviewTaskId: 'clinical-1',
      reviewType: 'FINAL_CLINICAL_REVIEW', status: 'CLAIMED', taskVersion: '1',
      inferenceOutcome: outcome, allowedDecisions: [...decisions],
      modelAssessment: outcome === 'VALID_PREDICTION' ? { diseaseCode: 'glaucoma', calibratedProbability: 91 } : null,
      explanation: { snapshotId: outcome === 'VALID_PREDICTION' ? 'snapshot-1' : null,
        revision: outcome === 'VALID_PREDICTION' ? '1' : null, publicationStatus: outcome === 'VALID_PREDICTION' ? 'VALIDATED' : 'NONE',
        content: null } }
    vi.mocked(api.listQualityReviews).mockResolvedValue([clinical])
    vi.mocked(api.getQualityReview).mockResolvedValue(clinical)
    const wrapper = mount(QualityReviewPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('最终临床复核')
    expect(wrapper.find('input[value="APPROVE_CONTINUE"]').exists()).toBe(false)
    expect(wrapper.findAll('input[type="radio"]').map(input => input.attributes('value'))).toEqual([...decisions])
    await wrapper.get('input[value="INCONCLUSIVE"]').setValue()
    vi.mocked(api.getQualityReview).mockResolvedValue({ ...clinical, status: 'SUBMITTED', allowedDecisions: [], decisionCode: 'INCONCLUSIVE' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.submitQualityReview).toHaveBeenCalledWith('clinical-1', {
      expectedTaskVersion: '1', expectedWorkflowVersion: '6', expectedExplanationSnapshotId: clinical.explanation?.snapshotId,
      expectedExplanationRevision: clinical.explanation?.revision, decisionCode: 'INCONCLUSIVE', reasonCode: 'INCONCLUSIVE' })
    expect(wrapper.text()).toContain('不代表患者已授权保存')
    expect(wrapper.find('form').exists()).toBe(false)
    wrapper.unmount()
  })

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

  it('keeps the new task visible when a previous task action fails after navigation', async () => {
    route.query = { task: 'quality-1' }
    let rejectClaim: (reason: unknown) => void = () => {}
    vi.mocked(api.claimQualityReview).mockImplementation(() => new Promise((_, reject) => { rejectClaim = reject }))
    const wrapper = mount(QualityReviewPanel)
    await flushPromises()
    await wrapper.get('button[data-action="claim"]').trigger('click')
    vi.mocked(api.getQualityReview).mockResolvedValue({ ...detail, reviewTaskId: 'quality-2',
      question: '第二份图片', allowedDecisions: [...detail.allowedDecisions] })
    route.query = { task: 'quality-2' }
    await flushPromises()
    expect(wrapper.text()).toContain('第二份图片')
    rejectClaim({ response: { status: 409, data: { msg: '先前任务冲突' } } })
    await flushPromises()
    expect(wrapper.text()).toContain('第二份图片')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
