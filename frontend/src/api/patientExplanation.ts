export type PatientClaim = {
  id: string
  section: string
  text: string
  references: { citationIndex: number; quote: string }[]
}

export type PatientExplanation = {
  taskId: string
  status: 'PROCESSING' | 'WAITING_REVIEW' | 'RESTRICTED' | 'AVAILABLE'
  stage: string
  message: string
  workNotes: string[]
  result: {
    claims: PatientClaim[]
    sources: { citationIndex: number; title: string; source: string; documentVersion: string; governanceVersion: string | number; excerpt: string }[]
    disclaimer: string
    modelVersion: string
    preprocessVersion: string
    calibrationNotice: string
  } | null
}
