import { describe, expect, it, vi } from 'vitest'
import request from '@/request'

vi.mock('@/request', () => ({
  default: vi.fn(),
}))

import { getWorkflowStatsSummary } from '@/api/workflowStats'

const mockRequest = request as unknown as ReturnType<typeof vi.fn>

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

describe('getWorkflowStatsSummary', () => {
  it('请求 GET /workflow/stats/summary 并透出 data', async () => {
    mockRequest.mockResolvedValue({ data: sample })
    const res = await getWorkflowStatsSummary()
    expect(mockRequest).toHaveBeenCalledWith('/workflow/stats/summary', {
      method: 'GET',
    })
    expect(res.data.data?.todayCount).toBe(12)
    expect(res.data.data?.completionRate).toBe(0.85)
    expect(res.data.data?.avgDurationSeconds).toBe(95)
    expect(res.data.data?.pendingReviewCount).toBe(3)
  })

  it('契约字段名称与后端逐字对齐（todayCount/completionRate/avgDurationSeconds/pendingReviewCount）', async () => {
    mockRequest.mockResolvedValue({ data: sample })
    const res = await getWorkflowStatsSummary()
    const keys = Object.keys(res.data.data ?? {})
    expect(keys.sort()).toEqual(
      [
        'avgDurationSeconds',
        'completionRate',
        'pendingReviewCount',
        'todayCount',
      ].sort(),
    )
  })

  it('上游失败时向上抛出，由页面层做优雅降级', async () => {
    mockRequest.mockRejectedValue(new Error('network'))
    await expect(getWorkflowStatsSummary()).rejects.toThrow('network')
  })
})
