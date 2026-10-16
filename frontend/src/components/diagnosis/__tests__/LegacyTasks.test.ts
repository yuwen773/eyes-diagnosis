import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/request', () => ({ default: vi.fn() }))
import request from '@/request'
import LegacyTasks from '@/components/diagnosis/LegacyTasks.vue'

const old = { taskId: 'java-wait', sourceType: 'workflow', status: 'WAITING_HUMAN_REVIEW',
  createdAt: '2025-01-02T03:04:05', updatedAt: null, sourceVersion: 'java-release',
  question: null, requiresUpload: true }

afterEach(() => { vi.clearAllMocks(); sessionStorage.clear() })

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/diagnosis/legacy', component: LegacyTasks },
    { path: '/diagnosis', component: { template: '<div />' } },
    { path: '/user/userCenter/diagnosisHistory', component: { template: '<div />' } },
  ] })
  await router.push('/diagnosis/legacy?source=workflow&task=java-wait')
  const wrapper = mount(LegacyTasks, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

it('lists, views and refreshes legacy metadata without sending any task command', async () => {
  vi.mocked(request).mockImplementation(async (url) => ({ data: { code: 0, data:
    url === '/diagnosis/legacy-tasks' ? { records: [old], total: 1 } : old } }))
  const wrapper = await render()
  expect(wrapper.text()).toContain('旧版任务（只读）')
  expect(wrapper.text()).toContain('WAITING_HUMAN_REVIEW')
  expect(wrapper.text()).toContain('java-release')
  expect(wrapper.text()).toContain('旧批准不会转移')
  await wrapper.get('[data-test=refresh]').trigger('click')
  await flushPromises()
  expect(vi.mocked(request).mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
  wrapper.unmount()
})

it('requires a new image and explicit confirmation and reuses the key after an uncertain response', async () => {
  let attempts = 0
  vi.mocked(request).mockImplementation(async (url, options) => {
    if (options?.method === 'POST') {
      if (++attempts === 1) throw new Error('connection lost after commit')
      return { data: { code: 0, data: { workflowId: attempts === 2 ? 'new-python' : 'second-python' } } }
    }
    return { data: { code: 0, data: url === '/diagnosis/legacy-tasks' ? { records: [old], total: 1 } : old } }
  })
  const wrapper = await render()
  expect(wrapper.get('[type=submit]').attributes('disabled')).toBeDefined()
  const input = wrapper.get('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [new File(['png'], 'eye.png', { type: 'image/png' })] })
  await input.trigger('change')
  expect(wrapper.get('[type=submit]').attributes('disabled')).toBeDefined()
  await wrapper.get('input[type=checkbox]').setValue(true)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('重试')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  const posts = vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  expect(posts).toHaveLength(2)
  const bodies = posts.map(([, options]) => options?.data as FormData)
  expect(bodies[0].get('idempotencyKey')).toBe(bodies[1].get('idempotencyKey'))
  expect(bodies[0].get('confirmed')).toBe('true')
  expect(wrapper.get('[data-test=new-workflow]').attributes('href')).toBe('/diagnosis?workflow=new-python')
  wrapper.unmount()

  const restored = await render()
  expect(restored.get('[data-test=new-workflow]').attributes('href')).toBe('/diagnosis?workflow=new-python')
  expect(restored.get('[type=submit]').attributes('disabled')).toBeDefined()
  await restored.get('[data-test=new-rebuild]').trigger('click')
  expect(restored.find('[data-test=new-workflow]').exists()).toBe(false)
  const nextFile = restored.get('input[type=file]')
  Object.defineProperty(nextFile.element, 'files', { value: [new File(['corrected'], 'corrected.png', { type: 'image/png' })] })
  await nextFile.trigger('change')
  expect(restored.get('[type=submit]').attributes('disabled')).toBeDefined()
  await restored.get('input[type=checkbox]').setValue(true)
  await restored.get('form').trigger('submit')
  await flushPromises()
  const finalPosts = vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')
  expect((finalPosts[2][1]?.data as FormData).get('idempotencyKey')).not.toBe(bodies[0].get('idempotencyKey'))
  expect(restored.get('[data-test=new-workflow]').attributes('href')).toBe('/diagnosis?workflow=second-python')
  restored.unmount()
})
