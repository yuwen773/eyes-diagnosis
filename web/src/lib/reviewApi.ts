import { CollaborationHttpError } from "./collaborationApi"

export type Claim = {
  id: string
  section: string
  text: string
  references: { citationIndex: number; quote: string }[]
}
export type Source = {
  citationIndex: number
  title: string
  source: string
  documentVersion: string
  governanceVersion: number | string
  excerpt: string
}
export type Explanation = {
  claims: Claim[]
  sources: Source[]
  disclaimer: string
  modelVersion: string
  calibrationNotice: string
}
export type PatientView = {
  taskId: string
  status: string
  message: string
  result: Explanation | null
}
export type Receipt = {
  receiptId: string
  taskId: string
  diagnosisId: number | string
  authorizedAt: string
  contentDigest: string
}
export type Authorization = {
  taskId: string
  authorizationId: string
  status: string
  taskVersion: number | string
  draftVersion: number
  evidenceVersion: number
  contentDigest: string
  expiresAt: string
  content: {
    explanation: Explanation
    modelPrediction: string
    modelProbability: number
  } | null
  receipt: Receipt | null
}
export type ReviewSummary = {
  reviewId: string
  taskId: string
  status: string
  assignedAt: string
}
export type ReviewDetail = ReviewSummary & {
  taskVersion: number | string
  draftVersion: number
  evidenceVersion: number
  materialDigest: string
  note: string | null
  materials: {
    draft: { claims: Claim[] }
    evidence: Source[]
    agentMessages: unknown[]
  }
}
const base = import.meta.env.VITE_API_BASE_URL ?? "/api"
export async function reviewRequest<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json()
  if (!response.ok || value?.code !== 0) {
    const status = [40100, 40101, 40400].includes(value?.code)
      ? 403
      : response.status
    throw new CollaborationHttpError(status, "REVIEW_UNAVAILABLE")
  }
  return value.data as T
}
export const reviewApi = {
  async reviewImage(review: string, signal: AbortSignal) {
    const response = await fetch(`${base}/doctor-reviews/${encodeURIComponent(review)}/image`, { credentials: "include", cache: "no-store", signal })
    if (!response.ok || !["image/png", "image/jpeg"].includes(response.headers.get("Content-Type") ?? "")) throw new CollaborationHttpError(response.status, "IMAGE_UNAVAILABLE")
    return response.blob()
  },
  patient: (task: string, signal: AbortSignal) =>
    reviewRequest<PatientView>(
      `/diagnosis-tasks/${encodeURIComponent(task)}/explanation`,
      signal
    ),
  source: (task: string, index: number, signal: AbortSignal) =>
    reviewRequest<Source>(
      `/diagnosis-tasks/${encodeURIComponent(task)}/citations/${index}`,
      signal
    ),
  offer: (task: string, signal: AbortSignal) =>
    reviewRequest<Authorization>(
      `/diagnosis-tasks/${encodeURIComponent(task)}/save-authorization`,
      signal
    ),
  save: (offer: Authorization, signal: AbortSignal) =>
    reviewRequest<Authorization>(
      `/diagnosis-tasks/${encodeURIComponent(offer.taskId)}/save-authorization/approve`,
      signal,
      {
        authorizationId: offer.authorizationId,
        expectedTaskVersion: offer.taskVersion,
        expectedDraftVersion: offer.draftVersion,
        expectedEvidenceVersion: offer.evidenceVersion,
        expectedContentDigest: offer.contentDigest,
      }
    ),
  list: (signal: AbortSignal) =>
    reviewRequest<ReviewSummary[]>("/doctor-reviews", signal),
  detail: (id: string, signal: AbortSignal) =>
    reviewRequest<ReviewDetail>(
      `/doctor-reviews/${encodeURIComponent(id)}`,
      signal
    ),
  assign: (taskId: string, doctorId: string, signal: AbortSignal) =>
    reviewRequest<ReviewSummary>("/doctor-reviews/assign", signal, {
      taskId,
      doctorId,
    }),
  decide: (
    detail: ReviewDetail,
    decision: "APPROVED" | "REJECTED",
    note: string,
    signal: AbortSignal
  ) =>
    reviewRequest<ReviewDetail>(
      `/doctor-reviews/${encodeURIComponent(detail.reviewId)}/decision`,
      signal,
      {
        expectedTaskVersion: detail.taskVersion,
        expectedDraftVersion: detail.draftVersion,
        expectedEvidenceVersion: detail.evidenceVersion,
        expectedMaterialDigest: detail.materialDigest,
        decision,
        note,
      }
    ),
  async image(run: string, signal: AbortSignal) {
    const response = await fetch(
      `${base}/agent/collaboration-runs/${encodeURIComponent(run)}/image`,
      { credentials: "include", cache: "no-store", signal }
    )
    if (
      !response.ok ||
      !["image/png", "image/jpeg"].includes(
        response.headers.get("Content-Type") ?? ""
      )
    )
      throw new CollaborationHttpError(response.status, "IMAGE_UNAVAILABLE")
    return response.blob()
  },
}

export const sectionLabels: Record<string, string> = {
  MAIN_FINDING: "主要信息",
  RISK: "风险提示",
  NEXT_STEP: "下一步",
  UNCERTAINTY: "不确定性",
  DETAIL: "依据详情",
  LIMITATION: "适用限制",
}
