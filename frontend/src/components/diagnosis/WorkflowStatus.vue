<script setup lang="ts">
import { computed } from 'vue'
import type { WorkflowView, WorkflowStatus } from '@/api/workflowController'

const props = defineProps<{ workflow: WorkflowView }>()
const labels: Record<WorkflowStatus, string> = {
  CREATED: '任务已创建', QUEUED: '等待处理', RUNNING: '正在处理',
  WAITING_HUMAN_REVIEW: '等待医生复核', COMPLETED: '处理完成',
  COMPLETED_LIMITED: '处理完成，结果受限', REJECTED: '请重新上传图片',
  CANCELLED: '任务已取消', FAILED: '处理未完成',
}
const reason = computed(() => ({
  DIAGNOSIS_NOT_AVAILABLE: '图片验证已完成，诊断能力尚未接入，当前任务不提供诊断结果。',
  INVALID_IMAGE: '文件无法读取为有效的 JPG、PNG 或 WebP 图片，请重新选择图片。',
  GRAPH_VERSION_INCOMPATIBLE: '任务与当前服务版本不兼容，请联系管理员。',
  CHECKPOINT_UNAVAILABLE: '任务恢复信息不可用，请联系管理员。',
  EXECUTION_FAILED: '任务执行失败，请稍后重试或联系管理员。',
  RETRY_EXHAUSTED: '任务多次执行未成功，请联系管理员。',
}[props.workflow.stopReasonCode ?? ''] ?? ''))
const nodeLabels: Record<string, string> = {
  validateImage: '图片输入验证', diagnosisUnavailable: '诊断能力检查',
}
</script>

<template>
  <section class="workflow-status" aria-live="polite" aria-label="任务状态">
    <h3 class="status-title">{{ labels[workflow.status] }}</h3>
    <p class="task-id">任务标识：<code>{{ workflow.workflowId }}</code></p>
    <p v-if="reason" class="status-reason">{{ reason }}</p>
    <ul v-if="workflow.progress.completed.length" class="completed-nodes">
      <li v-for="node in workflow.progress.completed" :key="node">{{ nodeLabels[node] ?? node }} · 已完成</li>
    </ul>
    <p class="status-note">刷新页面后可继续查询本任务。正式诊断记录尚未保存。</p>
  </section>
</template>

<style scoped>
.workflow-status { margin-top: 1.5rem; padding: 1.25rem; border-radius: 12px; background: var(--claude-bg-secondary, #f7f2ec); }
.status-title { margin: 0 0 .75rem; color: var(--claude-text-primary); font-size: 1.1rem; }
.task-id { overflow-wrap: anywhere; font-size: .85rem; }
.status-reason { line-height: 1.7; }
.completed-nodes { padding-left: 1.25rem; line-height: 1.8; }
.status-note { margin-bottom: 0; color: var(--claude-text-secondary); font-size: .85rem; }
</style>
