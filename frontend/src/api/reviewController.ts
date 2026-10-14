import request from '@/request'
import { API_BASE_URL } from '@/config/env'

export type QualityDecision = 'APPROVE_CONTINUE' | 'REJECT_RESUBMIT'
export interface ReviewVersions { expectedTaskVersion: string; expectedWorkflowVersion: string }
export interface ReviewSummary {
  reviewTaskId: string
  workflowId: string
  reviewType: 'IMAGE_QUALITY_GATE'
  status: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
  taskVersion: string
  workflowVersion: string
  assignedDoctorId: string | null
  decisionCode: QualityDecision | null
  reasonCode: string | null
}
export interface ReviewDetail extends ReviewSummary {
  question: string
  supplementaryNotes?: string[]
  allowedDecisions: QualityDecision[]
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
}
export interface QualitySubmission extends ReviewVersions {
  decisionCode: QualityDecision
  reasonCode: 'QUALITY_APPROVED' | 'QUALITY_REJECTED'
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
