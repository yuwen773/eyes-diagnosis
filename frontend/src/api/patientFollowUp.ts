import type { PatientExplanation, PatientClaim } from './patientExplanation'

export type PatientFollowUp = {
  taskId: string
  status: 'RELATED_INFORMATION' | 'INSUFFICIENT_EVIDENCE' | 'RESTRICTED'
  message: string
  claims: PatientClaim[]
  sources: NonNullable<PatientExplanation['result']>['sources']
}
