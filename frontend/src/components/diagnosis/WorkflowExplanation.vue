<script setup lang="ts">
import type { PublishedExplanation } from '@/api/workflowController'

withDefaults(defineProps<{ explanation: PublishedExplanation; referencePrefix?: string }>(), { referencePrefix: 'reference' })
const diseases: Record<string, string> = {
  glaucoma: '青光眼', cataract: '白内障', amd: '年龄相关性黄斑变性',
  diabetic_retinopathy: '糖尿病视网膜病变', myopia: '近视', normal: '正常眼底类别',
}
const claimLabels: Record<string, string> = {
  GENERAL_DISEASE_INFORMATION: '一般疾病信息', GENERAL_RISK_CONTEXT: '一般风险信息',
  GENERAL_FOLLOW_UP_GUIDANCE: '一般随访信息',
}
</script>

<template>
  <section class="workflow-explanation" aria-label="已发布解释">
    <h4>模型评估</h4>
    <p>模型提示类别：{{ diseases[explanation.modelAssessment.diseaseCode] ?? explanation.modelAssessment.diseaseCode }}</p>
    <p>模型输出评分：{{ explanation.modelAssessment.calibratedProbability }}%（不等同于本人的患病概率）</p>
    <p v-if="explanation.modelAssessment.calibrationStatus !== 'CALIBRATED'">当前模型输出未经校准。</p>
    <details>
      <summary>模型与解释来源</summary>
      <p>模型版本：{{ explanation.modelAssessment.modelVersion }}</p>
      <p>权重校验标识：<code>{{ explanation.modelAssessment.modelWeightFingerprint }}</code></p>
      <p>解释版本：{{ explanation.revision }} · <code>{{ explanation.snapshotId }}</code></p>
    </details>
    <h4>一般参考信息</h4>
    <ul>
      <li v-for="claim in explanation.generalInformation" :key="claim.claimId">
        <span class="claim-label">{{ claimLabels[claim.type] }}</span>
        <p>{{ claim.text }}</p>
        <a v-for="id in claim.citationIds" :key="id" :href="`#${referencePrefix}-${id}`">参考片段：{{ id }}</a>
      </li>
    </ul>
    <h4>风险提示</h4>
    <p>{{ explanation.riskNotice }}</p>
    <p>{{ explanation.limitation }}</p>
    <h4>参考来源与片段</h4>
    <ul>
      <li v-for="citation in explanation.citations" :id="`${referencePrefix}-${citation.citationId}`" :key="citation.citationId">
        <strong>{{ citation.title }}</strong>
        <p>引用：<code>{{ citation.citationId }}</code> · 审核版本 {{ citation.sourceRevision }}</p>
        <p>来源：{{ citation.source }}</p>
        <details><summary>查看参考片段</summary><blockquote>{{ citation.quotedText }}</blockquote></details>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.workflow-explanation { border-top: 1px solid var(--claude-border-warm); margin-top: 1rem; line-height: 1.7; overflow-wrap: anywhere; }
h4 { margin: 1.25rem 0 .5rem; color: var(--claude-text-primary); }
p { margin: .5rem 0; }
ul { padding-left: 1.25rem; }
li { margin-bottom: 1rem; }
.claim-label { color: var(--claude-text-secondary); font-size: .85rem; }
a { display: block; color: var(--claude-accent, #c96442); }
summary { cursor: pointer; }
blockquote { margin: .75rem 0; border-left: 3px solid var(--claude-border-warm); padding-left: .75rem; white-space: pre-wrap; }
</style>
