<script setup lang="ts">
/**
 * WorkflowTimeline —— 事件驱动的时间线渲染器。
 *
 * 渲染规则（Backend Workflow View → Frontend Renderer）：
 * - 阶段步骤完全来自后端 progress.completed / progress.current 的展示名，
 *   前端不维护「状态 → 阶段」映射，也不推断下一步；
 * - 事件列表按后端返回顺序原样渲染（type/time/segment），不做业务解释。
 */
import { computed } from 'vue'
import type { WorkflowEventView, WorkflowProgressView } from '@/api/workflow'
import WorkflowStatusBadge from './WorkflowStatusBadge.vue'

const props = defineProps<{
  status: string | null | undefined
  progress?: WorkflowProgressView | null
  events?: WorkflowEventView[] | null
}>()

interface StepItem {
  name: string
  state: 'completed' | 'current'
}

const steps = computed<StepItem[]>(() => {
  const completed = props.progress?.completed ?? []
  const current = props.progress?.current
  const items: StepItem[] = completed.map((name) => ({ name, state: 'completed' as const }))
  if (current && !completed.includes(current)) {
    items.push({ name: current, state: 'current' })
  }
  return items
})

const eventItems = computed(() => props.events ?? [])

/** 事件类型 → 友好文案（仅文案翻译，未知类型原样展示） */
const EVENT_TYPE_LABELS: Record<string, string> = {
  WORKFLOW_CREATED: '诊断工作流已创建',
  HUMAN_REVIEW_DECISION_SUBMITTED: '医生已提交审核决定',
}

const eventLabel = (type: string) => EVENT_TYPE_LABELS[type] ?? type

const formatTime = (time: string) => {
  if (!time) return ''
  const normalized = time.replace('T', ' ')
  return normalized.length > 19 ? normalized.slice(0, 19) : normalized
}
</script>

<template>
  <div class="wf-timeline" data-testid="workflow-timeline">
    <div class="wf-timeline__header">
      <h3 class="wf-timeline__title">诊断进度</h3>
      <WorkflowStatusBadge :status="props.status" />
    </div>

    <ol v-if="steps.length > 0" class="wf-timeline__steps" data-testid="timeline-steps">
      <li
        v-for="step in steps"
        :key="step.name"
        class="wf-step"
        :class="`wf-step--${step.state}`"
        :data-step-state="step.state"
      >
        <span class="wf-step__marker" aria-hidden="true">
          <svg v-if="step.state === 'completed'" viewBox="0 0 16 16" width="10" height="10">
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="wf-step__name">{{ step.name }}</span>
        <span v-if="step.state === 'current'" class="wf-step__hint">进行中</span>
      </li>
    </ol>
    <p v-else class="wf-timeline__empty" data-testid="timeline-steps-empty">
      流程即将开始，请稍候…
    </p>

    <div class="wf-timeline__events">
      <h4 class="wf-timeline__subtitle">事件记录</h4>
      <ul v-if="eventItems.length > 0" class="wf-events" data-testid="timeline-events">
        <li v-for="(event, index) in eventItems" :key="`${event.type}-${event.time}-${index}`" class="wf-event">
          <span class="wf-event__time">{{ formatTime(event.time) }}</span>
          <span class="wf-event__label">{{ eventLabel(event.type) }}</span>
          <span v-if="event.segment" class="wf-event__segment">{{ event.segment }}</span>
        </li>
      </ul>
      <p v-else class="wf-timeline__empty" data-testid="timeline-events-empty">暂无事件</p>
    </div>
  </div>
</template>

<style scoped>
.wf-timeline {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  padding: 20px 24px;
}
.wf-timeline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.wf-timeline__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  color: #141413;
  margin: 0;
}
.wf-timeline__subtitle {
  font-size: 13px;
  color: #6b6a66;
  margin: 0 0 8px;
  font-weight: 600;
}
.wf-timeline__steps {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.wf-step {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0 8px 4px;
}
.wf-step:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 12px;
  top: 30px;
  bottom: -6px;
  width: 2px;
  background: #e3e1d7;
}
.wf-step__marker {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 2px solid #e3e1d7;
  background: #fff;
  color: #fff;
  z-index: 1;
}
.wf-step--completed .wf-step__marker {
  background: #3f9160;
  border-color: #3f9160;
}
.wf-step--current .wf-step__marker {
  border-color: #c96442;
  background: rgba(201, 100, 66, 0.15);
}
.wf-step__name {
  font-size: 14px;
  color: #141413;
}
.wf-step--current .wf-step__name {
  color: #c96442;
  font-weight: 600;
}
.wf-step__hint {
  font-size: 12px;
  color: #c96442;
  background: rgba(201, 100, 66, 0.08);
  border-radius: 999px;
  padding: 1px 8px;
}
.wf-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wf-event {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #f5f4ed;
}
.wf-event__time {
  color: #8f8d86;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.wf-event__label {
  color: #33322f;
}
.wf-event__segment {
  margin-left: auto;
  color: #a5a39a;
  font-size: 12px;
}
.wf-timeline__empty {
  font-size: 13px;
  color: #8f8d86;
  margin: 0;
}
</style>
