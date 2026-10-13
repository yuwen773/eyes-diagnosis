import { shallowRef } from 'vue'
import { useLoginUserStore } from '@/stores/user'

interface PendingDiagnosis {
  threadId: string
  message: string
  imageUrl: string
  idempotencyKey: string
}

export function useChatDiagnosis() {
  const key = `agent_pending_diagnosis:${useLoginUserStore().loginUser.id ?? 'anonymous'}`
  // This is an unacknowledged request, never a cached workflow/result.
  const pending = shallowRef<PendingDiagnosis | null>(null)
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (saved && ['threadId', 'message', 'imageUrl', 'idempotencyKey'].every(key => typeof saved[key] === 'string')) {
      pending.value = saved
    }
  } catch { /* An invalid draft cannot authorize or restore a task. */ }

  function prepare(threadId: string, message: string, imageUrl: string) {
    pending.value = { threadId, message, imageUrl, idempotencyKey: crypto.randomUUID() }
    sessionStorage.setItem(key, JSON.stringify(pending.value))
  }

  function clear() {
    pending.value = null
    sessionStorage.removeItem(key)
  }

  return { pending, prepare, clear }
}
