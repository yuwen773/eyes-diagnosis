<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import WorkflowStatus from '@/components/diagnosis/WorkflowStatus.vue'
import { useUploadWorkflow } from '@/composables/useUploadWorkflow'

const { workflow, submitting, error, terminal, submit, refresh } = useUploadWorkflow()
const file = shallowRef<File | null>(null)
const validationError = shallowRef('')
const idempotencyKey = shallowRef('')
const busy = computed(() => submitting.value || (workflow.value !== null && !terminal.value))

function selectFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0]
  validationError.value = ''
  file.value = null
  if (!selected) return
  if (!/\.(jpe?g|png|webp)$/i.test(selected.name) || selected.size === 0 || selected.size > 2 * 1024 * 1024) {
    validationError.value = '请选择不超过 2MB 的 JPG、PNG 或 WebP 图片。'
    return
  }
  file.value = selected
  idempotencyKey.value = crypto.randomUUID()
}

async function start() {
  if (file.value && !busy.value) await submit(file.value, idempotencyKey.value)
}
</script>

<template>
  <div class="workflow-uploader">
    <h2 class="upload-title">眼底图片分析任务</h2>
    <form class="upload-form" @submit.prevent="start">
      <label class="file-label" for="workflow-image">选择眼底图片</label>
      <input id="workflow-image" type="file" accept=".jpg,.jpeg,.png,.webp" :disabled="busy" @change="selectFile" />
      <p class="upload-hint">支持 JPG、PNG、WebP，最大 2MB。请选择清晰、光照均匀的单眼图片。</p>
      <button class="submit-button" type="submit" :disabled="!file || busy">
        {{ submitting ? '正在提交…' : busy ? '任务处理中' : '创建分析任务' }}
      </button>
    </form>
    <p v-if="validationError || error" class="error-message" role="alert">{{ validationError || error }}</p>
    <WorkflowStatus v-if="workflow" :workflow="workflow" />
    <button v-if="workflow || error" type="button" class="refresh-button" @click="refresh">刷新状态</button>
  </div>
</template>

<style scoped>
.workflow-uploader { padding: clamp(1.25rem, 4vw, 2rem); color: var(--claude-text-primary); }
.upload-title { margin: 0 0 1.5rem; font-size: 1.25rem; }
.upload-form { display: grid; gap: .75rem; }
.file-label { font-weight: 600; }
.upload-hint { margin: 0; color: var(--claude-text-secondary); font-size: .85rem; line-height: 1.6; }
.submit-button { border: 0; border-radius: 10px; padding: .85rem 1rem; background: var(--claude-accent, #c96442); color: white; cursor: pointer; font: inherit; }
.submit-button:disabled { opacity: .55; cursor: default; }
.refresh-button { margin-top: 1rem; border: 1px solid var(--claude-border, #d9d0c6); border-radius: 8px; padding: .5rem 1rem; background: transparent; color: inherit; cursor: pointer; }
.error-message { color: var(--claude-error, #aa382d); line-height: 1.6; }
</style>
