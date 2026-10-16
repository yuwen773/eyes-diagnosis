<script setup lang="ts">
import { shallowRef } from 'vue'
import { rebuildLegacyTask, type LegacyTask } from '@/api/legacyTaskController'

const props = defineProps<{ task: LegacyTask }>()
const storageKey = `legacy-rebuild:${props.task.sourceType}:${props.task.taskId}`
const file = shallowRef<File | null>(null)
const confirmed = shallowRef(false)
const submitting = shallowRef(false)
const attempted = shallowRef(sessionStorage.getItem(storageKey) !== null)
const error = shallowRef('')
const workflowId = shallowRef(sessionStorage.getItem(storageKey + ':workflow') ?? '')

function startAnother() {
  sessionStorage.removeItem(storageKey)
  sessionStorage.removeItem(storageKey + ':workflow')
  workflowId.value = ''
  file.value = null
  confirmed.value = false
  attempted.value = false
  error.value = ''
}

function selectFile(event: Event) {
  const value = (event.target as HTMLInputElement).files?.[0]
  file.value = null
  error.value = ''
  if (!value) return
  if (!/\.(jpe?g|png|webp)$/i.test(value.name) || !value.size || value.size > 2 * 1024 * 1024) {
    error.value = '请选择不超过 2MB 的 JPG、PNG 或 WebP 图片。'
    return
  }
  file.value = value
}

async function rebuild() {
  if (!file.value || !confirmed.value || submitting.value || workflowId.value) return
  submitting.value = true
  attempted.value = true
  error.value = ''
  try {
    const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID()
    sessionStorage.setItem(storageKey, key)
    const created = await rebuildLegacyTask(props.task, file.value, key)
    workflowId.value = created.workflowId
    sessionStorage.setItem(storageKey + ':workflow', created.workflowId)
  } catch (cause) {
    const failure = cause as { response?: { data?: { msg?: string } } }
    error.value = failure.response?.data?.msg ?? '提交结果暂未确认，请重试；将沿用同一请求标识。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <article class="legacy-detail" aria-label="旧任务详情">
    <h2 class="detail-title">旧任务详情 · 只读</h2>
    <dl class="metadata">
      <dt>原任务标识</dt><dd>{{ task.taskId }}</dd>
      <dt>来源</dt><dd>{{ task.sourceType === 'upload' ? '旧版上传任务' : '旧版诊断工作流' }} · {{ task.sourceVersion ?? '未记录版本' }}</dd>
      <dt>原状态</dt><dd>{{ task.status }}（旧版原值）</dd>
      <dt>创建时间</dt><dd>{{ task.createdAt ?? '旧版未记录' }}</dd>
      <dt>更新时间</dt><dd>{{ task.updatedAt ?? '旧版未记录' }}</dd>
    </dl>
    <p v-if="task.question" class="description">原问题：{{ task.question }}</p>
    <p class="description">原状态仅供历史查看，不表示当前任务已完成或可继续执行。重建将创建独立的新 Python 工作流，原记录保持不变；旧批准不会转移，医生复核与保存授权须重新进行，不会自动保存正式诊断记录。</p>
    <form class="rebuild-form" @submit.prevent="rebuild">
      <label for="legacy-image">重新上传眼底图片</label>
      <input id="legacy-image" :key="workflowId" type="file" accept=".jpg,.jpeg,.png,.webp" :disabled="submitting || !!workflowId" @change="selectFile" />
      <p class="hint">旧输入无法可靠复用，请上传不超过 2MB 的清晰图片。</p>
      <label class="confirm-label">
        <input v-model="confirmed" type="checkbox" :disabled="submitting || !!workflowId" />
        我已理解并确认创建独立的新任务
      </label>
      <button type="submit" :disabled="!file || !confirmed || submitting || !!workflowId">
        {{ submitting ? '正在创建…' : workflowId ? '新任务已创建' : attempted ? '重试关联重建' : '确认关联重建' }}
      </button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="attempted && !workflowId" class="hint">已有提交记录。结果未知时请重新选择上次图片重试，同一请求不会重复创建。</p>
    <RouterLink v-if="workflowId" data-test="new-workflow" :to="{ path: '/diagnosis', query: { workflow: workflowId } }">查看新 Python 工作流 · {{ workflowId }}</RouterLink>
    <button v-if="workflowId" type="button" data-test="new-rebuild" @click="startAnother">选择另一张图片，再次明确确认重建</button>
  </article>
</template>

<style scoped>
.legacy-detail { margin-top: 1.5rem; padding: 1.5rem; border-radius: 12px; background: var(--claude-bg-card, #f7f2ec); }
.detail-title { margin: 0 0 1rem; font-size: 1.2rem; }
.metadata { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .6rem; }
.metadata dd { margin: 0; overflow-wrap: anywhere; }
.metadata dt, .hint { color: var(--claude-text-secondary); }
.description { line-height: 1.8; overflow-wrap: anywhere; }
.rebuild-form { display: grid; gap: .8rem; margin-top: 1.5rem; }
.hint { margin: 0; font-size: .85rem; }
.confirm-label { display: flex; gap: .5rem; align-items: start; }
.rebuild-form button { justify-self: start; border: 0; border-radius: 10px; padding: .8rem 1.2rem; background: var(--claude-accent, #c96442); color: white; font: inherit; cursor: pointer; }
.rebuild-form button:disabled { opacity: .55; cursor: default; }
</style>
