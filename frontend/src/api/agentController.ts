import { API_BASE_URL } from '../config/env'
import type { WorkflowView } from './workflowController'
import type { SupplementRequest, SupplementView } from './supplementController'

export type DiagnosisAction = { imageUrl: string; idempotencyKey: string } | { workflowId: string }

export interface AgentChatRequest {
  message: string
  threadId?: string
  imageUrls?: string[]
  enabledMcpServers?: string[]
  disableMcpDefault?: boolean
  diagnosis?: DiagnosisAction
  supplement?: SupplementRequest
}

export interface MessageVO {
  id: string
  role: string
  subType: string | null
  content: string
  isSummary: boolean
  createdTime: string
  imageUrls?: string[]
}

export interface ChatHistoryVO {
  supplements?: SupplementView[]
  workflows?: WorkflowView[]
  messages: MessageVO[]
  hasMore: boolean
  nextCursor: string | null
  executions?: { id: string; messageId: string; status: string; errorCode: string | null }[]
}

export interface SessionVO {
  sessionId: string
  title: string
  lastMessage: string
  messageCount: number
  summaryContent: string
  createdTime: string
  updatedTime: string
  isPinned?: boolean
}

export interface BaseResponse<T> {
  code: number
  data: T
  msg: string
}

const BASE_URL = API_BASE_URL

export const chatStream = (request: AgentChatRequest) => {
  return fetch(`${BASE_URL}/agent/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    credentials: 'include',
  })
}

export const getChatHistory = (threadId: string, beforeId?: string, limit = 40): Promise<BaseResponse<ChatHistoryVO>> => {
  let url = `${BASE_URL}/agent/history/${threadId}?limit=${limit}`
  if (beforeId) {
    url += `&beforeId=${beforeId}`
  }
  return fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  }).then(res => res.json())
}

export const updatePinStatus = (sessionId: string, pinned: boolean): Promise<BaseResponse<boolean>> => {
  return fetch(`${BASE_URL}/agent/sessions/${sessionId}/pin`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pinned }),
    credentials: 'include',
  }).then(res => res.json())
}

export const deleteSession = (sessionId: string): Promise<BaseResponse<boolean>> => {
  return fetch(`${BASE_URL}/agent/sessions/${sessionId}`, {
    method: 'DELETE',
    credentials: 'include',
  }).then(res => res.json())
}

export const batchDeleteSessions = (sessionIds: string[]): Promise<BaseResponse<number>> => {
  return fetch(`${BASE_URL}/agent/sessions/batch`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds }),
    credentials: 'include',
  }).then(res => res.json())
}

export const getSessions = (beforeId?: number, limit = 20): Promise<BaseResponse<SessionVO[]>> => {
  let url = `${BASE_URL}/agent/sessions?limit=${limit}`
  if (beforeId) {
    url += `&beforeId=${beforeId}`
  }
  return fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  }).then(res => res.json())
}

export const generateTitle = (sessionId: string, firstMessage: string): Promise<BaseResponse<boolean>> => {
  return fetch(`${BASE_URL}/agent/sessions/${sessionId}/generate-title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstMessage }),
    credentials: 'include',
  }).then(res => res.json())
}

export const updateSessionTitle = (sessionId: string, title: string): Promise<BaseResponse<boolean>> => {
  return fetch(`${BASE_URL}/agent/sessions/${sessionId}/title`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
    credentials: 'include',
  }).then(res => res.json())
}

export const exportSession = (
  sessionId: string,
  format: 'markdown' | 'json'
): Promise<BaseResponse<string>> => {
  return fetch(`${BASE_URL}/agent/history/${sessionId}/export?format=${format}`, {
    method: 'GET',
    credentials: 'include',
  }).then(res => res.json())
}

// ============ 图片上传相关 ============

/**
 * 上传 Agent 聊天图片，返回公开 URL
 * POST /api/agent/image/upload
 */
export async function uploadAgentImage(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/agent/image/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })
  const json = await res.json()
  if (json.code !== 0) {
    throw new Error(json.msg || '图片上传失败')
  }
  return json.data as string
}

/**
 * 删除已上传的 Agent 聊天图片
 * POST /api/agent/image/upload/delete
 */
export async function deleteAgentImage(url: string): Promise<void> {
  await fetch(`${BASE_URL}/agent/image/upload/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    credentials: 'include',
  })
}
