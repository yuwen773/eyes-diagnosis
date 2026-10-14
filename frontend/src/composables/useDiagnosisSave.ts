import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import type { WorkflowView } from '@/api/workflowController'
import { decideDiagnosisSave, getSaveConfirmation, requestDiagnosisSave, type SaveConfirmation } from '@/api/diagnosisSaveController'

export function useDiagnosisSave(workflow: Readonly<Ref<WorkflowView>>,
  serverConfirmation?: Readonly<Ref<SaveConfirmation | null | undefined>>) {
  const confirmation = shallowRef<SaveConfirmation | null>(null)
  const busy = shallowRef(false)
  const loaded = shallowRef(false)
  const error = shallowRef('')
  const canPrepare = computed(() => loaded.value && workflow.value.status === 'COMPLETED'
    && workflow.value.explanation?.publicationStatus === 'PUBLISHED'
    && workflow.value.explanation.validationStatus === 'VALIDATED'
    && workflow.value.resultAvailability.patientVisible && workflow.value.result !== null
    && confirmation.value?.status !== 'APPROVED')
  let generation = 0
  let disposed = false
  let controller: AbortController | undefined
  let requestKey: string | undefined

  async function refresh() {
    controller?.abort()
    controller = new AbortController()
    const current = ++generation
    busy.value = true
    error.value = ''
    try {
      const row = await getSaveConfirmation(workflow.value.workflowId, controller.signal)
      if (disposed || current !== generation) return
      confirmation.value = row
      loaded.value = true
    } catch {
      if (!disposed && current === generation) error.value = '保存状态暂不可用，请刷新保存状态后再操作。'
    } finally {
      if (!disposed && current === generation) busy.value = false
    }
  }

  async function act(decision?: 'approve' | 'reject') {
    if (busy.value || !loaded.value) return
    const current = generation
    busy.value = true
    error.value = ''
    try {
      let row: SaveConfirmation
      if (decision && confirmation.value) row = await decideDiagnosisSave(confirmation.value, decision)
      else {
        if (!canPrepare.value) return
        requestKey ??= crypto.randomUUID()
        row = await requestDiagnosisSave(workflow.value, requestKey)
      }
      if (disposed || current !== generation) return
      confirmation.value = row
      requestKey = undefined
    } catch (cause) {
      if (disposed || current !== generation) return
      const failure = cause as { response?: { data?: { msg?: string } } }
      error.value = failure.response?.data?.msg ?? '操作结果暂未确认，请刷新保存状态；重试不会重复保存。'
      // Keep the same frozen request for a retry; never report success optimistically.
    } finally {
      if (!disposed && current === generation) busy.value = false
    }
  }

  watch(() => workflow.value.workflowId, () => {
    confirmation.value = null
    loaded.value = false
    requestKey = undefined
    void refresh()
  }, { immediate: true })
  if (serverConfirmation) watch(serverConfirmation, row => {
    if (row !== undefined && !busy.value) {
      confirmation.value = row
      loaded.value = true
    }
  })
  onScopeDispose(() => { disposed = true; generation++; controller?.abort() })
  return { confirmation, busy, loaded, error, canPrepare, refresh, act }
}
