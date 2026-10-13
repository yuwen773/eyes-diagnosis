<script setup lang="ts">
import type { ReviewSummary } from '@/api/reviewController'
defineProps<{ tasks: ReviewSummary[]; selectedId?: string; busy: boolean }>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <section aria-label="质量复核任务列表">
    <h2>待处理任务</h2>
    <p v-if="!tasks.length && !busy">当前没有可领取或由您处理的质量复核任务。</p>
    <ul>
      <li v-for="task in tasks" :key="task.reviewTaskId">
        <button type="button" :data-task-id="task.reviewTaskId" :disabled="busy"
          :aria-pressed="task.reviewTaskId === selectedId" @click="$emit('select', task.reviewTaskId)">
          <strong>{{ task.status === 'CLAIMED' ? '已领取 · 继续复核' : '待领取 · 图像质量' }}</strong>
          <span>{{ task.workflowId }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
h2 { font-size: 1.15rem; }
ul { list-style: none; padding: 0; display: grid; gap: .75rem; }
button { display: grid; gap: .4rem; width: 100%; text-align: left; padding: 1rem; border: 1px solid var(--claude-border, #d9d0c6); border-radius: 10px; background: var(--claude-bg-secondary, #f7f2ec); color: inherit; font: inherit; cursor: pointer; }
button[aria-pressed="true"] { border-color: var(--claude-accent, #c96442); }
span { font-size: .8rem; overflow-wrap: anywhere; color: var(--claude-text-secondary); }
button:disabled { opacity: .55; cursor: default; }
</style>
