import request from '@/request'

export interface ControlledReference {
  id: string
  title: string
  source: string
  fileName: string
  documentVersion: string
  governanceVersion: number
  isTest: boolean
  visibility: 'PRIVATE_USER' | 'CURATED_PUBLIC'
  reviewStatus: 'PENDING' | 'APPROVED' | 'WITHDRAWN'
  diseaseCodes: string[]
  topicCodes: string[]
  enabled: boolean
  uploadedBy: number
  reviewedBy?: number
  reviewedAt?: string
  reviewNote: string
}

export interface ReferenceDetail {
  reference: ControlledReference
  chunks: { chunkIndex: number; excerpt: string; excerptDigest: string }[]
}

export interface Governance {
  expectedGovernanceVersion: number
  reviewStatus: ControlledReference['reviewStatus']
  visibility: ControlledReference['visibility']
  diseaseCodes: string[]
  topicCodes: string[]
  enabled: boolean
  domainReviewed: boolean
  note: string
}

interface Response<T> { code: number; data: T; msg: string }
function unwrap<T>(response: { data: Response<T> }): T {
  if (response.data.code !== 0) throw new Error(response.data.msg || '操作未完成，请刷新后重试')
  return response.data.data
}

export const listReferences = (page: number) => request.get<Response<{ records: ControlledReference[]; total: number }>>(
  '/controlled-references', { params: { page, pageSize: 20 } },
).then(unwrap)
export const referenceDetail = (id: string) => request.get<Response<ReferenceDetail>>(`/controlled-references/${id}`).then(unwrap)
export const downloadReference = (id: string) => request.get<Blob>(`/controlled-references/${id}/file`, { responseType: 'blob' }).then(response => response.data)
export const uploadReference = (data: FormData) => request.post<Response<ControlledReference>>('/controlled-references', data).then(unwrap)
export const governReference = (id: string, data: Governance) => request.post<Response<ControlledReference>>(
  `/controlled-references/${id}/governance`, data,
).then(unwrap)
export const deleteReference = (id: string, version: number) => request.delete<Response<boolean>>(
  `/controlled-references/${id}`, { params: { expectedGovernanceVersion: version } },
).then(unwrap)
