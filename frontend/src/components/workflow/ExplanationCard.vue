<script setup lang="ts">
/**
 * ExplanationCard —— 医生端解释与风险材料卡片（仅医生/管理员页面使用）。
 * 展示校准 / OOD / 安全性快照与模型溯源信息，原样呈现，不做二次解读。
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

interface Row {
  label: string
  value: string
}

const riskRows = computed<Row[]>(() => {
  const rows: Array<[string, string | null]> = [
    ['校准快照', str('calibrationSnapshot')],
    ['分布外检测快照', str('oodSnapshot')],
    ['安全拒识原因码', str('safetyAbstentionReasonCode')],
    ['技术失败码', str('technicalFailureCode')],
  ]
  return rows
    .filter((row): row is [string, string] => row[1] !== null)
    .map(([label, value]) => ({ label, value }))
})

const provenanceRows = computed<Row[]>(() => {
  const rows: Array<[string, string | null]> = [
    ['模型版本', str('modelVersion')],
    ['权重指纹', str('modelWeightFingerprint')],
    ['预处理版本', str('preprocessVersion')],
    ['推断策略版本', str('inferencePolicyVersion')],
  ]
  return rows
    .filter((row): row is [string, string] => row[1] !== null)
    .map(([label, value]) => ({ label, value }))
})
</script>

<template>
  <section class="explanation-card" data-testid="explanation-card">
    <h3 class="explanation-card__title">风险解释与模型溯源</h3>

    <p v-if="!view" class="explanation-card__empty">暂无解释材料</p>

    <template v-else>
      <div v-if="riskRows.length > 0" class="explanation-card__group">
        <h4 class="explanation-card__subtitle">风险评估快照</h4>
        <div v-for="row in riskRows" :key="row.label" class="explanation-card__snapshot">
          <span class="explanation-card__snapshot-label">{{ row.label }}</span>
          <code class="explanation-card__snapshot-value">{{ row.value }}</code>
        </div>
      </div>

      <div v-if="provenanceRows.length > 0" class="explanation-card__group">
        <h4 class="explanation-card__subtitle">模型溯源</h4>
        <dl class="explanation-card__grid">
          <template v-for="row in provenanceRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </div>

      <p v-if="riskRows.length === 0 && provenanceRows.length === 0" class="explanation-card__empty">
        暂无解释材料
      </p>
    </template>
  </section>
</template>

<style scoped>
.explanation-card {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  padding: 20px 24px;
}
.explanation-card__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  color: #141413;
  margin: 0 0 14px;
}
.explanation-card__subtitle {
  font-size: 13px;
  color: #6b6a66;
  margin: 0 0 8px;
  font-weight: 600;
}
.explanation-card__group {
  margin-bottom: 16px;
}
.explanation-card__group:last-child {
  margin-bottom: 0;
}
.explanation-card__empty {
  font-size: 13px;
  color: #8f8d86;
  margin: 0;
}
.explanation-card__snapshot {
  margin-bottom: 10px;
}
.explanation-card__snapshot-label {
  display: block;
  font-size: 12px;
  color: #6b6a66;
  margin-bottom: 4px;
}
.explanation-card__snapshot-value {
  display: block;
  font-size: 12px;
  color: #33322f;
  background: #f0efe8;
  border-radius: 8px;
  padding: 8px 10px;
  word-break: break-all;
  white-space: pre-wrap;
}
.explanation-card__grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 16px;
  margin: 0;
}
.explanation-card__grid dt {
  font-size: 13px;
  color: #6b6a66;
}
.explanation-card__grid dd {
  font-size: 13px;
  color: #141413;
  margin: 0;
  word-break: break-all;
}
</style>
