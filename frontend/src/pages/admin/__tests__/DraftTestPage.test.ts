// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLoginUserStore } from '@/stores/user'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import request from '@/request'
import DraftTestPage from '../DraftTestPage.vue'

const task = {
  taskId: 'task-1', status: 'WAITING_REVIEW', runStatus: null, stopReason: null, calls: 0,
  createdAt: '2026-11-10T10:00:00Z',
}
const trace = {
  taskId: 'task-1', taskStatus: 'WAITING_REVIEW', status: 'RESTRICTED', stopReason: 'PROVIDER_AUTH',
  calls: 1, supplements: 0, rewrites: 0, startedAt: '2026-11-10T10:00:00Z', deadlineAt: '2026-11-10T10:01:30Z',
  elapsedMs: 3400, predictedLabel: 'glaucoma',
  roles: [{
    sequence: 1, role: 'VISION', state: 'STOPPED', startedAt: '2026-11-10T10:00:00Z',
    completedAt: '2026-11-10T10:00:03Z', elapsedMs: 3400, hasResult: false,
    context: { predictedLabel: 'glaucoma', qualityScore: 80 }, result: null,
  }, {
    sequence: 2, role: 'EVIDENCE', state: 'COMPLETED', startedAt: '2026-11-10T10:00:04Z',
    completedAt: '2026-11-10T10:00:07Z', elapsedMs: 3100, hasResult: true,
    context: { predictedLabel: 'glaucoma', qualityScore: 80, snapshotDigest: 'abc' },
    result: { search: { query: 'glaucoma follow-up' }, citations: [{}] },
  }],
  evidence: [],
  attempts: [{
    sequence: 3, saved: false, evidenceVersion: 1, allSectionsPresent: false, missingSections: ['LIMITATION'],
    claims: [{
      id: 'c1', section: 'RISK', text: '合成患者解释',
      references: [{ citationIndex: 0, matched: false, quote: '拼接的原文' }],
    }],
  }],
  budget: { maxCalls: 8, totalMillis: 90000, callMillis: 20000 },
}
const pendingTrace = { ...trace, status: null, stopReason: null, roles: [], attempts: [], calls: 0, elapsedMs: null }

beforeEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
  setActivePinia(createPinia())
  useLoginUserStore().setLoginUser({ id: 1, userRole: 'admin' })
})

it('shows role timing, provider fault reason and failing citations', async () => {
  vi.mocked(request.get).mockImplementation(async path => ({
    data: { code: 0, data: path === '/patient-draft-test/tasks' ? [task] : trace },
  }))
  const wrapper = mount(DraftTestPage)
  await flushPromises()
  await wrapper.get('[data-action=select-task]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('四 Agent 试验台')
  expect(wrapper.text()).toContain('图像信息整理')
  expect(wrapper.text()).toContain('已停止')
  expect(wrapper.text()).toContain('PROVIDER_AUTH')
  expect(wrapper.text()).toContain('模型服务鉴权失败')
  expect(wrapper.text()).toContain('✗ 依据 1')
  expect(wrapper.text()).toContain('缺少区段：LIMITATION')
  // 每个角色的输入/产出都要能在页面上展开看到。
  expect(wrapper.text()).toContain('协作轨迹')
  expect(wrapper.text()).toContain('收到（输入）')
  expect(wrapper.text()).toContain('产出（输出）')
  expect(wrapper.text()).toContain('检索查询「glaucoma follow-up」')
  // 输入/输出用中文字段名渲染，而不是裸露的英文 JSON 键。
  expect(wrapper.text()).toContain('预测标签')
  expect(wrapper.text()).toContain('检索')
  expect(wrapper.text()).toContain('未产出结果（已停止）')
  wrapper.unmount()
})

it('triggers the coordinator only from a task that has not run yet', async () => {
  vi.mocked(request.get).mockImplementation(async path => ({
    data: { code: 0, data: path === '/patient-draft-test/tasks' ? [task] : pendingTrace },
  }))
  vi.mocked(request.post).mockResolvedValue({ data: { code: 0, data: { ...pendingTrace, status: 'RUNNING' } } })
  const wrapper = mount(DraftTestPage)
  await flushPromises()
  await wrapper.get('[data-action=select-task]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-action=run]').trigger('click')
  await flushPromises()
  expect(request.post).toHaveBeenCalledWith('/patient-draft-test/tasks/task-1/run')
  expect(wrapper.text()).toContain('执行中')
  wrapper.unmount()
})

it('seeds a synthetic task and opens it', async () => {
  vi.mocked(request.get).mockImplementation(async path => ({
    data: { code: 0, data: path === '/patient-draft-test/tasks' ? [task] : pendingTrace },
  }))
  vi.mocked(request.post).mockResolvedValue({ data: { code: 0, data: task.taskId } })
  const wrapper = mount(DraftTestPage)
  await flushPromises()
  await wrapper.get('[data-action=seed]').trigger('click')
  await flushPromises()
  expect(request.post).toHaveBeenCalledWith('/patient-draft-test/seed', null, { params: { label: 'glaucoma' } })
  expect(wrapper.text()).toContain('非真实医学来源')
  wrapper.unmount()
})

it('keeps the entry closed for non-admin users', async () => {
  useLoginUserStore().setLoginUser({ id: 2, userRole: 'doctor' })
  const wrapper = mount(DraftTestPage)
  await flushPromises()
  expect(wrapper.text()).toContain('仅对管理员开放')
  expect(request.get).not.toHaveBeenCalled()
  wrapper.unmount()
})
