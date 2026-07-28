/**
 * Workflow API Client（PR-11）
 *
 * 契约来源：PR-10 冻结的 WorkflowController（/api/diagnosis/workflows）。
 * 前端只做「Backend Workflow View → Renderer」映射，禁止在此实现任何业务状态机。
 */
import request from '@/request'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { API_BASE_URL } from '@/config/env'

// ==================== 契约类型（与后端逐字对齐） ====================

/** 后端 WorkflowStatus 枚举全集（冻结，前端不得新增展示状态） */
export const WORKFLOW_STATUSES = [
  'CREATED',
  'QUEUED',
  'RUNNING',
  'WAITING_HUMAN_REVIEW',
  'COMPLETED',
  'COMPLETED_LIMITED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
] as const

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export interface SymptomsDTO {
  suddenVisionLoss: boolean
  severeEyePain: boolean
  flashingLights: boolean
}

export interface CreateWorkflowRequest {
  imageId?: string | null
  question?: string | null
  symptoms?: SymptomsDTO | null
}

export interface WorkflowCreateResult {
  workflowId: string
  status: WorkflowStatus
}

/** 患者可见的结果投影 —— 后端 PatientInferenceView，仅两个字段 */
export interface PatientInferenceView {
  diseaseCode: string
  calibratedProbability: number
}

export interface WorkflowProgressView {
  current: string | null
  completed: string[]
}

export interface WorkflowResultAvailability {
  patientVisible: boolean
  doctorReviewRequired: boolean
}

/** 后端 WorkflowStatusView。result 形态由后端按调用者角色投影，前端不做角色推断 */
export interface WorkflowStatusView {
  workflowId: string
  status: WorkflowStatus
  segment: string | null
  progress: WorkflowProgressView
  resultAvailability: WorkflowResultAvailability
  result: Record<string, unknown> | null
}

/** 后端 WorkflowEventView：只有 type/time/segment 三个字段 */
export interface WorkflowEventView {
  type: string
  time: string
  segment: string | null
}

export interface BaseResponse<T> {
  code: number
  msg: string
  data: T | null
}

// ==================== Patient Exposure Guard ====================

/**
 * 患者结果白名单投影。
 * 即使后端（或代理层）意外返回了额外字段，患者页面也只能拿到
 * diseaseCode + calibratedProbability 两个字段，其余一律丢弃。
 */
export function toPatientResult(result: unknown): PatientInferenceView | null {
  if (!result || typeof result !== 'object') {
    return null
  }
  const source = result as Record<string, unknown>
  const diseaseCode = source.diseaseCode
  const calibratedProbability = source.calibratedProbability
  if (typeof diseaseCode !== 'string' || diseaseCode.length === 0) {
    return null
  }
  if (typeof calibratedProbability !== 'number' || Number.isNaN(calibratedProbability)) {
    return null
  }
  return { diseaseCode, calibratedProbability }
}

// ==================== REST ====================

/** 创建诊断工作流 POST /api/diagnosis/workflows */
export async function createWorkflow(body: CreateWorkflowRequest) {
  return request<BaseResponse<WorkflowCreateResult>>('/diagnosis/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: body,
  })
}

/** 查询工作流状态视图 GET /api/diagnosis/workflows/{id} */
export async function getWorkflow(workflowId: string) {
  return request<BaseResponse<WorkflowStatusView>>(
    `/diagnosis/workflows/${encodeURIComponent(workflowId)}`,
    { method: 'GET' },
  )
}

/** 查询工作流事件时间线 GET /api/diagnosis/workflows/{id}/events */
export async function getEvents(workflowId: string) {
  return request<BaseResponse<WorkflowEventView[]>>(
    `/diagnosis/workflows/${encodeURIComponent(workflowId)}/events`,
    { method: 'GET' },
  )
}

/** 取消工作流 POST /api/diagnosis/workflows/{id}/cancel */
export async function cancelWorkflow(workflowId: string) {
  return request<BaseResponse<null>>(
    `/diagnosis/workflows/${encodeURIComponent(workflowId)}/cancel`,
    { method: 'POST' },
  )
}

// ==================== SSE ====================

export interface WorkflowStreamHandlers {
  /** 后端每 2s 推送一次完整 WorkflowStatusView（默认 message 事件） */
  onView: (view: WorkflowStatusView) => void
  /** 后端在工作流进入终态时发送 `event: done`，随后关闭流 */
  onDone: () => void
  onError?: (error: unknown) => void
}

export interface WorkflowStreamHandle {
  close: () => void
}

/**
 * 订阅工作流 SSE 流 GET /api/diagnosis/workflows/{id}/stream
 *
 * 事件只用于驱动 UI 展示（Timeline / Badge），不得据此修改业务状态。
 * 流的结束以后端 `done` 事件为准，前端不自行判断终态。
 */
export function connectStream(
  workflowId: string,
  handlers: WorkflowStreamHandlers,
): WorkflowStreamHandle {
  const controller = new AbortController()
  let closed = false

  const close = () => {
    if (!closed) {
      closed = true
      controller.abort()
    }
  }

  fetchEventSource(
    `${API_BASE_URL}/diagnosis/workflows/${encodeURIComponent(workflowId)}/stream`,
    {
      method: 'GET',
      credentials: 'include',
      openWhenHidden: true,
      signal: controller.signal,
      async onopen(response) {
        if (response.ok) return
        throw new Error(`workflow stream open failed: ${response.status}`)
      },
      onmessage(event) {
        if (closed) return
        if (event.event === 'done') {
          handlers.onDone()
          close()
          return
        }
        if (!event.data) return
        try {
          handlers.onView(JSON.parse(event.data) as WorkflowStatusView)
        } catch {
          // 忽略无法解析的帧，展示层保持上一帧
        }
      },
      onclose() {
        // 服务端主动关闭（如超时）；交由页面决定是否重连
      },
      onerror(err) {
        handlers.onError?.(err)
        close()
        throw err // 阻止 fetchEventSource 自动重试
      },
    },
  ).catch((err) => {
    if (!closed) {
      handlers.onError?.(err)
      close()
    }
  })

  return { close }
}

export const workflowApi = {
  createWorkflow,
  getWorkflow,
  getEvents,
  cancelWorkflow,
  connectStream,
}

export default workflowApi
