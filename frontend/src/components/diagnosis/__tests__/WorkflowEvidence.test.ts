import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkflowEvidence from '../WorkflowEvidence.vue'

describe('task reference traceability', () => {
  it('shows source identity and scope without presenting references as a diagnosis', () => {
    const wrapper = mount(WorkflowEvidence, { props: { evidence: {
      status: 'SUFFICIENT', attempts: 1, reasonCode: null, citations: [{
        citationId: 'doc_17_chunk_0', documentId: '17', sourceRevision: 2,
        title: '<script>guide</script>', source: 'object-guide.pdf', quotedTextDigest: 'a'.repeat(64),
      }],
    } } })
    expect(wrapper.text()).toContain('doc_17_chunk_0')
    expect(wrapper.text()).toContain('object-guide.pdf')
    expect(wrapper.text()).toContain('一般参考资料')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('不证明本人的疾病或概率')
  })

  it('explains exhausted evidence retrieval with no source list', () => {
    const wrapper = mount(WorkflowEvidence, { props: { evidence: {
      status: 'INSUFFICIENT', attempts: 2, reasonCode: 'NO_MATCHING_EVIDENCE', citations: [],
    } } })
    expect(wrapper.text()).toContain('证据不足')
    expect(wrapper.text()).toContain('已尝试一次查询改写')
    expect(wrapper.findAll('li')).toHaveLength(0)
  })
})
