import request from '@/request'

export type WorkflowStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'WAITING_HUMAN_REVIEW'
  | 'COMPLETED' | 'COMPLETED_LIMITED' | 'REJECTED' | 'CANCELLED' | 'FAILED'

export interface WorkflowView {
  workflowId: string
  status: WorkflowStatus
  workflowVersion: string
  graphDefinitionVersion: string
  segment: string | null
  progress: { current: string | null; completed: string[] }
  stopReasonCode: string | null
  qualityGate: 'PASS' | 'REJECT' | 'REVIEW' | null
  resultAvailability: { patientVisible: boolean; doctorReviewRequired: boolean }
  result: null
}

interface WorkflowResponse { code: number; msg: string; data: WorkflowView }

export async function createUploadWorkflow(file: File, idempotencyKey: string) {
  const data = new FormData()
  data.append('file', file)
  data.append('idempotencyKey', idempotencyKey)
  const response = await request<WorkflowResponse>('/diagnosis/workflows', { method: 'POST', data })
  return response.data.data
}

export async function getUploadWorkflow(workflowId: string, signal: AbortSignal) {
  const response = await request<WorkflowResponse>(`/diagnosis/workflows/${encodeURIComponent(workflowId)}`,
    { method: 'GET', signal })
  return response.data.data
}
