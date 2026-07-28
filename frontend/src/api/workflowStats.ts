/**
 * Workflow Stats API Client（PR-12）
 *
 * 契约来源：本 PR 新增的 WorkflowController 统计接口。
 * 前端仅做「Backend Response → Renderer」映射，不实现任何统计状态机。
 */
import request from '@/request'
import type { BaseResponse } from '@/api/workflow'

/** 后端统计概要投影（字段名与后端逐字对齐） */
export interface WorkflowStatsSummary {
  /** 今日诊断数量 */
  todayCount: number
  /** 完成率（0~1 之间为比例，>=1 视作已百分比化，渲染层兼容两种口径） */
  completionRate: number
  /** 平均耗时（秒） */
  avgDurationSeconds: number
  /** 待人工复核数量 */
  pendingReviewCount: number
}

/** GET /api/workflow/stats/summary —— 诊断运营概要指标 */
export async function getWorkflowStatsSummary() {
  return request<BaseResponse<WorkflowStatsSummary>>('/workflow/stats/summary', {
    method: 'GET',
  })
}

export const workflowStatsApi = {
  getWorkflowStatsSummary,
}

export default workflowStatsApi
