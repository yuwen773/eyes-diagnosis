/**
 * Review API Client（PR-11）
 *
 * 契约来源：PR-10 冻结的 ReviewController（/api/reviews）。
 *
 * 注意：后端当前契约不下发 allowedActions 字段。前端唯一允许的动作来源是
 * 本文件的 resolveAllowedActions —— 它逐字镜像后端
 * ReviewDecisionCompatibilityGuard 的决策矩阵，任何组件都必须消费
 * allowedActions 数组渲染，禁止自行按置信度/状态增删按钮。
 */
import request from '@/request'
import type { BaseResponse } from '@/api/workflow'

// ==================== 契约类型（与后端逐字对齐） ====================

export type ReviewType = 'IMAGE_QUALITY_GATE' | 'FINAL_CLINICAL_REVIEW'

export type InferenceOutcomeType =
  | 'VALID_PREDICTION'
  | 'SAFETY_ABSTENTION'
  | 'TECHNICAL_FAILURE'

export type ReviewDecisionCode =
  | 'APPROVE_CONTINUE'
  | 'REJECT_RESUBMIT'
  | 'CONFIRM_AI_ASSESSMENT'
  | 'CORRECT_AI_ASSESSMENT'
  | 'CONFIRM_ABSTENTION'
  | 'PROVIDE_INDEPENDENT_REVIEW'
  | 'INCONCLUSIVE'

/** 后端 ReviewTaskSummaryVO：仅三个字段（reason = ReviewType 枚举名） */
export interface ReviewTaskSummaryVO {
  taskId: string
  workflowId: string
  reason: ReviewType
}

export interface SubmitReviewDecisionRequest {
  decision: ReviewDecisionCode
  comment?: string | null
}

export interface ReviewSubmissionVO {
  taskId: string
  workflowId: string
  committedWorkflowVersion: number
  resumeJobId: string
}

// ==================== Allowed Actions（镜像后端动作矩阵） ====================

/**
 * 逐字镜像后端 ReviewDecisionCompatibilityGuard.requireDecisionAllowed：
 *
 * | reviewType            | inferenceOutcomeType | 允许 decision                                                        |
 * |-----------------------|----------------------|----------------------------------------------------------------------|
 * | IMAGE_QUALITY_GATE    | （任意）             | APPROVE_CONTINUE, REJECT_RESUBMIT                                    |
 * | FINAL_CLINICAL_REVIEW | VALID_PREDICTION     | CONFIRM_AI_ASSESSMENT, CORRECT_AI_ASSESSMENT, INCONCLUSIVE           |
 * | FINAL_CLINICAL_REVIEW | SAFETY_ABSTENTION    | CONFIRM_ABSTENTION, PROVIDE_INDEPENDENT_REVIEW, INCONCLUSIVE         |
 * | FINAL_CLINICAL_REVIEW | TECHNICAL_FAILURE    | （不允许任何 decision）                                               |
 *
 * 后端契约新增 allowedActions 下发后，本函数应被删除并直接消费后端字段。
 */
export function resolveAllowedActions(
  reviewType: ReviewType | string | null | undefined,
  outcomeType: InferenceOutcomeType | string | null | undefined,
): ReviewDecisionCode[] {
  if (reviewType === 'IMAGE_QUALITY_GATE') {
    return ['APPROVE_CONTINUE', 'REJECT_RESUBMIT']
  }
  if (reviewType === 'FINAL_CLINICAL_REVIEW') {
    if (outcomeType === 'VALID_PREDICTION') {
      return ['CONFIRM_AI_ASSESSMENT', 'CORRECT_AI_ASSESSMENT', 'INCONCLUSIVE']
    }
    if (outcomeType === 'SAFETY_ABSTENTION') {
      return ['CONFIRM_ABSTENTION', 'PROVIDE_INDEPENDENT_REVIEW', 'INCONCLUSIVE']
    }
    return []
  }
  return []
}

/** 审核动作展示文案（仅文案，不承载任何业务判断） */
export const DECISION_LABELS: Record<ReviewDecisionCode, string> = {
  APPROVE_CONTINUE: '继续分析',
  REJECT_RESUBMIT: '要求重新上传',
  CONFIRM_AI_ASSESSMENT: '确认 AI 结果',
  CORRECT_AI_ASSESSMENT: '修正 AI 判断',
  CONFIRM_ABSTENTION: '确认 AI 拒识',
  PROVIDE_INDEPENDENT_REVIEW: '出具独立判读',
  INCONCLUSIVE: '无法确认',
}

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  IMAGE_QUALITY_GATE: '影像质量审核',
  FINAL_CLINICAL_REVIEW: '最终临床审核',
}

// ==================== REST ====================

/** 待审核任务列表 GET /api/reviews/tasks */
export async function listTasks() {
  return request<BaseResponse<ReviewTaskSummaryVO[]>>('/reviews/tasks', {
    method: 'GET',
  })
}

/** 认领审核任务 POST /api/reviews/tasks/{taskId}/claim */
export async function claimTask(taskId: string) {
  return request<BaseResponse<null>>(
    `/reviews/tasks/${encodeURIComponent(taskId)}/claim`,
    { method: 'POST' },
  )
}

/** 提交审核决定 POST /api/reviews/tasks/{taskId}/submit */
export async function submitDecision(taskId: string, body: SubmitReviewDecisionRequest) {
  return request<BaseResponse<ReviewSubmissionVO>>(
    `/reviews/tasks/${encodeURIComponent(taskId)}/submit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
    },
  )
}

export const reviewApi = {
  listTasks,
  claimTask,
  submitDecision,
  resolveAllowedActions,
}

export default reviewApi
