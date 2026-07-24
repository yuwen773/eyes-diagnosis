<template>
  <div class="model-provenance">
    <span v-if="modelVersion" class="prov-row">
      <span class="prov-label">模型版本</span>
      <span class="prov-value">{{ modelVersion }}</span>
    </span>
    <span v-if="weightSha256" class="prov-row">
      <span class="prov-label">权重指纹</span>
      <span class="prov-value mono">{{ shortHash }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelVersion?: string
  weightSha256?: string
}>()

const shortHash = computed(() =>
  props.weightSha256 ? `${props.weightSha256.slice(0, 8)}…` : ''
)
</script>

<style scoped>
.model-provenance {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: #7a5642;
}
.prov-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.prov-label {
  color: #b08b75;
}
.prov-value {
  color: #5b3a2c;
}
.prov-value.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>