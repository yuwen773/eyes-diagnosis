<script setup lang="ts">
/**
 * EvidenceCard —— 医生端 AI 证据材料卡片（仅医生/管理员页面使用）。
 * 展示后端 DoctorInferenceView 的推断摘要与证据快照，原样呈现，不做二次解读。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 后端 DoctorInferenceView（result 投影，字段均可能缺省） */
  view: Record<string, unknown> | null | undefined
}>()

const str = (key: string): string | null => {
  const value = props.view?.[key]
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

const OUTCOME_LABELS: Record<string, string> = {
  VALID_PREDICTION: '有效预测',
  SAFETY_ABSTENTION: '安全拒识',
  TECHNICAL_FAILURE: '技术失败',
}

const outcomeType = computed(() => str('inferenceOutcomeType'))
const outcomeLabel = computed(() => {
  const outcome = outcomeType.value
  return outcome ? (OUTCOME_LABELS[outcome] ?? outcome) : '—'
})

interface SnapshotRow {
  label: string
  value: string
}

const summaryRows = computed<SnapshotRow[]>(() => {
  const rows: Array<[string, string | null]> = [
    ['质量评估结论', str('qualityOutcome')],
    ['质量评分', str('qualityScore')],
    ['质量原因码', str('qualityReasonCodesSnapshot')],
    ['影像引用', str('imageObjectReference')],
    ['推断时间', str('inferredAt')],
  ]
  return rows
    .filter((row): row is [string, string] => row[1] !== null)
    .map(([label, value]) => ({ label, value }))
})

const evidenceRows = computed<SnapshotRow[]>(() => {
  const rows: Array<[string, string | null]> = [
    ['预测快照', str('predictionSnapshot')],
    ['置信度快照', str('confidenceSnapshot')],
  ]
  return rows
    .filter((row): row is [string, string] => row[1] !== null)
    .map(([label, value]) => ({ label, value }))
})
</script>

<template>
  <section class="evidence-card" data-testid="evidence-card">
    <header class="evidence-card__header">
      <h3 class="evidence-card__title">AI 推断摘要与证据</h3>
      <span class="evidence-card__outcome" :data-outcome="outcomeType ?? ''">{{ outcomeLabel }}</span>
    </header>

    <p v-if="!view" class="evidence-card__empty">暂无推断材料</p>

    <template v-else>
      <dl v-if="summaryRows.length > 0" class="evidence-card__grid">
        <template v-for="row in summaryRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>

      <div v-for="row in evidenceRows" :key="row.label" class="evidence-card__snapshot">
        <span class="evidence-card__snapshot-label">{{ row.label }}</span>
        <code class="evidence-card__snapshot-value">{{ row.value }}</code>
      </div>
    </template>
  </section>
</template>

<style scoped>
.evidence-card {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  padding: 20px 24px;
}
.evidence-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.evidence-card__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  color: #141413;
  margin: 0;
}
.evidence-card__outcome {
  font-size: 13px;
  color: #c96442;
  background: rgba(201, 100, 66, 0.08);
  border: 1px solid rgba(201, 100, 66, 0.25);
  border-radius: 999px;
  padding: 2px 10px;
}
.evidence-card__empty {
  font-size: 13px;
  color: #8f8d86;
  margin: 0;
}
.evidence-card__grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 16px;
  margin: 0 0 14px;
}
.evidence-card__grid dt {
  font-size: 13px;
  color: #6b6a66;
}
.evidence-card__grid dd {
  font-size: 13px;
  color: #141413;
  margin: 0;
  word-break: break-all;
}
.evidence-card__snapshot {
  margin-bottom: 10px;
}
.evidence-card__snapshot-label {
  display: block;
  font-size: 12px;
  color: #6b6a66;
  margin-bottom: 4px;
}
.evidence-card__snapshot-value {
  display: block;
  font-size: 12px;
  color: #33322f;
  background: #f0efe8;
  border-radius: 8px;
  padding: 8px 10px;
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
