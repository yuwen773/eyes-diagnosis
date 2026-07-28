<script setup lang="ts">
/**
 * 诊断结果页 /diagnosis/:id/result
 *
 * 患者视图：只渲染 toPatientResult 白名单投影（diseaseCode + calibratedProbability），
 * 其余一律不展示；受限结果只给出通用说明，不透出任何模型内部信息。
 * 医生/管理员视图：渲染后端下发的完整审核材料（EvidenceCard / ExplanationCard）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getWorkflow, toPatientResult, type WorkflowStatusView } from '@/api/workflow'
import { useLoginUserStore } from '@/stores/user'
import WorkflowStatusBadge from '@/components/workflow/WorkflowStatusBadge.vue'
import EvidenceCard from '@/components/workflow/EvidenceCard.vue'
import ExplanationCard from '@/components/workflow/ExplanationCard.vue'

const route = useRoute()
const workflowId = String(route.params.id ?? '')
const loginUserStore = useLoginUserStore()

const view = ref<WorkflowStatusView | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const isReviewerRole = computed(() => {
  const role = loginUserStore.loginUser?.userRole
  return role === 'doctor' || role === 'admin'
})

/** 患者可见结果 —— 经白名单投影，永不透出其他字段 */
const patientResult = computed(() => toPatientResult(view.value?.result))

const probabilityText = computed(() => {
  const result = patientResult.value
  if (!result) return ''
  return `${(result.calibratedProbability * 100).toFixed(1)}%`
})

/** 展示态：结果 / 受限 / 处理中（仅决定文案卡片，不驱动任何业务行为） */
const displayMode = computed<'result' | 'limited' | 'pending'>(() => {
  if (patientResult.value) return 'result'
  const status = view.value?.status
  if (
    status === 'COMPLETED' ||
    status === 'COMPLETED_LIMITED' ||
    status === 'REJECTED' ||
    status === 'CANCELLED' ||
    status === 'FAILED'
  ) {
    return 'limited'
  }
  return 'pending'
})

const load = async () => {
  loading.value = true
  loadError.value = null
  try {
    const res = await getWorkflow(workflowId)
    if (res.data.code === 0 && res.data.data) {
      view.value = res.data.data
    } else {
      loadError.value = res.data.msg || '无法加载诊断结果'
    }
  } catch {
    loadError.value = '网络异常，无法加载诊断结果'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="wf-result">
    <div class="wf-result__inner">
      <header class="wf-result__header">
        <h2 class="wf-result__title">诊断结果</h2>
        <WorkflowStatusBadge v-if="view" :status="view.status" />
      </header>
      <p class="wf-result__id">{{ workflowId }}</p>

      <p v-if="loading" class="wf-result__hint">正在加载…</p>
      <p v-else-if="loadError" class="wf-result__error" data-testid="result-error">{{ loadError }}</p>

      <template v-else-if="view">
        <!-- 医生 / 管理员：完整审核材料 -->
        <div v-if="isReviewerRole" class="wf-result__doctor" data-testid="doctor-material">
          <EvidenceCard :view="view.result" />
          <ExplanationCard :view="view.result" />
        </div>

        <!-- 患者视图 -->
        <template v-else>
          <div v-if="displayMode === 'result'" class="wf-result__card" data-testid="patient-result">
            <dl class="wf-result__grid">
              <dt>疾病编码</dt>
              <dd data-testid="disease-code">{{ patientResult!.diseaseCode }}</dd>
              <dt>校准概率</dt>
              <dd data-testid="calibrated-probability">{{ probabilityText }}</dd>
            </dl>
            <p class="wf-result__explain">
              以上为 AI 多阶段分析后的辅助判断结果，已通过质量与证据校验。
              该结果仅供参考，不构成医疗诊断，请结合专业医生意见综合判断。
            </p>
          </div>

          <div v-else-if="displayMode === 'limited'" class="wf-result__limited" data-testid="limited-result">
            <h3>当前结果需要进一步人工确认</h3>
            <p>
              原因：证据不足 / 模型拒识。系统已按安全策略暂缓展示 AI 判断，
              相关材料将由专业医生复核，请留意后续通知。
            </p>
          </div>

          <div v-else class="wf-result__pending" data-testid="pending-result">
            <p>诊断流程仍在进行中，请稍后再来查看结果。</p>
            <RouterLink :to="`/diagnosis/${workflowId}`" class="wf-result__link">返回进度页</RouterLink>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wf-result {
  max-width: 840px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}
.wf-result__inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wf-result__header {
  display: flex;
  align-items: center;
  gap: 14px;
}
.wf-result__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 24px;
  color: #141413;
  margin: 0;
}
.wf-result__id {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: #8f8d86;
  margin: 0 0 8px;
  word-break: break-all;
}
.wf-result__hint {
  color: #8f8d86;
  font-size: 14px;
}
.wf-result__error {
  color: #b53333;
  font-size: 14px;
}
.wf-result__doctor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.wf-result__card {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  padding: 24px;
}
.wf-result__grid {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px 16px;
  margin: 0 0 16px;
}
.wf-result__grid dt {
  color: #6b6a66;
  font-size: 14px;
}
.wf-result__grid dd {
  margin: 0;
  font-size: 16px;
  color: #141413;
  font-weight: 600;
}
.wf-result__explain {
  font-size: 13px;
  color: #6b6a66;
  line-height: 1.7;
  margin: 0;
  border-top: 1px dashed #e3e1d7;
  padding-top: 12px;
}
.wf-result__limited {
  background: rgba(212, 167, 44, 0.08);
  border: 1px solid rgba(212, 167, 44, 0.3);
  border-radius: 12px;
  padding: 24px;
}
.wf-result__limited h3 {
  font-family: Georgia, serif;
  font-size: 17px;
  color: #8a5a00;
  margin: 0 0 8px;
}
.wf-result__limited p {
  font-size: 14px;
  color: #6b6a66;
  line-height: 1.7;
  margin: 0;
}
.wf-result__pending {
  background: #f5f4ed;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  font-size: 14px;
  color: #6b6a66;
}
.wf-result__link {
  color: #c96442;
  text-decoration: none;
}
</style>
