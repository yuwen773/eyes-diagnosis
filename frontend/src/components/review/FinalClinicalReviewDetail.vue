<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { qualityReviewImageUrl, type ReviewDecision, type ReviewDetail } from '@/api/reviewController'
import { decisionLabels } from './decisions'
import ReviewAudit from './ReviewAudit.vue'

const props = defineProps<{ task: ReviewDetail; busy: boolean }>()
const emit = defineEmits<{ claim: []; submit: [decision: ReviewDecision] }>()
const decision = shallowRef<ReviewDecision | ''>('')
const imageFailed = shallowRef(false)
watch(() => props.task.reviewTaskId, () => { decision.value = ''; imageFailed.value = false })
const claims = computed<{ claimId: string; text: string }[]>(() => {
  const draft = props.task.explanation?.content?.draft
  if (!draft) return []
  try { return JSON.parse(draft).claims ?? [] } catch { return [] }
})
function submit() {
  if (decision.value && props.task.allowedDecisions.includes(decision.value)) emit('submit', decision.value)
}
</script>

<template>
  <section class="clinical-detail" aria-label="最终临床复核详情">
    <h2 class="clinical-heading">最终临床复核</h2>
    <p>本次说明：{{ task.question || '用户未填写说明' }}</p>
    <img v-if="!imageFailed" class="review-image" :src="qualityReviewImageUrl(task.reviewTaskId)" alt="待复核的眼底图片" @error="imageFailed = true" />
    <p v-else role="alert">图片暂时无法读取，请刷新后复核。</p>
    <dl class="clinical-facts">
      <dt class="fact-label">推理情形</dt><dd class="fact-value">{{ task.inferenceOutcome === 'SAFETY_ABSTENTION' ? '安全拒绝' : '有效预测' }}</dd>
      <dt class="fact-label">AI 来源评估</dt><dd class="fact-value">{{ task.modelAssessment ? `${task.modelAssessment.diseaseCode} · ${task.modelAssessment.calibratedProbability}%（模型评分）` : '安全拒绝，不提供疾病预测' }}</dd>
      <dt v-if="task.abstentionReason" class="fact-label">拒绝原因</dt><dd v-if="task.abstentionReason" class="fact-value">{{ task.abstentionReason }}</dd>
      <dt class="fact-label">原推理包</dt><dd class="fact-value">{{ task.inferenceEnvelopeId }} · epoch {{ task.inferenceEpoch }}</dd>
      <dt class="fact-label">解释版本</dt><dd class="fact-value">{{ task.explanation?.revision ?? '无解释快照' }} · {{ task.explanation?.publicationStatus }}</dd>
    </dl>
    <details class="source-details">
      <summary>查看推理来源与版本</summary>
      <p>模型版本：{{ task.modelVersion }} · 权重指纹：{{ task.modelWeightFingerprint }}</p>
      <p>图片摘要：{{ task.inputDigest }}</p>
      <p>预处理：{{ task.preprocessVersion }} · 推理策略：{{ task.inferencePolicyVersion }}</p>
      <p>图版本：{{ task.graphDefinitionVersion }} · 任务版本 {{ task.taskVersion }} · 工作流版本 {{ task.workflowVersion }}</p>
      <p>解释快照：{{ task.explanation?.snapshotId ?? '无' }}</p>
    </details>
    <section v-if="claims.length" aria-label="待复核解释">
      <h3 class="clinical-heading">复核解释 · {{ task.explanation?.publicationStatus === 'PUBLISHED' ? '已发布' : task.explanation?.publicationStatus === 'WITHHELD' ? '已扣留' : '尚需发布许可' }}</h3>
      <p v-for="claim in claims" :key="claim.claimId">{{ claim.text }}</p>
    </section>
    <section v-if="task.evidence" aria-label="复核证据">
      <h3 class="clinical-heading">参考证据</h3>
      <p>状态：{{ task.evidence.status }}。参考资料不证明患者级预测或治疗适用性。</p>
      <details v-for="citation in task.evidence.citations" :key="citation.citationId" class="source-details">
        <summary>{{ citation.title }} · 审核版本 {{ citation.sourceRevision }}</summary>
        <p>{{ citation.source }} · {{ citation.citationId }}</p>
        <blockquote class="reference-text">{{ citation.quotedText }}</blockquote>
      </details>
    </section>
    <button v-if="task.status === 'OPEN'" class="review-action" data-action="claim" type="button" :disabled="busy || imageFailed" @click="emit('claim')">领取最终临床复核</button>
    <form v-else-if="task.status === 'CLAIMED'" @submit.prevent="submit">
      <fieldset class="decision-options" :disabled="busy || imageFailed">
        <legend>请选择最终临床决定</legend>
        <label v-for="code in task.allowedDecisions" :key="code" class="decision-option">
          <input v-model="decision" type="radio" :value="code" name="clinical-decision" /> {{ decisionLabels[code] }}
        </label>
      </fieldset>
      <p>确认 AI 评估后仍需校验发布条件。纠正或无法判断将扣留解释；安全拒绝的复核保持受限结果。决定不会覆盖 AI 来源或自动保存正式诊断。</p>
      <button class="review-action" data-action="submit" type="submit" :disabled="busy || !decision || imageFailed">提交最终临床决定</button>
    </form>
    <p v-else role="status">已提交：{{ task.decisionCode ? decisionLabels[task.decisionCode] : '' }}。此决定不能覆盖，不代表患者已授权保存。</p>
    <ReviewAudit :entries="task.audit ?? []" />
  </section>
</template>

<style scoped>
.clinical-detail { min-width: 0; line-height: 1.7; overflow-wrap: anywhere; }
.clinical-heading { font-size: 1.15rem; }
.review-image { display: block; max-width: 100%; max-height: 300px; border-radius: 12px; }
.clinical-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .5rem 1rem; }
.fact-label { color: var(--claude-text-secondary); }
.fact-value { margin: 0; }
.source-details { margin: 1rem 0; font-size: .85rem; }
.reference-text { margin: .75rem 0; border-left: 3px solid var(--claude-border-warm); padding-left: .75rem; }
.decision-options { border: 1px solid var(--claude-border, #d9d0c6); border-radius: 10px; padding: 1rem; }
.decision-option { display: block; margin: .75rem 0; }
.review-action { border: 0; border-radius: 10px; padding: .75rem 1rem; background: var(--claude-accent, #c96442); color: white; font: inherit; cursor: pointer; }
.review-action:disabled { opacity: .55; cursor: default; }
</style>
