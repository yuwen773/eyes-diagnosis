import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createUploadWorkflow, getUploadWorkflow, type WorkflowView } from '@/api/workflowController'

export function useUploadWorkflow() {
  const route = useRoute()
  const router = useRouter()
  const workflow = shallowRef<WorkflowView | null>(null)
  const submitting = shallowRef(false)
  const error = shallowRef('')
  const terminal = computed(() => workflow.value !== null &&
    ['COMPLETED', 'COMPLETED_LIMITED', 'REJECTED', 'CANCELLED', 'FAILED'].includes(workflow.value.status))
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let generation = 0
  let disposed = false

  function stopPolling() {
    generation++
    clearTimeout(timer)
    controller?.abort()
  }

  async function refresh() {
    stopPolling()
    const workflowId = route.query.workflow
    if (typeof workflowId !== 'string') return
    const current = generation
    controller = new AbortController()
    try {
      const value = await getUploadWorkflow(workflowId, controller.signal)
      if (current !== generation) return
      workflow.value = value
      error.value = ''
      if (!terminal.value) timer = setTimeout(refresh, 1500)
    } catch (cause) {
      if (current !== generation) return
      const failure = cause as { response?: { status: number; data?: { msg?: string } } }
      if ([401, 403, 404].includes(failure.response?.status ?? 0)) workflow.value = null
      error.value = failure.response?.data?.msg ?? '暂时无法查询任务，请点击刷新状态。'
    }
  }

  async function submit(file: File, idempotencyKey: string) {
    if (submitting.value) return
    submitting.value = true
    error.value = ''
    try {
      const value = await createUploadWorkflow(file, idempotencyKey)
      if (disposed) return
      workflow.value = value
      await router.replace({ query: { ...route.query, workflow: value.workflowId } })
    } catch (cause) {
      const failure = cause as { response?: { data?: { msg?: string } } }
      error.value = failure.response?.data?.msg ?? '提交结果暂未确认，请重试；重试将使用相同请求标识。'
    } finally {
      submitting.value = false
    }
  }

  watch(() => route.query.workflow, () => { workflow.value = null; void refresh() }, { immediate: true })
  onScopeDispose(() => { disposed = true; stopPolling() })
  return { workflow, submitting, error, terminal, submit, refresh }
}
