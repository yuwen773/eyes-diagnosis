import { onScopeDispose, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getLegacyTask, listLegacyTasks, type LegacyTask } from '@/api/legacyTaskController'

export function useLegacyTasks() {
  const route = useRoute()
  const records = shallowRef<LegacyTask[]>([])
  const selected = shallowRef<LegacyTask | null>(null)
  const total = shallowRef(0)
  const current = shallowRef(1)
  const loading = shallowRef(false)
  const error = shallowRef('')
  let controller: AbortController | undefined

  async function refresh() {
    controller?.abort()
    const active = new AbortController()
    controller = active
    loading.value = true
    error.value = ''
    // Never retain another task's detail across navigation or an auth failure.
    selected.value = null
    records.value = []
    try {
      const page = await listLegacyTasks(current.value, active.signal)
      const { source, task } = route.query
      const detail = typeof source === 'string' && typeof task === 'string'
        ? await getLegacyTask(source, task, active.signal) : null
      if (active.signal.aborted) return
      records.value = page.records
      total.value = page.total
      selected.value = detail
    } catch {
      if (!active.signal.aborted) error.value = '无法查看旧任务，请检查登录状态与任务归属后刷新。'
    } finally {
      if (!active.signal.aborted) loading.value = false
    }
  }

  watch(() => [route.query.source, route.query.task, current.value], () => void refresh(), { immediate: true })
  onScopeDispose(() => controller?.abort())
  return { records, selected, total, current, loading, error, refresh }
}
