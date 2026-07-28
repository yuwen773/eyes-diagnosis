<script setup lang="ts">
/**
 * Workflow 进度页 /diagnosis/:id
 *
 * 数据来源：GET /{id}、GET /{id}/events、SSE /stream。
 * SSE 帧仅驱动 UI（Timeline / Badge）刷新；流程是否结束以后端
 * `done` 事件为准，前端不自行推断终态、不实现状态机。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  cancelWorkflow,
  connectStream,
  getEvents,
  getWorkflow,
  type WorkflowEventView,
  type WorkflowStatusView,
  type WorkflowStreamHandle,
} from '@/api/workflow'
import WorkflowTimeline from '@/components/workflow/WorkflowTimeline.vue'
import AgentExecutionTimeline from '@/components/workflow/AgentExecutionTimeline.vue'

const route = useRoute()
const router = useRouter()
const workflowId = String(route.params.id ?? '')

const view = ref<WorkflowStatusView | null>(null)
const events = ref<WorkflowEventView[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
/** 后端已通过 SSE `done` 宣告流程结束 */
const streamDone = ref(false)
const cancelling = ref(false)

let stream: WorkflowStreamHandle | null = null
let lastEventRefreshStatus: string | null = null

const refreshEvents = async () => {
  try {
    const res = await getEvents(workflowId)
    if (res.data.code === 0 && res.data.data) {
      events.value = res.data.data
    }
  } catch {
    // 事件列表刷新失败不阻塞主视图
  }
}

const applyView = (next: WorkflowStatusView) => {
  view.value = next
  // 状态视图变化时同步刷新事件列表（仍是展示驱动，不解释状态含义）
  if (next.status !== lastEventRefreshStatus) {
    lastEventRefreshStatus = next.status
    void refreshEvents()
  }
}

const openStream = () => {
  stream = connectStream(workflowId, {
    onView: applyView,
    onDone: () => {
      streamDone.value = true
      void refreshEvents()
    },
    onError: () => {
      // 流中断（如 5 分钟超时）后静默降级为手动刷新
    },
  })
}

const load = async () => {
  loading.value = true
  loadError.value = null
  try {
    const res = await getWorkflow(workflowId)
    if (res.data.code === 0 && res.data.data) {
      applyView(res.data.data)
      await refreshEvents()
      openStream()
    } else {
      loadError.value = res.data.msg || '无法加载诊断工作流'
    }
  } catch {
    loadError.value = '网络异常，无法加载诊断工作流'
  } finally {
    loading.value = false
  }
}

const doCancel = async () => {
  if (cancelling.value) return
  cancelling.value = true
  try {
    const res = await cancelWorkflow(workflowId)
    if (res.data.code === 0) {
      message.success('已取消该诊断流程')
    } else {
      message.warning(res.data.msg || '取消失败')
    }
  } catch {
    message.error('取消请求失败，请稍后重试')
  } finally {
    cancelling.value = false
  }
}

const goResult = () => {
  router.push(`/diagnosis/${workflowId}/result`)
}

onMounted(load)
onUnmounted(() => {
  stream?.close()
})
</script>

<template>
  <div class="wf-detail">
    <div class="wf-detail__inner">
      <header class="wf-detail__header">
        <div>
          <h2 class="wf-detail__title">诊断进度</h2>
          <p class="wf-detail__id" data-testid="detail-workflow-id">{{ workflowId }}</p>
        </div>
        <div class="wf-detail__actions">
          <button
            v-if="!streamDone"
            type="button"
            class="wf-btn wf-btn--ghost"
            data-testid="cancel-workflow"
            :disabled="cancelling"
            @click="doCancel"
          >
            {{ cancelling ? '取消中…' : '取消诊断' }}
          </button>
          <button
            v-if="streamDone"
            type="button"
            class="wf-btn wf-btn--primary"
            data-testid="view-result"
            @click="goResult"
          >
            查看结果
          </button>
        </div>
      </header>

      <p v-if="loading" class="wf-detail__hint">正在加载…</p>
      <p v-else-if="loadError" class="wf-detail__error" data-testid="detail-error">{{ loadError }}</p>

      <template v-else-if="view">
        <WorkflowTimeline :status="view.status" :progress="view.progress" :events="events" />

        <AgentExecutionTimeline
          :status="view.status"
          :progress="view.progress"
          :events="events"
        />

        <p v-if="view.resultAvailability?.doctorReviewRequired" class="wf-detail__review-hint" data-testid="review-hint">
          当前结果正在等待医生复核，完成后将第一时间通知您。
        </p>
        <p v-if="streamDone" class="wf-detail__done-hint" data-testid="done-hint">
          流程已结束，可查看诊断结果。
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wf-detail {
  max-width: 840px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}
.wf-detail__inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.wf-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.wf-detail__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 24px;
  color: #141413;
  margin: 0 0 4px;
}
.wf-detail__id {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: #8f8d86;
  margin: 0;
  word-break: break-all;
}
.wf-detail__actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}
.wf-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.wf-btn--primary {
  background: #c96442;
  color: #fff;
}
.wf-btn--primary:hover {
  background: #b5502f;
}
.wf-btn--ghost {
  background: transparent;
  border: 1px solid #ded9cb;
  color: #6b6a66;
}
.wf-btn--ghost:hover:not(:disabled) {
  border-color: #b53333;
  color: #b53333;
}
.wf-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.wf-detail__hint {
  color: #8f8d86;
  font-size: 14px;
}
.wf-detail__error {
  color: #b53333;
  font-size: 14px;
}
.wf-detail__review-hint {
  background: rgba(212, 167, 44, 0.1);
  border: 1px solid rgba(212, 167, 44, 0.3);
  color: #8a5a00;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  margin: 0;
}
.wf-detail__done-hint {
  background: rgba(63, 145, 96, 0.1);
  border: 1px solid rgba(63, 145, 96, 0.3);
  color: #2f7d4f;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  margin: 0;
}
</style>
