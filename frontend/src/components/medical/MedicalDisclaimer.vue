<template>
  <section class="medical-disclaimer" role="alert">
    <h3>医疗免责声明</h3>
    <p v-if="scope === 'ai'">
      本页所有诊断结论由 AI 辅助分析，仅供参考，不能替代专业医生的诊断、治疗或处方。任何就医、检查、用药决策均须由具备资质的医生做出。
    </p>
    <p v-else>
      本报告包含人工复核结论，但仍需结合临床检查、实验室与其他影像学证据综合判断。
    </p>
    <dl v-if="modelVersion" class="provenance">
      <dt>模型版本</dt><dd>{{ modelVersion }}</dd>
      <dt v-if="weightSha256">权重指纹</dt><dd v-if="weightSha256">{{ shortHash }}</dd>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  scope: 'ai' | 'review'
  modelVersion?: string
  weightSha256?: string
}>()

const shortHash = computed(() =>
  props.weightSha256 ? `${props.weightSha256.slice(0, 8)}…` : ''
)
</script>

<style scoped>
.medical-disclaimer {
  border: 1px solid var(--iris-line);
  border-top: 3px solid var(--iris-accent);
  background: var(--iris-surface-2);
  padding: 12px 16px;
  margin: 12px 0;
  border-radius: 6px;
  color: var(--iris-ink-2);
}
.medical-disclaimer h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--iris-ink);
}
.provenance {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--iris-ink-3);
}
.provenance dt {
  font-weight: 500;
}
.provenance dd {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>