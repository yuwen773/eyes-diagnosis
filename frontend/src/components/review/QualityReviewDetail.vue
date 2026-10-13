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
  <section aria-label="质量复核详情">
    <h2>图像质量复核</h2>
    <p>本次说明：{{ task.question || '用户未填写说明' }}</p>
    <img v-if="!imageFailed" :src="qualityReviewImageUrl(task.reviewTaskId)" alt="待复核的眼底图片" @error="imageFailed = true" />
    <p v-else role="alert">图片暂时无法读取，请刷新后复核。</p>
    <dl>
      <dt>质量评分</dt><dd>{{ task.qualityScore }}</dd>
      <dt>质量问题</dt><dd>{{ task.qualityReasons.join('、') || '无' }}</dd>
      <dt>原推理包</dt><dd>{{ task.inferenceEnvelopeId }} · epoch {{ task.inferenceEpoch }}</dd>
      <dt>模型版本</dt><dd>{{ task.modelVersion }}</dd>
      <dt>推理策略</dt><dd>{{ task.inferencePolicyVersion }}</dd>
    </dl>
    <details>
      <summary>查看来源与版本</summary>
      <p>权重指纹：{{ task.modelWeightFingerprint }}</p>
      <p>图片摘要：{{ task.inputDigest }}</p>
      <p>预处理：{{ task.preprocessVersion }} · 图版本：{{ task.graphDefinitionVersion }}</p>
      <p>任务版本 {{ task.taskVersion }} · 工作流版本 {{ task.workflowVersion }}</p>
    </details>
    <button v-if="task.status === 'OPEN'" type="button" data-action="claim" :disabled="busy || imageFailed" @click="emit('claim')">领取质量复核</button>
    <form v-else-if="task.status === 'CLAIMED'" @submit.prevent="submit">
      <fieldset :disabled="busy || imageFailed">
        <legend>请选择质量决定</legend>
        <label><input v-model="decision" type="radio" value="APPROVE_CONTINUE" name="quality-decision" /> 允许复用原推理包继续</label>
        <label><input v-model="decision" type="radio" value="REJECT_RESUBMIT" name="quality-decision" /> 要求用户重新上传图片</label>
      </fieldset>
      <p>此决定只针对图片质量，不确认疾病预测。提交后不能覆盖。</p>
      <button type="submit" data-action="submit" :disabled="busy || !decision || imageFailed">提交质量决定</button>
    </form>
    <p v-else role="status">{{ task.decisionCode === 'APPROVE_CONTINUE' ? '已允许复用原推理包继续。' : '已要求用户重新上传图片。' }}质量决定已提交。</p>
  </section>
</template>

<style scoped>
h2 { font-size: 1.15rem; }
section { min-width: 0; line-height: 1.7; }
img { display: block; max-width: 100%; max-height: 300px; border-radius: 12px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: .5rem 1rem; }
dt { color: var(--claude-text-secondary); }
dd { margin: 0; overflow-wrap: anywhere; }
details { margin: 1rem 0; font-size: .85rem; overflow-wrap: anywhere; }
fieldset { border: 1px solid var(--claude-border, #d9d0c6); border-radius: 10px; padding: 1rem; }
label { display: block; margin: .75rem 0; }
button { border: 0; border-radius: 10px; padding: .75rem 1rem; background: var(--claude-accent, #c96442); color: white; font: inherit; cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
</style>
