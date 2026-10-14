import request from '@/request'
import { API_BASE_URL } from '@/config/env'

export type QualityDecision = 'APPROVE_CONTINUE' | 'REJECT_RESUBMIT'
export type FinalDecision = 'CONFIRM_AI_ASSESSMENT' | 'CORRECT_AI_ASSESSMENT' | 'INCONCLUSIVE'
  | 'CONFIRM_ABSTENTION' | 'PROVIDE_INDEPENDENT_REVIEW'
export type ReviewDecision = QualityDecision | FinalDecision
export interface ReviewAuditEntry { eventId: string; eventType: string; actorType: string;
  workflowVersion: string; reasonCode: string | null; occurredAt: string }
export interface ReviewVersions { expectedTaskVersion: string; expectedWorkflowVersion: string;
  expectedExplanationSnapshotId?: string | null; expectedExplanationRevision?: string | null }
export interface ReviewSummary {
  reviewTaskId: string
  workflowId: string
  reviewType: 'IMAGE_QUALITY_GATE' | 'FINAL_CLINICAL_REVIEW'
  status: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
  taskVersion: string
  workflowVersion: string
  assignedDoctorId: string | null
  decisionCode: ReviewDecision | null
  reasonCode: string | null
}
export interface ReviewDetail extends ReviewSummary {
  question: string
  supplementaryNotes?: string[]
  allowedDecisions: ReviewDecision[]
  inferenceEnvelopeId: string
  inferenceEpoch: string
  inputDigest: string
  qualityOutcome: string
  qualityScore: number
  qualityReasons: string[]
  modelVersion: string
  modelWeightFingerprint: string
  preprocessVersion: string
  inferencePolicyVersion: string
  graphDefinitionVersion: string
  inferenceOutcome?: 'VALID_PREDICTION' | 'SAFETY_ABSTENTION' | 'TECHNICAL_FAILURE'
  abstentionReason?: string | null
  modelAssessment?: { diseaseCode: string; calibratedProbability: number } | null
  evidence?: { status: string; reasonCode: string | null; citations: {
    citationId: string; title: string; source: string; sourceRevision: number; quotedText: string }[] } | null
  explanation?: { snapshotId: string | null; revision: string | null; publicationStatus: string;
    content: { draft: string } | null }
  audit?: ReviewAuditEntry[]
}
export interface QualitySubmission extends ReviewVersions {
  decisionCode: ReviewDecision
  reasonCode: string
}
interface Response<T> { code: number; msg: string; data: T }
const taskUrl = (id: string) => `/reviews/tasks/${encodeURIComponent(id)}`
export const qualityReviewImageUrl = (id: string) => `${API_BASE_URL}${taskUrl(id)}/image`

export async function listQualityReviews(signal?: AbortSignal) {
  return (await request<Response<ReviewSummary[]>>('/reviews/tasks', { signal })).data.data
}
export async function getQualityReview(id: string, signal?: AbortSignal) {
  return (await request<Response<ReviewDetail>>(taskUrl(id), { signal })).data.data
}
export async function claimQualityReview(id: string, data: ReviewVersions) {
  return (await request<Response<ReviewSummary>>(`${taskUrl(id)}/claim`, { method: 'POST', data })).data.data
}
export async function submitQualityReview(id: string, data: QualitySubmission) {
  return (await request<Response<ReviewSummary>>(`${taskUrl(id)}/submit`, { method: 'POST', data })).data.data
}
