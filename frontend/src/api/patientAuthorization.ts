import type { PatientExplanation } from './patientExplanation'

export type PatientAuthorization = {
  taskId: string
  authorizationId: string
  status: 'OFFERED' | 'APPROVED' | 'RESTRICTED'
  taskVersion: string | number
  draftVersion: number
  evidenceVersion: number
  contentDigest: string
  expiresAt: string
  content: { explanation: PatientExplanation['result']; modelPrediction: string; modelProbability: number } | null
  receipt: { receiptId: string; taskId: string; diagnosisId: string; authorizedAt: string; contentDigest: string } | null
}
