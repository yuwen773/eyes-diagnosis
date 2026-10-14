import request from '@/request'

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
