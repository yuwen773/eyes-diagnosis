import { onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import { decideTool, getToolConfirmations, type ToolConfirmation } from '@/api/toolConfirmationController'

export function useToolConfirmations(sessionId: Ref<string>, streaming: Ref<boolean>) {
  const rows = ref<ToolConfirmation[]>([])
  const busy = shallowRef(false)
  const error = shallowRef('')
  let generation = 0
  let reads = 0

  async function refresh() {
    const id = sessionId.value
    const current = ++generation
    if (!id) { rows.value = []; return }
    reads++
    try {
      const updated = await getToolConfirmations(id)
      if (current === generation) { rows.value = updated; error.value = '' }
    } catch (cause) {
      if (current === generation) {
        rows.value = []
        error.value = cause instanceof Error ? cause.message : '无法读取确认状态'
      }
    } finally {
      reads--
    }
  }

  async function decide(row: ToolConfirmation, action: 'approve' | 'reject') {
    if (busy.value || streaming.value) return
    const id = sessionId.value
    const current = generation
    busy.value = true
    error.value = ''
    try {
      const receipt = await decideTool(row, action)
      if (current === generation && id === sessionId.value) {
        rows.value = rows.value.map(item => item.confirmationId === receipt.confirmationId ? receipt : item)
      }
    } catch (cause) {
      if (current === generation && id === sessionId.value) {
        await refresh()
        error.value = cause instanceof Error ? cause.message : '确认失败，请刷新'
      }
    } finally {
      if (id === sessionId.value) busy.value = false
    }
  }

  watch(sessionId, () => { rows.value = []; busy.value = false; error.value = ''; void refresh() }, { immediate: true })
  watch(streaming, value => { if (!value) void refresh() })
  const timer = setInterval(() => { if (!reads && !busy.value && !streaming.value) void refresh() }, 1500)
  onUnmounted(() => { generation++; clearInterval(timer) })
  return { rows, busy, error, refresh, decide }
}
