import { API_BASE_URL } from '../config/env'

export interface AgentChatRequest {
  message: string
  threadId?: string
  imageUrls?: string[]
  enabledMcpServers?: string[]
  disableMcpDefault?: boolean
}

export interface MessageVO {
  id: number
  role: string
  subType: string
  content: string
  isSummary: boolean
  createdTime: string
}

export interface ChatHistoryVO {
  messages: MessageVO[]
  hasMore: boolean
  nextCursor: number | null
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
  const threadId = request.threadId || ''
  return fetch(`${BASE_URL}/agent/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    credentials: 'include',
  })
}

export const getChatHistory = (threadId: string, beforeId?: number, limit = 40): Promise<BaseResponse<ChatHistoryVO>> => {
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
