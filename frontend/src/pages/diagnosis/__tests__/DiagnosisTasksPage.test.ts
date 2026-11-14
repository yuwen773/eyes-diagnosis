// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLoginUserStore } from '@/stores/user'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import request from '@/request'
import DiagnosisTasksPage from '../DiagnosisTasksPage.vue'

const approvedView = {
  taskId: 'task-1', status: 'AVAILABLE', stage: 'RESULT', message: '已通过本次读取门禁', workNotes: [],
  result: { claims: [{ id: 'finding', section: 'MAIN_FINDING', text: '已审核的合成主要信息', references: [] }], sources: [],
    disclaimer: '模型预测并非确诊', modelVersion: 'synthetic-model', preprocessVersion: 'synthetic-preprocess', calibrationNotice: '模型概率不代表临床可靠性' },
}

function approvedResponses() {
  vi.mocked(request.get).mockImplementation(async path => ({ data: { code: 0, data: path === '/diagnosis-tasks'
    ? [{ taskId: 'task-1', status: 'WAITING_REVIEW' }]
    : approvedView } }))
}

describe('patient diagnosis tasks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    useLoginUserStore().setLoginUser({ id: 42, userRole: 'user' })
    vi.mocked(request.get).mockResolvedValue({ data: { code: 0, data: [] } })
  })

  it('asks about the selected published result and displays only cited plain text', async () => {
    approvedResponses()
    vi.mocked(request.post).mockResolvedValueOnce({ data: { code: 0, data: {
      taskId: 'task-1', status: 'RELATED_INFORMATION', message: '仅列出已发布的相关说明',
      claims: [{ id: 'next', section: 'NEXT_STEP', text: '<b>获准的下一步</b>', references: [{ citationIndex: 0, quote: '眼科检查' }] }],
      sources: [{ citationIndex: 0, title: '合成受控来源', source: 'javascript:alert(1)', excerpt: '眼科检查', documentVersion: 'v1', governanceVersion: 1 }],
    } } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    await wrapper.get('#follow-up-question').setValue('我下一步该做什么？')
    await wrapper.get('[data-action=follow-up]').trigger('submit')
    await flushPromises()
    expect(request.post).toHaveBeenCalledWith('/diagnosis-tasks/task-1/follow-ups', { question: '我下一步该做什么？' })
    expect(wrapper.text()).toContain('仅列出已发布的相关说明')
    expect(wrapper.text()).toContain('合成受控来源')
    expect(wrapper.html()).toContain('&lt;b&gt;获准的下一步&lt;/b&gt;')
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(wrapper.get('a[data-action=general-health]').attributes('href')).toBe('/agent')
  })

  it('shows an honest insufficient evidence response without displaying supplied clinical content', async () => {
    approvedResponses()
    vi.mocked(request.post).mockResolvedValueOnce({ data: { code: 0, data: {
      taskId: 'task-1', status: 'INSUFFICIENT_EVIDENCE', message: '未找到合格依据',
      claims: [{ id: 'unsafe', text: '不应展示的推测' }], sources: [{ title: '不应展示的来源' }],
    } } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-action=follow-up] button').attributes('disabled')).toBeDefined()
    await wrapper.get('#follow-up-question').setValue('未知问题')
    await wrapper.get('[data-action=follow-up]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('未找到合格依据')
    expect(wrapper.text()).not.toContain('不应展示')
    expect(wrapper.find('[data-action=approve-save]').exists()).toBe(false)
  })

  it.each(['RESTRICTED', 'FUTURE', 'wrong-task', 'network'])('closes old published content when a follow-up cannot be trusted: %s', async state => {
    approvedResponses()
    if (state === 'network') vi.mocked(request.post).mockRejectedValueOnce(new Error('network'))
    else vi.mocked(request.post).mockResolvedValueOnce({ data: { code: 0, data: {
      taskId: state === 'wrong-task' ? 'task-2' : 'task-1', status: state, message: '不可展示的原始响应', claims: [], sources: [],
    } } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    await wrapper.get('#follow-up-question').setValue('眼科检查')
    await wrapper.get('[data-action=follow-up]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('已关闭旧内容')
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
    expect(wrapper.text()).not.toContain('不可展示的原始响应')
  })

  it.each(['account', 'refresh', 'task'])('discards a late follow-up after changing %s', async change => {
    approvedResponses()
    vi.mocked(request.get).mockResolvedValueOnce({ data: { code: 0, data: [
      { taskId: 'task-1', status: 'WAITING_REVIEW' }, { taskId: 'task-2', status: 'WAITING_REVIEW' },
    ] } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.findAll('[data-action=open]')[0]!.trigger('click')
    await flushPromises()
    let finish!: (value: unknown) => void
    vi.mocked(request.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('#follow-up-question').setValue('眼科检查')
    await wrapper.get('[data-action=follow-up]').trigger('submit')
    if (change === 'account') useLoginUserStore().setLoginUser({ id: 99, userRole: 'user' })
    else if (change === 'refresh') await wrapper.findAll('button').find(button => button.text() === '刷新状态')!.trigger('click')
    else {
      vi.mocked(request.get).mockResolvedValueOnce({ data: { code: 0, data: { ...approvedView, taskId: 'task-2' } } })
      await wrapper.findAll('[data-action=open]')[1]!.trigger('click')
    }
    await flushPromises()
    finish({ data: { code: 0, data: { taskId: 'task-1', status: 'RELATED_INFORMATION', message: '迟到的追问', claims: [], sources: [] } } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('迟到的追问')
  })

  it('opens approved layered information and expands sources and uncertainty as plain text', async () => {
    const result = {
      claims: [
        { id: 'finding', section: 'MAIN_FINDING', text: '已审核的合成主要信息', references: [{ citationIndex: 0, quote: '眼科检查' }] },
        { id: 'uncertainty', section: 'UNCERTAINTY', text: '合成不确定性', references: [{ citationIndex: 0, quote: '眼科检查' }] },
      ],
      sources: [{ citationIndex: 0, title: '合成来源', source: 'javascript:alert(1)', excerpt: '<b>眼科检查</b>', documentVersion: 'c'.repeat(64), governanceVersion: '1' }],
      disclaimer: '模型预测并非确诊', modelVersion: 'synthetic-model', preprocessVersion: 'synthetic-preprocess', calibrationNotice: '模型概率不代表临床可靠性',
    }
    vi.mocked(request.get).mockImplementation(async path => ({ data: { code: 0, data: path === '/diagnosis-tasks'
      ? [{ taskId: 'task-1', status: 'WAITING_REVIEW' }]
      : { taskId: 'task-1', status: 'AVAILABLE', stage: 'RESULT', message: '已通过本次读取门禁', workNotes: [], result, reasoning: 'secret-reasoning' } } }))
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已审核的合成主要信息')
    expect(wrapper.text()).toContain('模型预测并非确诊')
    const details = wrapper.get('details')
    expect(details.attributes('open')).toBeUndefined()
    await details.get('summary').trigger('click')
    expect(wrapper.text()).toContain('合成不确定性')
    expect(wrapper.text()).toContain('合成来源')
    expect(wrapper.html()).toContain('&lt;b&gt;眼科检查&lt;/b&gt;')
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('secret-reasoning')
  })

  it.each(['PROCESSING', 'WAITING_REVIEW', 'RESTRICTED', 'FUTURE'])('hides result fields when the server has not released them: %s', async status => {
    vi.mocked(request.get).mockImplementation(async path => ({ data: { code: 0, data: path === '/diagnosis-tasks'
      ? [{ taskId: 'task-1', status: 'WAITING_REVIEW' }]
      : { ...approvedView, status, stage: status === 'FUTURE' ? 'secret-stage' : 'DOCTOR_REVIEW', message: '等待复核' } } }))
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
    expect(wrapper.text()).not.toContain('secret-stage')
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('clears an open result immediately on refresh and keeps it closed if the request fails', async () => {
    approvedResponses()
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已审核的合成主要信息')
    vi.mocked(request.get).mockRejectedValueOnce(new Error('network'))
    await wrapper.findAll('button').find(button => button.text() === '刷新状态')!.trigger('click')
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
    await flushPromises()
    expect(wrapper.text()).toContain('暂时无法获取任务')
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
  })

  it('discards a late result after account changes and clears the selected file', async () => {
    approvedResponses()
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['image'], 'eye.png', { type: 'image/png' })] })
    await input.trigger('change')
    let finish!: (value: unknown) => void
    vi.mocked(request.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get('[data-action=open]').trigger('click')
    vi.mocked(request.get).mockResolvedValueOnce({ data: { code: 0, data: [] } })
    useLoginUserStore().setLoginUser({ id: 99, userRole: 'user' })
    await flushPromises()
    finish({ data: { code: 0, data: approvedView } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
    expect(wrapper.find('[data-action=open]').exists()).toBe(false)
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  })

  it('keeps the newest selection when result requests finish out of order', async () => {
    approvedResponses()
    vi.mocked(request.get).mockResolvedValueOnce({ data: { code: 0, data: [{ taskId: 'task-1', status: 'WAITING_REVIEW' }, { taskId: 'task-2', status: 'WAITING_REVIEW' }] } })
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    let finish!: (value: unknown) => void
    vi.mocked(request.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.findAll('[data-action=open]')[0]!.trigger('click')
    vi.mocked(request.get).mockResolvedValueOnce({ data: { code: 0, data: { ...approvedView, taskId: 'task-2', status: 'WAITING_REVIEW', result: null, message: '等待第二项复核' } } })
    await wrapper.findAll('[data-action=open]')[1]!.trigger('click')
    await flushPromises()
    finish({ data: { code: 0, data: approvedView } })
    await flushPromises()
    expect(wrapper.text()).toContain('等待第二项复核')
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
  })

  it('does not display a result belonging to a different task', async () => {
    approvedResponses()
    const wrapper = mount(DiagnosisTasksPage)
    await flushPromises()
    vi.mocked(request.get).mockResolvedValueOnce({ data: { code: 0, data: { ...approvedView, taskId: 'task-2' } } })
    await wrapper.get('[data-action=open]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('无法读取最新结果')
    expect(wrapper.text()).not.toContain('已审核的合成主要信息')
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
    let finish!: (value: unknown) => void
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
