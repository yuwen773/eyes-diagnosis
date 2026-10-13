<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { qualityReviewImageUrl, type QualityDecision, type ReviewDetail } from '@/api/reviewController'
const props = defineProps<{ task: ReviewDetail; busy: boolean }>()
const emit = defineEmits<{ claim: []; submit: [decision: QualityDecision] }>()
const decision = shallowRef<QualityDecision | ''>('')
const imageFailed = shallowRef(false)
watch(() => props.task.reviewTaskId, () => { decision.value = ''; imageFailed.value = false })
function submit() {
  if (decision.value && props.task.allowedDecisions.includes(decision.value)) emit('submit', decision.value)
}
</script>

<template>
  <section class="review-detail" aria-label="质量复核详情">
    <h2 class="review-heading">图像质量复核</h2>
    <p>本次说明：{{ task.question || '用户未填写说明' }}</p>
    <img v-if="!imageFailed" class="review-image" :src="qualityReviewImageUrl(task.reviewTaskId)" alt="待复核的眼底图片" @error="imageFailed = true" />
    <p v-else role="alert">图片暂时无法读取，请刷新后复核。</p>
    <dl class="review-facts">
      <dt class="fact-label">质量评分</dt><dd class="fact-value">{{ task.qualityScore }}</dd>
      <dt class="fact-label">质量问题</dt><dd class="fact-value">{{ task.qualityReasons.join('、') || '无' }}</dd>
      <dt class="fact-label">原推理包</dt><dd class="fact-value">{{ task.inferenceEnvelopeId }} · epoch {{ task.inferenceEpoch }}</dd>
      <dt class="fact-label">模型版本</dt><dd class="fact-value">{{ task.modelVersion }}</dd>
      <dt class="fact-label">推理策略</dt><dd class="fact-value">{{ task.inferencePolicyVersion }}</dd>
    </dl>
    <details class="source-details">
      <summary>查看来源与版本</summary>
      <p>权重指纹：{{ task.modelWeightFingerprint }}</p>
      <p>图片摘要：{{ task.inputDigest }}</p>
      <p>预处理：{{ task.preprocessVersion }} · 图版本：{{ task.graphDefinitionVersion }}</p>
      <p>任务版本 {{ task.taskVersion }} · 工作流版本 {{ task.workflowVersion }}</p>
    </details>
    <button v-if="task.status === 'OPEN'" class="review-action" type="button" data-action="claim" :disabled="busy || imageFailed" @click="emit('claim')">领取质量复核</button>
    <form v-else-if="task.status === 'CLAIMED'" @submit.prevent="submit">
      <fieldset class="decision-options" :disabled="busy || imageFailed">
        <legend>请选择质量决定</legend>
        <label class="decision-option"><input v-model="decision" type="radio" value="APPROVE_CONTINUE" name="quality-decision" /> 允许复用原推理包继续</label>
        <label class="decision-option"><input v-model="decision" type="radio" value="REJECT_RESUBMIT" name="quality-decision" /> 要求用户重新上传图片</label>
      </fieldset>
      <p>此决定只针对图片质量，不确认疾病预测。提交后不能覆盖。</p>
      <button class="review-action" type="submit" data-action="submit" :disabled="busy || !decision || imageFailed">提交质量决定</button>
    </form>
    <p v-else role="status">{{ task.decisionCode === 'APPROVE_CONTINUE' ? '已允许复用原推理包继续。' : '已要求用户重新上传图片。' }}质量决定已提交。</p>
  </section>
</template>

<style scoped>
.review-heading { font-size: 1.15rem; }
.review-detail { min-width: 0; line-height: 1.7; }
.review-image { display: block; max-width: 100%; max-height: 300px; border-radius: 12px; }
.review-facts { display: grid; grid-template-columns: auto 1fr; gap: .5rem 1rem; }
.fact-label { color: var(--claude-text-secondary); }
.fact-value { margin: 0; overflow-wrap: anywhere; }
.source-details { margin: 1rem 0; font-size: .85rem; overflow-wrap: anywhere; }
.decision-options { border: 1px solid var(--claude-border, #d9d0c6); border-radius: 10px; padding: 1rem; }
.decision-option { display: block; margin: .75rem 0; }
.review-action { border: 0; border-radius: 10px; padding: .75rem 1rem; background: var(--claude-accent, #c96442); color: white; font: inherit; cursor: pointer; }
.review-action:disabled { opacity: .55; cursor: default; }
</style>
