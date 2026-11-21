// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLoginUserStore } from '@/stores/user'

vi.mock('@/request', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
import request from '@/request'
import ControlledReferencesPage from '../ControlledReferencesPage.vue'

const reference = {
  id: 'reference-1', title: '合成测试资料', source: 'test-fixture', fileName: 'fixture.txt',
  documentVersion: 'a'.repeat(64), governanceVersion: 1, isTest: true,
  visibility: 'PRIVATE_USER', reviewStatus: 'PENDING', diseaseCodes: ['GLAUCOMA'],
  topicCodes: ['FOLLOW_UP'], enabled: true, uploadedBy: 1, reviewNote: '',
}

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  useLoginUserStore().setLoginUser({ id: 2, userRole: 'evidence_reviewer' })
  vi.mocked(request.get).mockResolvedValue({ data: { code: 0, data: {
    records: [reference], total: 1, reference, chunks: [{ chunkIndex: 0, excerpt: '仅供测试，不构成医学建议', excerptDigest: 'b'.repeat(64) }],
  } } })
})

it('marks test material and lets a reviewer approve then withdraw the displayed version', async () => {
  const wrapper = mount(ControlledReferencesPage)
  await flushPromises()
  expect(wrapper.text()).toContain('测试资料')
  expect(wrapper.find('input[type=file]').exists()).toBe(false)
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('仅供测试，不构成医学建议')
  await wrapper.get('[name=domainReviewed]').setValue(true)
  await wrapper.get('[name=reviewNote]').setValue('仅完成测试流程审核')
  vi.mocked(request.post).mockResolvedValueOnce({ data: { code: 0, data: {
    ...reference, reviewStatus: 'APPROVED', visibility: 'CURATED_PUBLIC', governanceVersion: 2,
  } } })
  await wrapper.get('[data-action=approve]').trigger('click')
  await flushPromises()
  expect(request.post).toHaveBeenLastCalledWith('/controlled-references/reference-1/governance', expect.objectContaining({
    expectedGovernanceVersion: 1, reviewStatus: 'APPROVED', domainReviewed: true,
    diseaseCodes: ['GLAUCOMA'], topicCodes: ['FOLLOW_UP'],
  }))
  vi.mocked(request.post).mockResolvedValueOnce({ data: { code: 0, data: {
    ...reference, reviewStatus: 'WITHDRAWN', governanceVersion: 3,
  } } })
  await wrapper.get('[data-action=withdraw]').trigger('click')
  await flushPromises()
  expect(request.post).toHaveBeenLastCalledWith('/controlled-references/reference-1/governance', expect.objectContaining({
    expectedGovernanceVersion: 2, reviewStatus: 'WITHDRAWN',
  }))
})

it('does not read references for ordinary users', async () => {
  useLoginUserStore().setLoginUser({ id: 3, userRole: 'user' })
  const wrapper = mount(ControlledReferencesPage)
  await flushPromises()
  expect(wrapper.text()).toContain('仅对管理员与领域审核人员开放')
  expect(request.get).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('合成测试资料')
})

it('lets administrators upload a clearly classified pending candidate without review controls', async () => {
  useLoginUserStore().setLoginUser({ id: 1, userRole: 'admin' })
  vi.mocked(request.post).mockResolvedValue({ data: { code: 0, data: reference } })
  const wrapper = mount(ControlledReferencesPage)
  await flushPromises()
  const input = wrapper.get('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [new File(['test content'], 'fixture.txt')] })
  await input.trigger('change')
  await wrapper.get('[name=title]').setValue('测试候选资料')
  await wrapper.get('[name=source]').setValue('test-fixture')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  const data = vi.mocked(request.post).mock.calls[0]![1] as FormData
  expect(data.get('isTest')).toBe('true')
  expect(data.get('title')).toBe('测试候选资料')
  expect(wrapper.text()).toContain('等待领域审核')
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
})

it('closes a stale review after conflict and requires reopening the current version', async () => {
  const wrapper = mount(ControlledReferencesPage)
  await flushPromises()
  await wrapper.get('[data-action=open]').trigger('click')
  await flushPromises()
  await wrapper.get('[name=domainReviewed]').setValue(true)
  await wrapper.get('[name=reviewNote]').setValue('仅用于测试')
  vi.mocked(request.post).mockRejectedValueOnce(new Error('治理版本发生冲突'))
  await wrapper.get('[data-action=approve]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('重新打开资料，核对最新版本')
  expect(wrapper.find('[data-action=approve]').exists()).toBe(false)
  expect(request.post).toHaveBeenCalledTimes(1)
})
