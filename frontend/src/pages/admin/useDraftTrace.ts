/**
 * 协作视图共用的真实轨迹读取：管理员身份守卫、任务切换的 epoch 竞态保护、
 * RUNNING 时每秒轮询。两个独立页面复用同一套口径，不各写一份解析。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { computed } from 'vue'
import { useLoginUserStore } from '@/stores/user'
import { listDraftTestTasks, draftTestTrace, type DraftTestTask, type DraftTestTrace } from '@/api/patientDraftTest'

export function useDraftTrace() {
  const users = useLoginUserStore()
  const isAdmin = computed(() => users.loginUser.userRole === 'admin')
  const tasks: Ref<DraftTestTask[]> = ref([])
  const selectedTaskId = ref('')
  const trace: Ref<DraftTestTrace | null> = ref(null)
  const error = ref('')
  let timer: number | undefined
  let epoch = 0

  const running = computed(() => trace.value?.status === 'RUNNING')

  function stopPolling() {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  async function loadTasks() {
    const current = epoch
    try {
      const result = await listDraftTestTasks()
      if (current === epoch && isAdmin.value) tasks.value = result
    } catch {
      if (current === epoch && isAdmin.value) error.value = '无法读取任务列表；请确认后端开启了试验台入口。'
    }
  }

  async function selectTask(taskId: string, current = ++epoch) {
    stopPolling()
    selectedTaskId.value = taskId
    trace.value = null
    error.value = ''
    try {
      const result = await draftTestTrace(taskId)
      if (current !== epoch) return
      trace.value = result
      if (result.status === 'RUNNING') poll(taskId, current)
    } catch {
      if (current === epoch) error.value = '无法读取该任务的运行轨迹。'
    }
  }

  function poll(taskId: string, current: number) {
    timer = window.setTimeout(async () => {
      try {
        const result = await draftTestTrace(taskId)
        if (current !== epoch) return
        trace.value = result
        if (result.status === 'RUNNING') poll(taskId, current)
        else stopPolling()
      } catch {
        if (current === epoch) {
          error.value = '轮询失败。'
          stopPolling()
        }
      }
    }, 1000)
  }

  watch(
    () => [users.loginUser.id, users.loginUser.userRole],
    () => {
      ++epoch
      stopPolling()
      tasks.value = []
      trace.value = null
      selectedTaskId.value = ''
      error.value = ''
      if (isAdmin.value) void loadTasks()
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    ++epoch
    stopPolling()
  })

  return { isAdmin, tasks, selectedTaskId, trace, error, running, loadTasks, selectTask }
}
