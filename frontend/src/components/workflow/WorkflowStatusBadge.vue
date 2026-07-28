<script setup lang="ts">
/**
 * WorkflowStatusBadge —— 纯展示组件。
 * 只渲染后端 WorkflowStatus 枚举的 9 个真实状态；
 * 未知状态原样展示（表明契约漂移），禁止在前端发明
 * ANALYZING / CHECKING / GENERATING 等伪状态。
 */
import { computed } from 'vue'

const props = defineProps<{
  status: string | null | undefined
}>()

interface BadgeStyle {
  label: string
  tone: 'neutral' | 'processing' | 'warning' | 'success' | 'limited' | 'danger'
}

/** 展示映射：键集合 === 后端 WorkflowStatus 枚举全集 */
const STATUS_DISPLAY: Record<string, BadgeStyle> = {
  CREATED: { label: '已创建', tone: 'neutral' },
  QUEUED: { label: '排队中', tone: 'neutral' },
  RUNNING: { label: '分析进行中', tone: 'processing' },
  WAITING_HUMAN_REVIEW: { label: '等待医生复核', tone: 'warning' },
  COMPLETED: { label: '已完成', tone: 'success' },
  COMPLETED_LIMITED: { label: '完成（有限结果）', tone: 'limited' },
  REJECTED: { label: '未通过', tone: 'danger' },
  CANCELLED: { label: '已取消', tone: 'neutral' },
  FAILED: { label: '处理失败', tone: 'danger' },
}

const display = computed<BadgeStyle>(() => {
  const status = props.status ?? ''
  return STATUS_DISPLAY[status] ?? { label: status || '未知状态', tone: 'neutral' }
})
</script>

<template>
  <span class="wf-badge" :class="`wf-badge--${display.tone}`" :data-status="props.status ?? ''">
    <span class="wf-badge__dot" aria-hidden="true"></span>
    <span class="wf-badge__label">{{ display.label }}</span>
  </span>
</template>

<style scoped>
.wf-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 20px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.wf-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.wf-badge--neutral {
  color: #6b6a66;
  background: #f0efe8;
  border-color: #e3e1d7;
}
.wf-badge--processing {
  color: #c96442;
  background: rgba(201, 100, 66, 0.1);
  border-color: rgba(201, 100, 66, 0.3);
}
.wf-badge--processing .wf-badge__dot {
  animation: wf-badge-pulse 1.2s ease-in-out infinite;
}
.wf-badge--warning {
  color: #9a6700;
  background: rgba(212, 167, 44, 0.12);
  border-color: rgba(212, 167, 44, 0.35);
}
.wf-badge--success {
  color: #2f7d4f;
  background: rgba(63, 145, 96, 0.12);
  border-color: rgba(63, 145, 96, 0.3);
}
.wf-badge--limited {
  color: #8a5a00;
  background: rgba(217, 149, 32, 0.12);
  border-color: rgba(217, 149, 32, 0.35);
}
.wf-badge--danger {
  color: #b53333;
  background: rgba(181, 51, 51, 0.1);
  border-color: rgba(181, 51, 51, 0.3);
}
@keyframes wf-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
