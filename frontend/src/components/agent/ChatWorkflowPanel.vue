<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import WorkflowStatus from '@/components/diagnosis/WorkflowStatus.vue'
import { useUploadWorkflow } from '@/composables/useUploadWorkflow'
import type { WorkflowView } from '@/api/workflowController'

const props = defineProps<{ workflows: WorkflowView[]; loading: boolean }>()
const emit = defineEmits<{ bind: [workflowId: string] }>()
const route = useRoute()
const router = useRouter()
const { workflow, error, refresh } = useUploadWorkflow()
const linked = computed(() => props.workflows.some(w => w.workflowId === workflow.value?.workflowId))
</script>

<template>
  <section v-if="workflows.length || route.query.workflow" class="chat-workflow" aria-label="本会话诊断任务">
    <label v-if="workflows.length" class="task-picker">
      本会话诊断任务
      <select aria-label="选择诊断任务" :value="route.query.workflow || ''"
        @change="router.replace({ query: { ...route.query, workflow: ($event.target as HTMLSelectElement).value } })">
        <option disabled value="">选择任务查看状态</option>
        <option v-for="task in workflows" :key="task.workflowId" :value="task.workflowId">{{ task.workflowId }}</option>
      </select>
    </label>
    <p v-if="error" role="alert">{{ error }}</p>
    <WorkflowStatus v-if="workflow" :workflow="workflow" />
    <div class="task-actions">
      <button type="button" @click="refresh">刷新状态</button>
      <button v-if="workflow && !linked" type="button" :disabled="loading" @click="emit('bind', workflow.workflowId)">关联到当前对话</button>
      <RouterLink v-if="workflow" :to="{ path: '/diagnosis', query: { workflow: workflow.workflowId } }">在诊断页查看同一任务</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.chat-workflow { max-height: 36vh; overflow-y: auto; padding: .75rem 1.25rem; color: var(--claude-text-primary); }
.task-picker { display: flex; gap: .75rem; align-items: center; font-size: .85rem; }
select { max-width: 65%; background: var(--claude-bg-elevated); color: inherit; border: 1px solid var(--claude-border-warm); border-radius: 6px; padding: .3rem; }
.task-actions { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; margin-top: .75rem; font-size: .85rem; }
button { background: transparent; color: inherit; border: 1px solid var(--claude-border-warm); border-radius: 6px; padding: .3rem .6rem; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
</style>
