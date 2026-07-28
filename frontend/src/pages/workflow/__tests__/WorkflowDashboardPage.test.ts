import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/api/workflowStats', () => ({
  getWorkflowStatsSummary: vi.fn(),
}))

import WorkflowDashboardPage from '@/pages/workflow/WorkflowDashboardPage.vue'
import { getWorkflowStatsSummary } from '@/api/workflowStats'

const mockStats = vi.mocked(getWorkflowStatsSummary)

const sample = {
  code: 0,
  msg: 'ok',
  data: {
    todayCount: 12,
    completionRate: 0.85,
    avgDurationSeconds: 95,
    pendingReviewCount: 3,
  },
}

describe('WorkflowDashboardPage', () => {
  beforeEach(() => {
    mockStats.mockReset()
  })

  it('加载成功后渲染 4 个指标卡并显示正确数值', async () => {
    mockStats.mockResolvedValue({ data: sample } as never)
    const wrapper = mount(WorkflowDashboardPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="dashboard-metrics"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="metric-todayCount"]').text()).toBe('12')
    expect(wrapper.find('[data-testid="metric-completionRate"]').text()).toBe('85.0%')
    expect(wrapper.find('[data-testid="metric-avgDurationSeconds"]').text()).toBe('1分35秒')
    expect(wrapper.find('[data-testid="metric-pendingReviewCount"]').text()).toBe('3')
    expect(wrapper.find('[data-testid="dashboard-empty"]').exists()).toBe(false)
  })

  it('加载失败时优雅降级显示「暂无数据」', async () => {
    mockStats.mockRejectedValue(new Error('network'))
    const wrapper = mount(WorkflowDashboardPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="dashboard-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无数据')
    expect(wrapper.find('[data-testid="dashboard-metrics"]').exists()).toBe(false)
  })

  it('后端返回 data 为 null（code 非 0）时也显示「暂无数据」', async () => {
    mockStats.mockResolvedValue({ data: { code: 500, msg: 'err', data: null } } as never)
    const wrapper = mount(WorkflowDashboardPage)
    await flushPromises()
    expect(wrapper.text()).toContain('暂无数据')
  })

  it('请求未完成时展示加载态', () => {
    mockStats.mockReturnValue(new Promise(() => {}) as never)
    const wrapper = mount(WorkflowDashboardPage)
    expect(wrapper.find('[data-testid="dashboard-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-metrics"]').exists()).toBe(false)
  })
})
