import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkflowStatusBadge from '@/components/workflow/WorkflowStatusBadge.vue'
import { WORKFLOW_STATUSES } from '@/api/workflow'

const mountBadge = (status: string | null | undefined) =>
  mount(WorkflowStatusBadge, { props: { status } })

describe('WorkflowStatusBadge', () => {
  it('renders CREATED', () => {
    const wrapper = mountBadge('CREATED')
    expect(wrapper.text()).toContain('已创建')
    expect(wrapper.attributes('data-status')).toBe('CREATED')
  })

  it('renders QUEUED', () => {
    expect(mountBadge('QUEUED').text()).toContain('排队中')
  })

  it('renders RUNNING', () => {
    expect(mountBadge('RUNNING').text()).toContain('分析进行中')
  })

  it('renders WAITING_HUMAN_REVIEW', () => {
    expect(mountBadge('WAITING_HUMAN_REVIEW').text()).toContain('等待医生复核')
  })

  it('renders COMPLETED', () => {
    expect(mountBadge('COMPLETED').text()).toContain('已完成')
  })

  it('renders COMPLETED_LIMITED', () => {
    expect(mountBadge('COMPLETED_LIMITED').text()).toContain('完成（有限结果）')
  })

  it('renders REJECTED', () => {
    expect(mountBadge('REJECTED').text()).toContain('未通过')
  })

  it('renders CANCELLED', () => {
    expect(mountBadge('CANCELLED').text()).toContain('已取消')
  })

  it('renders FAILED', () => {
    expect(mountBadge('FAILED').text()).toContain('处理失败')
  })

  it('covers every backend WorkflowStatus with a mapped label (no missing status)', () => {
    for (const status of WORKFLOW_STATUSES) {
      const wrapper = mountBadge(status)
      // 已映射的状态不应回退为原始枚举名
      expect(wrapper.text()).not.toContain(status)
    }
  })

  it('does NOT invent frontend-only statuses: unknown status falls back to raw text', () => {
    // ANALYZING / CHECKING / GENERATING 不是后端状态，组件必须原样透出而非映射
    for (const fake of ['ANALYZING', 'CHECKING', 'GENERATING']) {
      const wrapper = mountBadge(fake)
      expect(wrapper.text()).toContain(fake)
    }
  })

  it('renders a placeholder for null status', () => {
    expect(mountBadge(null).text()).toContain('未知状态')
  })
})
