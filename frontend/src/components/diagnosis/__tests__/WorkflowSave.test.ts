import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowView } from '@/api/workflowController'
import type { SaveConfirmation } from '@/api/diagnosisSaveController'
import { getSaveConfirmation, requestDiagnosisSave, decideDiagnosisSave } from '@/api/diagnosisSaveController'
import WorkflowSave from '../WorkflowSave.vue'

vi.mock('@/api/diagnosisSaveController', () => ({
  getSaveConfirmation: vi.fn(), requestDiagnosisSave: vi.fn(), decideDiagnosisSave: vi.fn(),
}))
const row: SaveConfirmation = {
  confirmationId: 'c1', workflowId: 'w1', operationType: 'SAVE_DIAGNOSIS', status: 'PENDING',
  workflowVersion: '22', contentDigest: 'a'.repeat(64), idempotencyKey: 'key1',
  expiresAt: '2026-10-13T12:00:00+08:00', diagnosisId: null,
  content: { imageUrl: '/api/diagnosis/workflows/w1/image', imageDigest: 'b'.repeat(64), result: 'glaucoma',
    calibratedProbability: 91, severity: 'NOT_ASSESSED', details: '不是确诊', finalReviewTaskId: null,
    explanation: { snapshotId: 's1', revision: '1',
      modelAssessment: { diseaseCode: 'glaucoma', calibratedProbability: 91, modelVersion: 'v1',
        modelWeightFingerprint: 'a'.repeat(64), inferencePolicyVersion: 'v1', calibrationStatus: 'CALIBRATED' },
      generalInformation: [{ claimId: 'g1', type: 'GENERAL_DISEASE_INFORMATION', text: '一般参考内容', citationIds: ['r1'] }],
      citations: [{ citationId: 'r1', documentId: '1', sourceRevision: 1, title: '参考资料', source: 'guide',
        quotedText: '一般参考内容', quotedTextDigest: 'a'.repeat(64) }], riskNotice: '不是确诊', limitation: '仅作辅助' } },
}
const workflow: WorkflowView = { workflowId: 'w1', status: 'COMPLETED', workflowVersion: '22',
  graphDefinitionVersion: 'v1', segment: null, progress: { current: null, completed: [] },
  stopReasonCode: null, qualityGate: 'PASS', qualityReview: null,
  explanation: { publicationStatus: 'PUBLISHED', snapshotId: 's1', revision: '1', validationStatus: 'VALIDATED' },
  resultAvailability: { patientVisible: true, doctorReviewRequired: false }, result: row.content.explanation }

const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll('button').find(b => b.text() === label)!
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getSaveConfirmation).mockResolvedValue(null)
  vi.mocked(requestDiagnosisSave).mockResolvedValue(row)
})

describe('explicit diagnosis save consent', () => {
  it('shows frozen preview and does not approve until a separate click', async () => {
    const wrapper = mount(WorkflowSave, { props: { workflow } })
    await flushPromises()
    await button(wrapper, '查看拟保存内容').trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="拟保存内容"]').text()).toContain('一般参考内容')
    expect(wrapper.get('img').attributes('alt')).toBe('拟保存的本次眼底图片')
    expect(decideDiagnosisSave).not.toHaveBeenCalled()
    vi.mocked(decideDiagnosisSave).mockResolvedValue({ ...row, status: 'APPROVED', diagnosisId: '123' })
    await button(wrapper, '批准并保存正式诊断').trigger('click')
    await flushPromises()
    expect(decideDiagnosisSave).toHaveBeenCalledWith(row, 'approve')
    expect(wrapper.text()).toContain('正式诊断记录已保存')
    expect(wrapper.text()).toContain('123')
    expect(wrapper.find('[aria-label="拟保存内容"]').exists()).toBe(false)
  })

  it('restores pending consent after refresh and supports rejection', async () => {
    vi.mocked(getSaveConfirmation).mockResolvedValue(row)
    vi.mocked(decideDiagnosisSave).mockResolvedValue({ ...row, status: 'REJECTED' })
    const wrapper = mount(WorkflowSave, { props: { workflow } })
    await flushPromises()
    expect(wrapper.text()).toContain('等待您确认保存')
    await button(wrapper, '拒绝保存').trigger('click')
    await flushPromises()
    expect(decideDiagnosisSave).toHaveBeenCalledWith(row, 'reject')
    expect(wrapper.text()).toContain('您已拒绝保存，未建立正式记录')
  })

  it('keeps an uncertain approval retry bound to the same frozen content', async () => {
    vi.mocked(getSaveConfirmation).mockResolvedValue(row)
    vi.mocked(decideDiagnosisSave).mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ ...row, status: 'APPROVED', diagnosisId: '456' })
    const wrapper = mount(WorkflowSave, { props: { workflow } })
    await flushPromises()
    await button(wrapper, '批准并保存正式诊断').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('操作结果暂未确认')
    expect(wrapper.text()).not.toContain('正式诊断记录已保存')
    await button(wrapper, '批准并保存正式诊断').trigger('click')
    await flushPromises()
    expect(vi.mocked(decideDiagnosisSave).mock.calls).toEqual([[row, 'approve'], [row, 'approve']])
  })

  it.each(['WAITING_HUMAN_REVIEW', 'COMPLETED_LIMITED'] as const)('cannot approve a %s task', async status => {
    vi.mocked(getSaveConfirmation).mockResolvedValue(row)
    const wrapper = mount(WorkflowSave, { props: { workflow: { ...workflow, status, result: null } } })
    await flushPromises()
    expect(wrapper.find('[aria-label="拟保存内容"]').exists()).toBe(false)
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['刷新保存状态'])
    expect(decideDiagnosisSave).not.toHaveBeenCalled()
  })

  it('restores an approved receipt without asking again', async () => {
    vi.mocked(getSaveConfirmation).mockResolvedValue({ ...row, status: 'APPROVED', diagnosisId: '789' })
    const wrapper = mount(WorkflowSave, { props: { workflow } })
    await flushPromises()
    expect(wrapper.text()).toContain('记录编号：789')
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['刷新保存状态'])
  })
})
