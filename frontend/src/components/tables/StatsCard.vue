<script lang="ts" setup>
import { computed } from 'vue';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons-vue';

interface Props {
  value: string | number;
  label: string;
  icon?: any;
  trend?: number; // 百分比，如 12.5 表示上涨 12.5%
  trendLabel?: string;
  precision?: number;
  prefix?: string;
  suffix?: string;
  color?: 'primary' | 'success' | 'warning' | 'error';
}

const props = withDefaults(defineProps<Props>(), {
  precision: 0,
  color: 'primary'
});

const isPositive = computed(() => (props.trend ?? 0) >= 0);
const trendColor = computed(() => isPositive.value ? 'var(--claude-success)' : 'var(--claude-error)');
</script>

<template>
  <a-card class="stat-card" :class="[`stat-card--${color}`]">
    <div class="stat-content">
      <div class="stat-main">
        <div class="stat-label">{{ label }}</div>
        <div class="stat-value-wrap">
          <span v-if="prefix" class="stat-prefix">{{ prefix }}</span>
          <span class="stat-value">{{ value }}</span>
          <span v-if="suffix" class="stat-suffix">{{ suffix }}</span>
        </div>
        
        <div v-if="trend !== undefined" class="stat-trend">
          <span class="trend-value" :style="{ color: trendColor }">
            <component :is="isPositive ? ArrowUpOutlined : ArrowDownOutlined" />
            {{ Math.abs(trend) }}%
          </span>
          <span class="trend-label">{{ trendLabel || '较上期' }}</span>
        </div>
      </div>
      
      <div v-if="icon" class="stat-icon-wrap">
        <component :is="icon" />
      </div>
    </div>
  </a-card>
</template>

<style scoped>
.stat-card {
  border-radius: var(--claude-radius-lg);
  box-shadow: var(--claude-shadow-sm);
  transition: all 0.3s ease;
  overflow: hidden;
  border: 1px solid var(--claude-border-subtle);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--claude-shadow-md);
}

.stat-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.stat-label {
  color: var(--claude-text-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.stat-value-wrap {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--claude-text-primary);
  line-height: 1.2;
}

.stat-prefix, .stat-suffix {
  font-size: 1rem;
  color: var(--claude-text-tertiary);
}

.stat-trend {
  margin-top: 0.75rem;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
}

.trend-value {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 2px;
}

.trend-label {
  color: var(--claude-text-tertiary);
}

.stat-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  background: oklch(from var(--claude-brand) l c h / 0.1);
  color: var(--claude-brand);
}

/* 变体颜色 */
.stat-card--success .stat-icon-wrap {
  background: oklch(from var(--claude-success) l c h / 0.1);
  color: var(--claude-success);
}

.stat-card--warning .stat-icon-wrap {
  background: oklch(from var(--claude-warning) l c h / 0.1);
  color: var(--claude-warning);
}

.stat-card--error .stat-icon-wrap {
  background: oklch(from var(--claude-error) l c h / 0.1);
  color: var(--claude-error);
}
</style>
