<script setup lang="ts">
import { computed } from 'vue'
import type { WorkflowView, WorkflowStatus, WorkflowSnapshot } from '@/api/workflowController'
import WorkflowEvidence from './WorkflowEvidence.vue'
import WorkflowExplanation from './WorkflowExplanation.vue'
import WorkflowSave from './WorkflowSave.vue'
import { decisionLabels } from '@/components/review/decisions'
import ReviewAudit from '@/components/review/ReviewAudit.vue'

const props = defineProps<{ workflow: WorkflowView; snapshot?: WorkflowSnapshot | null }>()
const labels: Record<WorkflowStatus, string> = {
  CREATED: '任务已创建', QUEUED: '等待处理', RUNNING: '正在处理',
  WAITING_HUMAN_REVIEW: '等待医生复核', COMPLETED: '处理完成',
  COMPLETED_LIMITED: '处理完成，结果受限', REJECTED: '请重新上传图片',
  CANCELLED: '任务已取消', FAILED: '处理未完成',
}
const reason = computed(() => ({
  DIAGNOSIS_NOT_AVAILABLE: '图片验证已完成，诊断能力尚未接入，当前任务不提供诊断结果。',
  MODEL_UNAVAILABLE: '模型当前不可用，未生成诊断结果。请联系管理员检查模型权重与配置。',
  MODEL_FINGERPRINT_MISMATCH: '模型来源校验失败，未生成诊断结果。请联系管理员。',
  INVALID_RESPONSE_CONTRACT: '算法返回的数据不符合要求，未生成诊断结果。请联系管理员。',
  INFERENCE_FAILED: '图像分析失败，重试后仍未生成诊断结果。请稍后重试或联系管理员。',
  INFERENCE_ENVELOPE_UNAVAILABLE: '已提交的分析结果暂时无法读取，请联系管理员。',
  QUALITY_REJECTED: '图片质量未通过，请重新上传清晰、光照均匀的眼底图片。',
  QUALITY_REVIEW_REQUIRED: '图片质量待复核。当前任务已暂停，不会自动重新分析，等待医生领取并作出质量决定。',
  EXPLANATION_NOT_AVAILABLE: '图片质量已通过，解释发布能力尚未接入，当前任务不提供诊断结果。',
  EVIDENCE_INSUFFICIENT: '已完成受控参考资料检索，证据不足，当前任务不提供完整解释。',
  EXPLANATION_CLAIMS_REJECTED: '解释声明未通过校验，本次不展示解释正文。建议咨询眼科医生。',
  EXPLANATION_MODEL_UNAVAILABLE: '解释生成暂不可用，本次不提供完整解释。请稍后重新发起任务。',
  EXPLANATION_SOURCE_CHANGED: '参考来源已撤回或发生变化，解释已扣留，本次不展示解释正文。',
  EXPLANATION_WITHHELD: '解释未满足发布条件，本次不展示解释正文。',
  SOURCE_CHANGED_DURING_PUBLICATION: '参考资料状态发生变化，正在重新检查发布条件。',
  FINAL_CLINICAL_REVIEW_REQUIRED: '本次分析需要医生最终临床复核，任务已暂停。复核完成前不展示解释，也不会自动保存正式诊断。',
  AI_ASSESSMENT_CORRECTED: '医生已纠正 AI 评估，原 AI 解释已扣留。请咨询眼科医生。',
  INCONCLUSIVE: '医生无法判断，本次仅提供受限结果。请咨询眼科医生。',
  ABSTENTION_CONFIRMED: '医生已确认安全拒绝，本次不提供疾病判断。',
  INDEPENDENT_REVIEW_PROVIDED: '医生已提供独立复核，本次保留受限结果，不发布 AI 疾病判断。',
  OOD: '图片超出模型适用范围，本次不提供疾病判断。建议咨询专业医生。',
  LOW_CONFIDENCE: '模型无法可靠判断，本次不提供疾病判断。建议咨询专业医生。',
  MODEL_POLICY_REJECTED: '本次分析未满足模型可靠性要求，不提供疾病判断。建议咨询专业医生。',
  INVALID_IMAGE: '文件无法读取为有效的 JPG、PNG 或 WebP 图片，请重新选择图片。',
  GRAPH_VERSION_INCOMPATIBLE: '任务与当前服务版本不兼容，请联系管理员。',
  CHECKPOINT_UNAVAILABLE: '任务恢复信息不可用，请联系管理员。',
  EXECUTION_FAILED: '任务执行失败，请稍后重试或联系管理员。',
  RETRY_EXHAUSTED: '任务多次执行未成功，请联系管理员。',
}[props.workflow.stopReasonCode ?? ''] ?? ''))
const published = computed(() => props.workflow.status === 'COMPLETED'
  && props.workflow.explanation?.publicationStatus === 'PUBLISHED'
  && props.workflow.explanation.validationStatus === 'VALIDATED'
  && props.workflow.resultAvailability.patientVisible && props.workflow.result !== null)
const qualityLabel = computed(() => props.workflow.qualityReview?.decisionCode ? '' : props.workflow.qualityGate ? ({
  PASS: '图片质量已通过', REJECT: '图片质量未通过', REVIEW: '图片质量待复核',
}[props.workflow.qualityGate]) : '')
</script>

<template>
  <section class="workflow-status" aria-live="polite" aria-label="任务状态">
    <h3 class="status-title">{{ labels[workflow.status] }}</h3>
    <p class="task-id">任务标识：<code>{{ workflow.workflowId }}</code></p>
    <p v-if="workflow.legacySource" class="status-reason">
      本任务为独立重建的 Python 工作流，旧批准不会转移。
      <RouterLink :to="{ path: '/diagnosis/legacy', query: { source: workflow.legacySource.sourceType, task: workflow.legacySource.taskId } }">查看旧任务 {{ workflow.legacySource.taskId }}</RouterLink>
    </p>
    <p v-if="snapshot?.supplements.some(wait => wait.status === 'WAITING')" role="status">等待您补充说明，请在原聊天中回复。此交互与医生复核分别进行。</p>
    <p v-if="qualityLabel" class="status-reason">{{ qualityLabel }}</p>
    <p v-if="workflow.qualityReview?.decisionCode" class="status-reason">
      {{ workflow.qualityReview.decisionCode === 'APPROVE_CONTINUE' ? '医生质量复核：已允许复用原推理包继续。' : '医生质量复核：请重新上传清晰、光照均匀的图片。' }}
      此决定不确认疾病预测，也不代表您已授权保存正式诊断。
    </p>
    <p v-else-if="workflow.qualityReview?.status === 'CLAIMED'" class="status-reason">医生已领取质量复核任务，请等待复核决定。</p>
    <p v-if="workflow.finalReview?.decisionCode" class="status-reason">
      医生最终临床复核：{{ decisionLabels[workflow.finalReview.decisionCode] }}。此决定不代表您已授权保存正式诊断。
    </p>
    <p v-else-if="workflow.finalReview?.status === 'CLAIMED'" class="status-reason">医生已领取最终临床复核任务，请等待复核决定。</p>
    <p v-if="reason" class="status-reason">{{ reason }}</p>
    <ReviewAudit :entries="workflow.finalReview?.audit ?? []" />
    <WorkflowExplanation v-if="published && workflow.result" :explanation="workflow.result" />
    <WorkflowEvidence v-else-if="workflow.evidence" :evidence="workflow.evidence" />
    <WorkflowSave v-if="['COMPLETED', 'COMPLETED_LIMITED', 'WAITING_HUMAN_REVIEW'].includes(workflow.status)" :key="workflow.workflowId" :workflow="workflow" :server-confirmation="snapshot?.saveConfirmation" />
    <p class="status-note">刷新页面后可继续查询本任务。<template v-if="['REJECTED', 'FAILED', 'CANCELLED'].includes(workflow.status)">正式诊断记录尚未保存。</template><template v-else>保存状态见正式诊断保存区。</template></p>
  </section>
</template>

<style scoped>
.workflow-status { margin-top: 1.5rem; padding: 1.25rem; border-radius: 12px; background: var(--claude-bg-card, #f7f2ec); }
.status-title { margin: 0 0 .75rem; color: var(--claude-text-primary); font-size: 1.1rem; }
.task-id { overflow-wrap: anywhere; font-size: .85rem; }
.status-reason { line-height: 1.7; }
.status-note { margin-bottom: 0; color: var(--claude-text-secondary); font-size: .85rem; }
</style>
