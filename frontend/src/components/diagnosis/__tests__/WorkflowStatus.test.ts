import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { WorkflowView } from '@/api/workflowController'
import WorkflowStatus from '@/components/diagnosis/WorkflowStatus.vue'

const base: WorkflowView = {
  workflowId: 'quality-task', status: 'RUNNING', workflowVersion: '4',
  graphDefinitionVersion: 'upload-inference-v2', segment: 'imageQuality',
  progress: { current: 'imageQuality', completed: ['validateImage', 'inference', 'imageQuality'] },
  stopReasonCode: null, qualityGate: null, qualityReview: null,
  resultAvailability: { patientVisible: false, doctorReviewRequired: false }, result: null,
}

describe('workflow quality and technical states', () => {
  it.each([
    ['REJECTED', 'QUALITY_REJECTED', 'REJECT', '图片质量未通过', '请重新上传'],
    ['WAITING_HUMAN_REVIEW', 'QUALITY_REVIEW_REQUIRED', 'REVIEW', '图片质量待复核', '不会自动重新分析'],
    ['FAILED', 'MODEL_UNAVAILABLE', null, '模型当前不可用', '未生成诊断结果'],
    ['FAILED', 'MODEL_FINGERPRINT_MISMATCH', null, '模型来源校验失败', '请联系管理员'],
    ['FAILED', 'INFERENCE_FAILED', null, '图像分析失败', '未生成诊断结果'],
    ['FAILED', 'EXPLANATION_NOT_AVAILABLE', 'PASS', '图片质量已通过', '解释发布能力尚未接入'],
  ] as const)('explains %s / %s without displaying predictions', (status, code, gate, title, message) => {
    const wrapper = mount(WorkflowStatus, { props: { workflow: {
      ...base, status, stopReasonCode: code, qualityGate: gate,
      resultAvailability: { patientVisible: false, doctorReviewRequired: status === 'WAITING_HUMAN_REVIEW' },
    } } })
    expect(wrapper.text()).toContain(title)
    expect(wrapper.text()).toContain(message)
    expect(wrapper.text()).toContain('正式诊断记录尚未保存')
    wrapper.unmount()
  })
})
