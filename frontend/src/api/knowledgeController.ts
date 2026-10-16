import myAxios from '../request'

export interface KnowledgeDocument {
  id: string | number
  userId: number
  title: string
  fileName: string
  fileUrl: string
  fileSize: number
  fileType: string
  chunkCount: number
  status: number // 0=处理中, 1=已完成, 2=失败
  createTime: string
  updateTime: string
  visibility?: 'CURATED_PUBLIC' | 'PRIVATE_USER' | 'QUARANTINED'
  reviewStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
  diseaseCodes?: string[]
  topicCodes?: string[]
  governanceVersion?: number
}

export interface GovernanceInput {
  visibility: NonNullable<KnowledgeDocument['visibility']>
  reviewStatus: NonNullable<KnowledgeDocument['reviewStatus']>
  diseaseCodes: string[]
  topicCodes: string[]
  expectedVersion: number
  confirmed: true
}

export async function getEvidenceCatalog(): Promise<{ diseaseCodes: Record<string, string>; topicCodes: Record<string, string> }> {
  const response = await myAxios.get('/knowledge/admin/catalog')
  if (response.data.code !== 0) throw new Error(response.data.msg)
  return response.data.data
}

export async function updateKnowledgeGovernance(id: string | number, body: GovernanceInput) {
  const response = await myAxios.patch<BaseResponse<KnowledgeDocument>>(`/knowledge/admin/documents/${encodeURIComponent(id)}`, body)
  return response.data
}

export async function listReferenceDocuments(current: number, pageSize: number): Promise<BaseResponse<KnowledgePageResult>> {
  const response = await myAxios.post('/knowledge/admin/documents', { current, pageSize })
  return response.data
}

export interface KnowledgePageResult {
  records: KnowledgeDocument[]
  total: number
  size: number
  current: number
  pages: number
}

export interface BaseResponse<T> {
  code: number
  data: T
  msg: string
}

export const uploadDocument = (files: File[], title?: string): Promise<BaseResponse<number[]>> => {
  const formData = new FormData()
  files.forEach(file => formData.append('files', file))
  if (title) {
    formData.append('title', title)
  }
  return myAxios.post('/knowledge/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Parsing is sequential; allow the bounded Windows DOC conversion per file.
    timeout: files.length * 150000 + 30000,
  }).then((res: any) => res.data)
}

export const listKnowledgePage = (current: number, pageSize: number): Promise<BaseResponse<KnowledgePageResult>> => {
  return myAxios.post('/knowledge/list/page', {
    current,
    pageSize,
  }).then((res: any) => res.data)
}

export const deleteKnowledge = (id: number): Promise<BaseResponse<boolean>> => {
  return myAxios.delete('/knowledge/delete', {
    data: { id },
  }).then((res: any) => res.data)
}
