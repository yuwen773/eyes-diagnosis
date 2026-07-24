import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MedicalDisclaimer from '@/components/medical/MedicalDisclaimer.vue'

describe('MedicalDisclaimer', () => {
  it('renders mandatory copy', () => {
    const wrapper = mount(MedicalDisclaimer, { props: { scope: 'ai' } })
    expect(wrapper.text()).toContain('AI 辅助分析')
    expect(wrapper.text()).toContain('不能替代专业医生')
  })

  it('includes model provenance when provided', () => {
    const wrapper = mount(MedicalDisclaimer, {
      props: {
        scope: 'ai',
        modelVersion: 'efficientnet-b4@1.0.0',
        weightSha256: 'abcdef0123456789',
      },
    })
    expect(wrapper.text()).toContain('efficientnet-b4@1.0.0')
    expect(wrapper.text()).toContain('abcdef01…')
  })

  it('review scope renders different copy', () => {
    const wrapper = mount(MedicalDisclaimer, { props: { scope: 'review' } })
    expect(wrapper.text()).toContain('人工复核')
    expect(wrapper.text()).not.toContain('AI 辅助分析')
  })
})