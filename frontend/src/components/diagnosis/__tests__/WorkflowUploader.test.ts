import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/request', () => ({ default: vi.fn() }))
import request from '@/request'
import WorkflowUploader from '@/components/diagnosis/WorkflowUploader.vue'

const queued = {
  workflowId: 'durable-1', status: 'QUEUED', workflowVersion: '0', segment: null,
  progress: { current: null, completed: [] }, stopReasonCode: null,
  resultAvailability: { patientVisible: false, doctorReviewRequired: false }, result: null,
}

describe('upload page durable tasks', () => {
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

  it('submits one task and restores its server state after the page is rebuilt', async () => {
    vi.mocked(request).mockResolvedValue({ data: { code: 0, data: queued } })
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/diagnosis', component: WorkflowUploader },
    ] })
    await router.push('/diagnosis')
    await router.isReady()
    const wrapper = mount(WorkflowUploader, { global: { plugins: [router] } })
    const file = new File(['test-image'], 'fundus.png', { type: 'image/png' })
    Object.defineProperty(wrapper.get('input[type=file]').element, 'files', { value: [file] })
    await wrapper.get('input[type=file]').trigger('change')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('durable-1')
    expect(wrapper.text()).toContain('等待处理')
    expect(router.currentRoute.value.query.workflow).toBe('durable-1')
    const submits = vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(submits).toHaveLength(1)
    expect((submits[0][1]?.data as FormData).get('idempotencyKey')).toBeTruthy()
    wrapper.unmount()

    vi.mocked(request).mockResolvedValue({ data: { code: 0, data: {
      ...queued, status: 'FAILED', stopReasonCode: 'DIAGNOSIS_NOT_AVAILABLE',
      progress: { current: 'diagnosisUnavailable', completed: ['validateImage', 'diagnosisUnavailable'] },
    } } })
    const restored = mount(WorkflowUploader, { global: { plugins: [router] } })
    await flushPromises()
    expect(restored.text()).toContain('诊断能力尚未接入')
    expect(restored.text()).toContain('durable-1')
    expect(vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    restored.unmount()
  })
})
