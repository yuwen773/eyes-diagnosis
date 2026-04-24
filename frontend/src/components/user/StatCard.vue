<template>
  <div class="ds-stat-card">
    <div class="ds-stat-value">{{ value }}</div>
    <div class="ds-stat-label">{{ label }}</div>
    <div v-if="trend" class="ds-stat-trend" :class="trendClass">
      {{ trendText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  value: string | number
  label: string
  trend?: number // 正数表示上升，负数表示下降
  prefix?: string
  suffix?: string
}

const props = withDefaults(defineProps<Props>(), {
  value: 0,
  label: '',
  trend: undefined,
  prefix: '',
  suffix: ''
})

const trendClass = computed(() => {
  if (!props.trend) return ''
  return props.trend > 0 ? 'trend-up' : 'trend-down'
})

const trendText = computed(() => {
  if (!props.trend) return ''
  const sign = props.trend > 0 ? '+' : ''
  return `${sign}${props.trend}%`
})
</script>

<style scoped>
.ds-stat-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: all var(--transition-normal);
}

.ds-stat-card:hover {
  box-shadow: var(--shadow-whisper);
  transform: translateY(-2px);
}

.ds-stat-value {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1;
}

.ds-stat-label {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  margin-top: var(--space-2);
}

.ds-stat-trend {
  font-size: var(--text-xs);
  margin-top: var(--space-2);
  font-weight: 500;
}

.trend-up {
  color: var(--color-success);
}

.trend-down {
  color: var(--color-error);
}
</style>
