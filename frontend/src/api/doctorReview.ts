import request from '@/request'

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED'
export interface ReviewSummary { reviewId: string; taskId: string; status: ReviewStatus; assignedAt: string }
export interface ReviewDetail extends ReviewSummary {
  doctorId: string; assignedBy: string; taskVersion: string; draftVersion: number; evidenceVersion: number
  materialDigest: string; note: string; decidedBy?: string; decidedAt?: string
  materials: {
    inferenceDigest: string; inputDigest: string; diseaseCode: string
    draft: { claims: { id: string; section: string; text: string; references: { citationIndex: number; quote: string }[] }[] }
    evidence: { documentId: string; title: string; source: string; documentVersion: string; governanceVersion: string; excerpt: string }[]
    agentMessages: { sequence: number; role: string; state: string; output: {
      result?: { summary?: string; limitations?: string[]; reanalysisSuggestion?: string; action?: string; objections?: { target: string; reason: string }[] }
    } }[]
  }
}
export interface ReviewDecision {
  expectedTaskVersion: string; expectedDraftVersion: number; expectedEvidenceVersion: number
  expectedMaterialDigest: string; decision: 'APPROVED' | 'REJECTED'; note: string
}
function unwrap<T>(response: { data: { code: number; data: T; msg?: string } }): T {
  if (response.data.code !== 0) throw new Error(response.data.msg || '复核操作失败')
  return response.data.data
}
export const listReviews = async () => unwrap<ReviewSummary[]>(await request.get('/doctor-reviews'))
export const reviewDetail = async (id: string) => unwrap<ReviewDetail>(await request.get(`/doctor-reviews/${encodeURIComponent(id)}`))
export const assignReview = async (taskId: string, doctorId: string) => unwrap<ReviewSummary>(await request.post('/doctor-reviews/assign', { taskId, doctorId }))
export const decideReview = async (id: string, decision: ReviewDecision) => unwrap<ReviewDetail>(await request.post(`/doctor-reviews/${encodeURIComponent(id)}/decision`, decision))
