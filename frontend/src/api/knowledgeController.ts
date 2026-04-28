import { API_BASE_URL } from '../config/env'
import myAxios from '../request'

export interface KnowledgeDocument {
  id: number
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
