import request from '@/request'
import type { PublishedExplanation, WorkflowView } from './workflowController'

export interface SaveConfirmation {
  confirmationId: string
  workflowId: string
  operationType: 'SAVE_DIAGNOSIS'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED'
  idempotencyKey: string
  workflowVersion: string
  contentDigest: string
  expiresAt: string
  diagnosisId: string | null
  content: { imageUrl: string; imageDigest: string; result: string; calibratedProbability: number;
    severity: 'NOT_ASSESSED'; details: string; explanation: PublishedExplanation; finalReviewTaskId: string | null }
}

interface SaveResponse { code: number; msg: string; data: SaveConfirmation }
const base = (id: string) => `/diagnosis/workflows/${encodeURIComponent(id)}`

export async function getSaveConfirmation(workflowId: string, signal?: AbortSignal) {
  const response = await request<Omit<SaveResponse, 'data'> & { data: SaveConfirmation | null }>(
    `${base(workflowId)}/save-confirmation`, { signal })
  return response.data.data
}

export async function requestDiagnosisSave(workflow: WorkflowView, key: string) {
  const response = await request<SaveResponse>(`${base(workflow.workflowId)}/save-confirmation`, {
    method: 'POST', data: { idempotencyKey: key, expectedWorkflowVersion: workflow.workflowVersion,
      expectedExplanationSnapshotId: workflow.explanation?.snapshotId,
      expectedExplanationRevision: workflow.explanation?.revision },
  })
  return response.data.data
}

export async function decideDiagnosisSave(row: SaveConfirmation, decision: 'approve' | 'reject') {
  const response = await request<SaveResponse>(`${base(row.workflowId)}/save-confirmations/${encodeURIComponent(row.confirmationId)}/${decision}`, {
    method: 'POST', data: { idempotencyKey: row.idempotencyKey,
      expectedWorkflowVersion: row.workflowVersion, expectedContentDigest: row.contentDigest },
  })
  return response.data.data
}
