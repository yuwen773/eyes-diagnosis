import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReviewActionPanel from '@/components/workflow/ReviewActionPanel.vue'
import type { ReviewDecisionCode } from '@/api/review'

const mountPanel = (allowedActions: ReviewDecisionCode[], submitting = false) =>
  mount(ReviewActionPanel, { props: { allowedActions, submitting } })

describe('ReviewActionPanel（allowedActions 驱动）', () => {
  it('renders exactly the buttons listed in allowedActions — nothing more', () => {
    const wrapper = mountPanel(['APPROVE_CONTINUE', 'REJECT_RESUBMIT'])
    const buttons = wrapper.findAll('.review-action')
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.attributes('data-action'))).toEqual([
      'APPROVE_CONTINUE',
      'REJECT_RESUBMIT',
    ])
  })

  it('quality gate actions render with expected labels', () => {
    const wrapper = mountPanel(['APPROVE_CONTINUE', 'REJECT_RESUBMIT'])
    expect(wrapper.text()).toContain('继续分析')
    expect(wrapper.text()).toContain('要求重新上传')
  })

  it('final review (valid prediction) actions render dynamically', () => {
    const wrapper = mountPanel(['CONFIRM_AI_ASSESSMENT', 'CORRECT_AI_ASSESSMENT', 'INCONCLUSIVE'])
    expect(wrapper.findAll('.review-action')).toHaveLength(3)
    expect(wrapper.text()).toContain('确认 AI 结果')
    expect(wrapper.text()).toContain('修正 AI 判断')
    expect(wrapper.text()).toContain('无法确认')
  })

  it('final review (abstention) actions render dynamically', () => {
    const wrapper = mountPanel(['CONFIRM_ABSTENTION', 'PROVIDE_INDEPENDENT_REVIEW', 'INCONCLUSIVE'])
    expect(wrapper.findAll('.review-action')).toHaveLength(3)
    expect(wrapper.text()).toContain('确认 AI 拒识')
    expect(wrapper.text()).toContain('出具独立判读')
  })

  it('empty allowedActions renders no buttons and an explanatory hint', () => {
    const wrapper = mountPanel([])
    expect(wrapper.findAll('.review-action')).toHaveLength(0)
    expect(wrapper.find('[data-testid="review-no-actions"]').exists()).toBe(true)
  })

  it('submit is disabled until an action is selected', async () => {
    const wrapper = mountPanel(['APPROVE_CONTINUE'])
    const submit = wrapper.find('[data-testid="review-submit"]')
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-action="APPROVE_CONTINUE"]').trigger('click')
    expect(wrapper.find('[data-testid="review-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('emits selected decision with trimmed comment on submit', async () => {
    const wrapper = mountPanel(['CONFIRM_AI_ASSESSMENT', 'INCONCLUSIVE'])
    await wrapper.find('[data-action="CONFIRM_AI_ASSESSMENT"]').trigger('click')
    await wrapper.find('[data-testid="review-comment"]').setValue('  影像清晰，结论一致  ')
    await wrapper.find('[data-testid="review-submit"]').trigger('click')
    const emitted = wrapper.emitted('submit')
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toEqual({
      decision: 'CONFIRM_AI_ASSESSMENT',
      comment: '影像清晰，结论一致',
    })
  })

  it('does not emit while submitting', async () => {
    const wrapper = mountPanel(['CONFIRM_AI_ASSESSMENT'], true)
    await wrapper.find('[data-action="CONFIRM_AI_ASSESSMENT"]').trigger('click')
    await wrapper.find('[data-testid="review-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
