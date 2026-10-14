import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowView } from '@/api/workflowController'
import WorkflowStatus from '../WorkflowStatus.vue'

vi.mock('@/api/diagnosisSaveController', () => ({ getSaveConfirmation: vi.fn().mockResolvedValue(null) }))

const published: WorkflowView = {
  workflowId: 'published-task', status: 'COMPLETED', workflowVersion: '22',
  graphDefinitionVersion: 'upload-validated-explanation-v5', segment: 'explanationPublication',
  progress: { current: 'explanationPublication', completed: [] }, stopReasonCode: null,
  qualityGate: 'PASS', qualityReview: null,
  explanation: { publicationStatus: 'PUBLISHED', snapshotId: 'snapshot-1', revision: '1', validationStatus: 'VALIDATED' },
  resultAvailability: { patientVisible: true, doctorReviewRequired: false },
  result: { snapshotId: 'snapshot-1', revision: '1',
    modelAssessment: { diseaseCode: 'glaucoma', calibratedProbability: 91, modelVersion: 'controlled-model',
      modelWeightFingerprint: 'a'.repeat(64), inferencePolicyVersion: 'policy-v1', calibrationStatus: 'CALIBRATED' },
    generalInformation: [{ claimId: 'c1', type: 'GENERAL_DISEASE_INFORMATION', text: '青光眼的一般参考信息。', citationIds: ['doc_1_chunk_0'] }],
    citations: [{ citationId: 'doc_1_chunk_0', documentId: '1', sourceRevision: 1, title: '<script>参考资料</script>',
      source: 'object://guide.txt', quotedText: '青光眼的一般参考信息。', quotedTextDigest: 'a'.repeat(64) }],
    riskNotice: '一般参考资料不证明本人的疾病或概率。', limitation: '不能替代专业医生诊断。' },
}

describe('patient explanation publication boundary', () => {
  it('separates model assessment, general sources and risk notice', () => {
    const wrapper = mount(WorkflowStatus, { props: { workflow: published } })
    expect(wrapper.text()).toContain('模型评估')
    expect(wrapper.text()).toContain('91%')
    expect(wrapper.text()).toContain('一般参考信息')
    expect(wrapper.text()).toContain('doc_1_chunk_0')
    expect(wrapper.text()).toContain('风险提示')
    expect(wrapper.text()).toContain('正式诊断记录尚未保存')
    expect(wrapper.find('script').exists()).toBe(false)
  })

  it.each(['DRAFT', 'VALIDATED', 'REJECTED', 'WITHHELD'] as const)('hides %s even with unexpected result content', (status) => {
    const wrapper = mount(WorkflowStatus, { props: { workflow: { ...published,
      status: status === 'VALIDATED' ? 'WAITING_HUMAN_REVIEW' : 'COMPLETED_LIMITED',
      explanation: { ...published.explanation!, publicationStatus: status },
    } } })
    expect(wrapper.text()).not.toContain('91%')
    expect(wrapper.text()).not.toContain('青光眼的一般参考信息')
  })
})
