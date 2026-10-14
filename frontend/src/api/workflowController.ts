import request from '@/request'
import type { SupplementView } from './supplementController'
import type { SaveConfirmation } from './diagnosisSaveController'

export interface WorkflowSnapshot {
  workflow: WorkflowView
  supplements: SupplementView[]
  saveConfirmation: SaveConfirmation | null
}

export type WorkflowStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'WAITING_HUMAN_REVIEW'
  | 'COMPLETED' | 'COMPLETED_LIMITED' | 'REJECTED' | 'CANCELLED' | 'FAILED'

export interface WorkflowEvidenceView {
  status: 'SUFFICIENT' | 'INSUFFICIENT'
  reasonCode: string | null
  attempts: number
  citations: { citationId: string; documentId: string; sourceRevision: number;
    title: string; source: string; quotedTextDigest: string }[]
}

export interface WorkflowView {
  workflowId: string
  status: WorkflowStatus
  workflowVersion: string
  graphDefinitionVersion: string
  segment: string | null
  progress: { current: string | null; completed: string[] }
  stopReasonCode: string | null
  qualityGate: 'PASS' | 'REJECT' | 'REVIEW' | null
  qualityReview: { status: 'OPEN' | 'CLAIMED' | 'SUBMITTED';
    decisionCode: 'APPROVE_CONTINUE' | 'REJECT_RESUBMIT' | null; reasonCode: string | null } | null
  finalReview?: { status: 'OPEN' | 'CLAIMED' | 'SUBMITTED';
    decisionCode: import('./reviewController').FinalDecision | null; reasonCode: string | null;
    audit?: import('./reviewController').ReviewAuditEntry[] } | null
  resultAvailability: { patientVisible: boolean; doctorReviewRequired: boolean }
  explanation?: { publicationStatus: 'NONE' | 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'REJECTED' | 'WITHHELD';
    snapshotId: string | null; revision: string | null; validationStatus: 'VALIDATED' | 'REJECTED' | null }
  result: PublishedExplanation | null
  evidence?: WorkflowEvidenceView | null
}

export interface PublishedExplanation {
  snapshotId: string
  revision: string
  modelAssessment: { diseaseCode: string; calibratedProbability: number; modelVersion: string;
    modelWeightFingerprint: string; inferencePolicyVersion: string; calibrationStatus: string }
  generalInformation: { claimId: string; type: string; text: string; citationIds: string[] }[]
  citations: (WorkflowEvidenceView['citations'][number] & { quotedText: string })[]
  riskNotice: string
  limitation: string
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

export async function getWorkflowSnapshot(workflowId: string, signal: AbortSignal) {
  // This endpoint deliberately ends each snapshot stream. Never interpret its
  // done event as clinical completion, and never retry a command POST here.
  const response = await request<string>(`/diagnosis/workflows/${encodeURIComponent(workflowId)}/events`,
    { method: 'GET', signal, responseType: 'text', timeout: 10000 })
  const frames = response.data.replace(/\r\n/g, '\n').split('\n\n')
  const state = frames.find(frame => frame.startsWith('event: state\ndata: '))
  if (!state || !frames.some(frame => frame.startsWith('event: done\n'))) throw new Error('任务状态连接已中断')
  const snapshot: WorkflowSnapshot = JSON.parse(state.slice('event: state\ndata: '.length))
  if (snapshot.workflow?.workflowId !== workflowId) throw new Error('任务状态响应不匹配')
  return snapshot
}
