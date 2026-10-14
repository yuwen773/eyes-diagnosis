import { API_BASE_URL } from '@/config/env'

export interface SupplementRequest { workflowId: string; idempotencyKey: string }
export interface SupplementView {
  requestId: string
  sessionId: string
  workflowId: string
  status: 'WAITING' | 'ANSWERED'
  version: string
  items: { key: 'description'; prompt: string }[]
  answer: string | null
}

export async function replySupplement(wait: SupplementView, text: string): Promise<SupplementView> {
  const response = await fetch(`${API_BASE_URL}/agent/supplements/${encodeURIComponent(wait.requestId)}/reply`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: wait.sessionId, workflowId: wait.workflowId, expectedVersion: wait.version, text }),
  })
  const body = await response.json()
  if (!response.ok || body.code !== 0) throw new Error(body.msg || '补充说明提交失败，请刷新后重试')
  return body.data
}
