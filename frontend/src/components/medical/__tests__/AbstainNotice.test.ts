import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AbstainNotice from '@/components/medical/AbstainNotice.vue'
import HumanReviewBadge from '@/components/medical/HumanReviewBadge.vue'

describe('AbstainNotice', () => {
  it('hides when accepted', () => {
    const wrapper = mount(AbstainNotice, { props: { rejected: false } })
    expect(wrapper.find('a-alert').exists()).toBe(false)
  })

  it('renders quality failure message', () => {
    const wrapper = mount(AbstainNotice, {
      props: { rejected: true, reason: 'QUALITY_FAIL' },
    })
    expect(wrapper.text()).toContain('重新拍摄')
  })

  it('renders OOD message', () => {
    const wrapper = mount(AbstainNotice, {
      props: { rejected: true, reason: 'OOD' },
    })
    expect(wrapper.text()).toContain('分布差异')
  })

  it('renders low confidence message', () => {
    const wrapper = mount(AbstainNotice, {
      props: { rejected: false, reason: 'LOW_CONFIDENCE' },
    })
    expect(wrapper.text()).toContain('置信度不足')
  })
})

describe('HumanReviewBadge', () => {
  it('maps REVIEWED to 已人工复核', () => {
    const wrapper = mount(HumanReviewBadge, { props: { status: 'REVIEWED' } })
    expect(wrapper.text()).toContain('已人工复核')
  })

  it('maps AWAITING_REVIEW to 需人工复核', () => {
    const wrapper = mount(HumanReviewBadge, { props: { status: 'AWAITING_REVIEW' } })
    expect(wrapper.text()).toContain('需人工复核')
  })

  it('maps AI_ONLY to 仅 AI 结论', () => {
    const wrapper = mount(HumanReviewBadge, { props: { status: 'AI_ONLY' } })
    expect(wrapper.text()).toContain('仅 AI 结论')
  })
})