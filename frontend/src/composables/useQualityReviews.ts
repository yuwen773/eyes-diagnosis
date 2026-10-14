import { onScopeDispose, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { claimQualityReview, getQualityReview, listQualityReviews, submitQualityReview,
  type ReviewDecision, type ReviewDetail, type ReviewSummary, type ReviewVersions } from '@/api/reviewController'
import { decisionReasons } from '@/components/review/decisions'

export function useQualityReviews() {
  const route = useRoute()
  const router = useRouter()
  const tasks = shallowRef<ReviewSummary[]>([])
  const detail = shallowRef<ReviewDetail | null>(null)
  const busy = shallowRef(false)
  const error = shallowRef('')
  let controller: AbortController | undefined
  let generation = 0
  let disposed = false

  async function refresh() {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const current = ++generation
    busy.value = true
    detail.value = null
    error.value = ''
    try {
      const [list, selected] = await Promise.all([listQualityReviews(signal),
        typeof route.query.task === 'string' ? getQualityReview(route.query.task, signal) : null])
      if (current !== generation || disposed) return
      tasks.value = list
      detail.value = selected
    } catch (cause) {
      if (current !== generation || disposed) return
      tasks.value = []
      error.value = failureMessage(cause)
    } finally {
      if (current === generation && !disposed) busy.value = false
    }
  }

  function failureMessage(cause: unknown) {
    const failure = cause as { response?: { data?: { msg?: string } } }
    return failure.response?.data?.msg ?? '复核操作结果暂未确认，请刷新查看服务端状态。'
  }

  async function select(id: string) {
    if (!busy.value) await router.replace({ query: { ...route.query, task: id } })
  }

  async function act(decision?: ReviewDecision) {
    if (!detail.value || busy.value) return
    const task = detail.value
    const current = generation
    busy.value = true
    error.value = ''
    const versions: ReviewVersions = { expectedTaskVersion: task.taskVersion, expectedWorkflowVersion: task.workflowVersion }
    if (task.reviewType === 'FINAL_CLINICAL_REVIEW') {
      versions.expectedExplanationSnapshotId = task.explanation?.snapshotId ?? null
      versions.expectedExplanationRevision = task.explanation?.revision ?? null
    }
    try {
      if (decision) await submitQualityReview(task.reviewTaskId, { ...versions, decisionCode: decision,
        reasonCode: decisionReasons[decision] })
      else await claimQualityReview(task.reviewTaskId, versions)
      if (!disposed && current === generation) await refresh()
    } catch (cause) {
      if (disposed || current !== generation) return
      detail.value = null
      error.value = failureMessage(cause)
    } finally {
      if (!disposed && current === generation) busy.value = false
    }
  }

  watch(() => route.query.task, () => { void refresh() }, { immediate: true })
  onScopeDispose(() => { disposed = true; generation++; controller?.abort() })
  return { tasks, detail, busy, error, select, refresh, act }
}
