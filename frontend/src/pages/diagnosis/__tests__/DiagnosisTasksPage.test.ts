// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import request from '@/request'
import DiagnosisTasksPage from '../DiagnosisTasksPage.vue'

describe('patient diagnosis tasks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(request.get).mockResolvedValue({ data: { code: 0, data: [] } })
  })

  it('shows only safe states and hides unexpected response fields', async () => {
    vi.mocked(request.get).mockResolvedValue({ data: { code: 0, data: [
      { taskId: 'task-1', status: 'WAITING_REVIEW', predictedLabel: 'sensitive-prediction' },
      { taskId: 'task-2', status: 'FUTURE' },
    ] } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    expect(wrapper.text()).toContain('等待后续复核')
    expect(wrapper.text()).toContain('暂无法继续')
    expect(wrapper.text()).not.toContain('sensitive-prediction')
  })

  it('reuses the same idempotency key after an uncertain request failure', async () => {
    vi.mocked(request.post).mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { code: 0, data: { taskId: 'task-1', status: 'PROCESSING' } } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'eye.png', { type: 'image/png' })] })
    await input.trigger('change')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const calls = vi.mocked(request.post).mock.calls
    expect(calls).toHaveLength(2)
    expect((calls[0]![1] as FormData).get('idempotencyKey')).toBeTruthy()
    expect((calls[0]![1] as FormData).get('idempotencyKey')).toBe((calls[1]![1] as FormData).get('idempotencyKey'))
  })

  it('locks file selection while the request is in flight', async () => {
    let finish!: (value: any) => void
    vi.mocked(request.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'eye.png', { type: 'image/png' })] })
    await input.trigger('change')
    await wrapper.get('form').trigger('submit')
    expect((input.element as HTMLInputElement).disabled).toBe(true)
    finish({ data: { code: 0, data: { taskId: 'task-1', status: 'PROCESSING' } } })
    await flushPromises()
    expect((input.element as HTMLInputElement).disabled).toBe(false)
  })

  it('asks for a different image when the server rejects an invalid file', async () => {
    vi.mocked(request.post).mockResolvedValue({ data: { code: 40000, data: null } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['bad'], 'eye.png')] })
    await input.trigger('change')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('图片无效')
  })
})
