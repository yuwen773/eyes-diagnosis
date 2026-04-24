<template>
  <div class="ds-stat-card" :class="[`card-${colorIndex}`]">
    <div class="card-decoration"></div>
    <div class="card-content">
      <div class="stat-icon-wrapper">
        <slot name="icon"></slot>
      </div>
      <div class="stat-body">
        <div class="stat-value">
          <span class="prefix" v-if="prefix">{{ prefix }}</span>
          {{ value }}
          <span class="suffix" v-if="suffix">{{ suffix }}</span>
        </div>
        <div class="stat-label">{{ label }}</div>
      </div>
      <div v-if="trend !== undefined" class="stat-trend" :class="trendClass">
        <ArrowUpOutlined v-if="trend > 0" />
        <ArrowDownOutlined v-else-if="trend < 0" />
        <span class="trend-text">{{ trendText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons-vue'

interface Props {
  value: string | number
  label: string
  trend?: number
  prefix?: string
  suffix?: string
  colorIndex?: number
}

const props = withDefaults(defineProps<Props>(), {
  value: 0,
  label: '',
  trend: undefined,
  prefix: '',
  suffix: '',
  colorIndex: 0
})

const trendClass = computed(() => {
  if (props.trend === undefined || props.trend === 0) return ''
  return props.trend > 0 ? 'trend-up' : 'trend-down'
})

const trendText = computed(() => {
  if (props.trend === undefined || props.trend === 0) return ''
  const sign = props.trend > 0 ? '+' : ''
  return `${sign}${props.trend}%`
})
</script>

<style scoped>
.ds-stat-card {
  position: relative;
  overflow: hidden;
  border-radius: var(--claude-radius-lg);
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  transition: all var(--claude-transition-base);
  padding: var(--claude-space-5);
}

.ds-stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(20, 20, 19, 0.1);
  border-color: var(--claude-border-warm);
}

.card-decoration {
  position: absolute;
  bottom: -30px;
  right: -30px;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  opacity: 0.08;
  transition: all var(--claude-transition-slow);
}

.ds-stat-card:hover .card-decoration {
  transform: scale(1.2);
  opacity: 0.12;
}

.card-0 .card-decoration { background: var(--claude-brand); }
.card-1 .card-decoration { background: #faad14; }
.card-2 .card-decoration { background: #52c41a; }
.card-3 .card-decoration { background: #3898ec; }

.card-content {
  display: flex;
  align-items: center;
  gap: var(--claude-space-4);
  position: relative;
  z-index: 1;
}

.stat-icon-wrapper {
  font-size: 28px;
  padding: var(--claude-space-3);
  border-radius: var(--claude-radius-md);
  flex-shrink: 0;
}

.card-0 .stat-icon-wrapper {
  background: rgba(201, 100, 66, 0.1);
  color: var(--claude-brand);
}
.card-1 .stat-icon-wrapper {
  background: rgba(250, 173, 20, 0.1);
  color: #faad14;
}
.card-2 .stat-icon-wrapper {
  background: rgba(82, 196, 26, 0.1);
  color: #52c41a;
}
.card-3 .stat-icon-wrapper {
  background: rgba(56, 152, 236, 0.1);
  color: #3898ec;
}

.stat-body {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-family: var(--claude-font-serif);
  font-size: 28px;
  font-weight: 600;
  color: var(--claude-text-primary);
  line-height: 1.2;
}

.prefix,
.suffix {
  font-size: 16px;
  font-weight: 500;
}

.stat-label {
  font-size: 13px;
  color: var(--claude-text-tertiary);
  margin-top: 4px;
}

.stat-trend {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 20px;
}

.trend-up {
  color: var(--claude-success);
  background: rgba(82, 196, 26, 0.1);
}

.trend-down {
  color: var(--claude-error);
  background: rgba(181, 51, 51, 0.1);
}

.trend-text {
  margin-left: 2px;
}
</style>
