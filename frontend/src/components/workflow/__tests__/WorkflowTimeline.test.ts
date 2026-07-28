import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkflowTimeline from '@/components/workflow/WorkflowTimeline.vue'
import type { WorkflowEventView, WorkflowProgressView } from '@/api/workflow'

const mountTimeline = (options: {
  status: string
  progress?: WorkflowProgressView | null
  events?: WorkflowEventView[] | null
}) =>
  mount(WorkflowTimeline, {
    props: {
      status: options.status,
      progress: options.progress ?? null,
      events: options.events ?? null,
    },
  })

describe('WorkflowTimeline', () => {
  it('CREATED: shows created event and empty steps placeholder', () => {
    const wrapper = mountTimeline({
      status: 'CREATED',
      progress: { current: null, completed: [] },
      events: [{ type: 'WORKFLOW_CREATED', time: '2026-07-28T10:00:00', segment: null }],
    })
    expect(wrapper.find('[data-testid="timeline-steps-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('诊断工作流已创建')
  })

  it('RUNNING: renders current step from backend progress display name', () => {
    const wrapper = mountTimeline({
      status: 'RUNNING',
      progress: { current: 'Image Quality & Intake', completed: [] },
    })
    const current = wrapper.find('[data-step-state="current"]')
    expect(current.exists()).toBe(true)
    expect(current.text()).toContain('Image Quality & Intake')
    expect(current.text()).toContain('进行中')
  })

  it('RUNNING: renders completed steps before current step', () => {
    const wrapper = mountTimeline({
      status: 'RUNNING',
      progress: {
        current: 'Evidence Retrieval',
        completed: ['Image Quality & Intake', 'Quality Review'],
      },
    })
    const steps = wrapper.findAll('.wf-step')
    expect(steps).toHaveLength(3)
    expect(steps[0].attributes('data-step-state')).toBe('completed')
    expect(steps[1].attributes('data-step-state')).toBe('completed')
    expect(steps[2].attributes('data-step-state')).toBe('current')
  })

  it('WAITING_HUMAN_REVIEW: shows status badge and review-related events', () => {
    const wrapper = mountTimeline({
      status: 'WAITING_HUMAN_REVIEW',
      progress: { current: 'Clinical Review', completed: ['Image Quality & Intake'] },
      events: [
        { type: 'WORKFLOW_CREATED', time: '2026-07-28T10:00:00', segment: null },
        {
          type: 'HUMAN_REVIEW_DECISION_SUBMITTED',
          time: '2026-07-28T10:05:00',
          segment: 'FINAL_CLINICAL_REVIEW_RESUME',
        },
      ],
    })
    expect(wrapper.text()).toContain('等待医生复核')
    expect(wrapper.text()).toContain('医生已提交审核决定')
  })

  it('COMPLETED: renders all completed steps without a current step', () => {
    const wrapper = mountTimeline({
      status: 'COMPLETED',
      progress: {
        current: null,
        completed: ['Image Quality & Intake', 'Evidence Retrieval', 'Risk & Explanation'],
      },
    })
    expect(wrapper.findAll('[data-step-state="completed"]')).toHaveLength(3)
    expect(wrapper.find('[data-step-state="current"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已完成')
  })

  it('renders events strictly in backend order (event-driven, no reordering)', () => {
    const wrapper = mountTimeline({
      status: 'RUNNING',
      events: [
        { type: 'EVENT_B', time: '2026-07-28T10:02:00', segment: null },
        { type: 'EVENT_A', time: '2026-07-28T10:01:00', segment: null },
      ],
    })
    const items = wrapper.findAll('.wf-event')
    expect(items[0].text()).toContain('EVENT_B')
    expect(items[1].text()).toContain('EVENT_A')
  })

  it('renders unknown event types verbatim (no frontend interpretation)', () => {
    const wrapper = mountTimeline({
      status: 'RUNNING',
      events: [{ type: 'SEGMENT_COMMITTED_XYZ', time: '2026-07-28T10:00:00', segment: 'FINAL_RISK_EXPLANATION' }],
    })
    expect(wrapper.text()).toContain('SEGMENT_COMMITTED_XYZ')
    expect(wrapper.text()).toContain('FINAL_RISK_EXPLANATION')
  })

  it('does not fabricate steps: steps come only from backend progress props', () => {
    const wrapper = mountTimeline({
      status: 'RUNNING',
      progress: { current: null, completed: [] },
    })
    expect(wrapper.findAll('.wf-step')).toHaveLength(0)
  })

  it('shows empty events placeholder when no events', () => {
    const wrapper = mountTimeline({ status: 'QUEUED', events: [] })
    expect(wrapper.find('[data-testid="timeline-events-empty"]').exists()).toBe(true)
  })
})
