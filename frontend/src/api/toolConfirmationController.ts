import { API_BASE_URL } from '@/config/env'

export interface ToolConfirmation {
  confirmationId: string
  sessionId: string
  operationType: 'UPDATE_OWN_PROFILE'
  idempotencyKey: string
  contentDigest: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED'
  expiresAt: string
  content: {
    targetUserId: string
    before: { userProfile: string | null }
    after: { userProfile: string }
    source: { kind: string; name: string }
  }
}

async function result<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok || body.code !== 0) throw new Error(body.msg || '确认操作失败，请刷新状态')
  return body.data
}

export async function getToolConfirmations(sessionId: string): Promise<ToolConfirmation[]> {
  return result(await fetch(`${API_BASE_URL}/agent/tool-confirmations?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'include' }))
}

export async function decideTool(row: ToolConfirmation, action: 'approve' | 'reject'): Promise<ToolConfirmation> {
  return result(await fetch(`${API_BASE_URL}/agent/tool-confirmations/${encodeURIComponent(row.confirmationId)}/${action}`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: row.idempotencyKey, expectedContentDigest: row.contentDigest }),
  }))
}
