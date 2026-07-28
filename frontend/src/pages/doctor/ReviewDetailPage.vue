<script setup lang="ts">
/**
 * 医生审核详情页 /doctor/reviews/:id
 *
 * AI 材料：GET /diagnosis/workflows/{workflowId}（医生角色由后端投影完整视图）。
 * 操作面板：完全由 allowedActions 驱动 —— 该数组来自 resolveAllowedActions
 * （逐字镜像后端动作矩阵），本页面与面板组件均不得自行增删按钮。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { getWorkflow, type WorkflowStatusView } from '@/api/workflow'
import {
  claimTask,
  resolveAllowedActions,
  REVIEW_TYPE_LABELS,
  submitDecision,
  type ReviewDecisionCode,
  type ReviewSubmissionVO,
  type ReviewType,
} from '@/api/review'
import WorkflowTimeline from '@/components/workflow/WorkflowTimeline.vue'
import EvidenceCard from '@/components/workflow/EvidenceCard.vue'
import ExplanationCard from '@/components/workflow/ExplanationCard.vue'
import ReviewActionPanel from '@/components/workflow/ReviewActionPanel.vue'

const route = useRoute()
const taskId = String(route.params.id ?? '')
const workflowId = String(route.query.workflowId ?? '')
const reason = String(route.query.reason ?? '') as ReviewType

const view = ref<WorkflowStatusView | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const claimed = ref(false)
const claiming = ref(false)
const submitting = ref(false)
const submission = ref<ReviewSubmissionVO | null>(null)

const outcomeType = computed(() => {
  const result = view.value?.result
  if (!result || typeof result !== 'object') return null
  const outcome = (result as Record<string, unknown>).inferenceOutcomeType
  return typeof outcome === 'string' ? outcome : null
})

/** 唯一动作来源：镜像后端动作矩阵，UI 不做任何附加判断 */
const allowedActions = computed<ReviewDecisionCode[]>(() =>
  resolveAllowedActions(reason, outcomeType.value),
)

const load = async () => {
  if (!workflowId) {
    loadError.value = '缺少工作流信息，请从任务列表进入'
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = null
  try {
    const res = await getWorkflow(workflowId)
    if (res.data.code === 0 && res.data.data) {
      view.value = res.data.data
    } else {
      loadError.value = res.data.msg || '无法加载工作流材料'
    }
  } catch {
    loadError.value = '网络异常，无法加载工作流材料'
  } finally {
    loading.value = false
  }
}

const doClaim = async () => {
  if (claiming.value) return
  claiming.value = true
  try {
    const res = await claimTask(taskId)
    if (res.data.code === 0) {
      claimed.value = true
      message.success('已认领该审核任务')
    } else {
      message.warning(res.data.msg || '认领失败')
    }
  } catch {
    message.error('认领请求失败，请稍后重试')
  } finally {
    claiming.value = false
  }
}

const doSubmit = async (payload: { decision: ReviewDecisionCode; comment: string }) => {
  if (submitting.value) return
  submitting.value = true
  try {
    const res = await submitDecision(taskId, {
      decision: payload.decision,
      comment: payload.comment || null,
    })
    if (res.data.code === 0 && res.data.data) {
      submission.value = res.data.data
      message.success('审核决定已提交，工作流将继续执行')
    } else {
      message.warning(res.data.msg || '提交失败')
    }
  } catch {
    message.error('提交请求失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="review-detail">
    <div class="review-detail__inner">
      <header class="review-detail__header">
        <div>
          <h2 class="review-detail__title">审核详情</h2>
          <p class="review-detail__meta">
            <span class="review-detail__reason" :data-reason="reason">
              {{ REVIEW_TYPE_LABELS[reason] ?? reason }}
            </span>
            <span class="review-detail__mono">任务 {{ taskId }}</span>
            <span class="review-detail__mono">工作流 {{ workflowId }}</span>
          </p>
        </div>
        <button
          v-if="!claimed && !submission"
          type="button"
          class="review-detail__claim"
          data-testid="claim-task"
          :disabled="claiming"
          @click="doClaim"
        >
          {{ claiming ? '认领中…' : '认领任务' }}
        </button>
      </header>

      <p v-if="loading" class="review-detail__hint">正在加载…</p>
      <p v-else-if="loadError" class="review-detail__error" data-testid="detail-error">{{ loadError }}</p>

      <template v-else-if="view">
        <!-- 提交成功回执 -->
        <div v-if="submission" class="review-detail__done" data-testid="submission-done">
          <h3>审核已完成</h3>
          <dl>
            <dt>任务</dt>
            <dd>{{ submission.taskId }}</dd>
            <dt>工作流版本</dt>
            <dd>{{ submission.committedWorkflowVersion }}</dd>
            <dt>恢复作业</dt>
            <dd>{{ submission.resumeJobId }}</dd>
          </dl>
          <RouterLink to="/doctor/reviews" class="review-detail__back">返回任务列表</RouterLink>
        </div>

        <template v-else>
          <WorkflowTimeline :status="view.status" :progress="view.progress" :events="null" />

          <EvidenceCard :view="view.result" />
          <ExplanationCard :view="view.result" />

          <div v-if="!claimed" class="review-detail__claim-hint" data-testid="claim-hint">
            认领任务后才能提交审核决定。
          </div>
          <ReviewActionPanel
            v-else
            :allowed-actions="allowedActions"
            :submitting="submitting"
            @submit="doSubmit"
          />
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.review-detail {
  max-width: 840px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}
.review-detail__inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.review-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.review-detail__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 24px;
  color: #141413;
  margin: 0 0 6px;
}
.review-detail__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0;
}
.review-detail__reason {
  font-size: 13px;
  color: #9a6700;
  background: rgba(212, 167, 44, 0.12);
  border-radius: 999px;
  padding: 2px 10px;
}
.review-detail__mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #8f8d86;
  word-break: break-all;
}
.review-detail__claim {
  background: #c96442;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 9px 20px;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
}
.review-detail__claim:hover:not(:disabled) {
  background: #b5502f;
}
.review-detail__claim:disabled {
  background: #d9d7cd;
  cursor: not-allowed;
}
.review-detail__hint {
  color: #8f8d86;
  font-size: 14px;
}
.review-detail__error {
  color: #b53333;
  font-size: 14px;
}
.review-detail__claim-hint {
  background: #f5f4ed;
  border: 1px dashed #ded9cb;
  border-radius: 10px;
  padding: 14px;
  font-size: 13px;
  color: #6b6a66;
  text-align: center;
}
.review-detail__done {
  background: rgba(63, 145, 96, 0.08);
  border: 1px solid rgba(63, 145, 96, 0.3);
  border-radius: 12px;
  padding: 24px;
}
.review-detail__done h3 {
  font-family: Georgia, serif;
  color: #2f7d4f;
  margin: 0 0 12px;
}
.review-detail__done dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 0 0 16px;
}
.review-detail__done dt {
  font-size: 13px;
  color: #6b6a66;
}
.review-detail__done dd {
  margin: 0;
  font-size: 13px;
  color: #141413;
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
.review-detail__back {
  color: #c96442;
  font-size: 14px;
  text-decoration: none;
}
</style>
