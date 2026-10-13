import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeGovernanceEditor from '../KnowledgeGovernanceEditor.vue'

const api = vi.hoisted(() => ({ update: vi.fn(), catalog: vi.fn() }))
vi.mock('@/api/knowledgeController', () => ({
  updateKnowledgeGovernance: api.update, getEvidenceCatalog: api.catalog,
}))

const document = {
  id: '17', userId: 7, title: 'Reference guide', fileName: 'guide.pdf', fileUrl: 'guide-key',
  fileSize: 100, fileType: 'pdf', chunkCount: 1, status: 1, createTime: '', updateTime: '',
  visibility: 'PRIVATE_USER', reviewStatus: 'PENDING', diseaseCodes: [], topicCodes: [], governanceVersion: 3,
} as const

describe('reference review confirmation', () => {
  beforeEach(() => {
    api.catalog.mockResolvedValue({ diseaseCodes: { glaucoma: 'glaucoma' },
      topicCodes: { DISEASE_OVERVIEW: 'disease overview' } })
    api.update.mockReset()
  })

  it('requires confirmation and sends the displayed metadata version', async () => {
    api.update.mockResolvedValue({ code: 0, data: {} })
    const wrapper = mount(KnowledgeGovernanceEditor, { props: { document: { ...document,
      diseaseCodes: [], topicCodes: [] } } })
    await flushPromises()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('select[aria-label="可见范围"]').setValue('CURATED_PUBLIC')
    await wrapper.get('select[aria-label="审核状态"]').setValue('APPROVED')
    await wrapper.get('input[value="glaucoma"]').setValue(true)
    await wrapper.get('input[value="DISEASE_OVERVIEW"]').setValue(true)
    await wrapper.get('input[aria-label="确认审核变更"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.update).toHaveBeenCalledWith('17', {
      visibility: 'CURATED_PUBLIC', reviewStatus: 'APPROVED', diseaseCodes: ['glaucoma'],
      topicCodes: ['DISEASE_OVERVIEW'], expectedVersion: 3, confirmed: true,
    })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('shows a concurrent update error and clears confirmation', async () => {
    api.update.mockRejectedValue({ response: { data: { msg: '资料已更新，请刷新后重新确认' } } })
    const wrapper = mount(KnowledgeGovernanceEditor, { props: { document: { ...document,
      diseaseCodes: [], topicCodes: [] } } })
    await flushPromises()
    await wrapper.get('input[aria-label="确认审核变更"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('资料已更新')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})
