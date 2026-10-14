<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { replySupplement, type SupplementView } from '@/api/supplementController'

const props = defineProps<{ requests: SupplementView[]; loading: boolean }>()
const emit = defineEmits<{ answered: []; refresh: [] }>()
const waiting = computed(() => props.requests.find(request => request.status === 'WAITING'))
const text = ref('')
const submitting = ref(false)
const error = ref('')
watch(() => waiting.value?.requestId, () => { text.value = ''; error.value = '' })

async function submit() {
  const request = waiting.value
  if (!request || submitting.value || props.loading || !text.value.trim() || text.value.length > 4000) return
  submitting.value = true
  error.value = ''
  try {
    const answered = await replySupplement(request, text.value)
    if (waiting.value?.requestId !== request.requestId) return
    if (answered.requestId !== request.requestId || answered.status !== 'ANSWERED') throw new Error('补充回复关联响应不匹配')
    emit('answered')
  } catch (cause) {
    if (waiting.value?.requestId === request.requestId) error.value = cause instanceof Error ? cause.message : '补充说明提交失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section v-if="waiting" class="supplement-panel" aria-label="待补充说明" :aria-busy="submitting">
    <p class="waiting-title" role="status">等待您补充说明</p>
    <p class="waiting-note">{{ waiting.items[0]?.prompt }}</p>
    <form @submit.prevent="submit">
      <label class="description-label" :for="`supplement-${waiting.requestId}`">本次补充说明</label>
      <textarea :id="`supplement-${waiting.requestId}`" v-model="text" :disabled="submitting || loading" maxlength="4000" rows="2" />
      <div class="supplement-actions">
        <button type="submit" :disabled="submitting || loading || !text.trim()">{{ submitting ? '正在提交…' : '提交补充并继续' }}</button>
        <button type="button" :disabled="submitting || loading" @click="emit('refresh')">刷新等待状态</button>
      </div>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <details class="request-source"><summary>查看关联任务</summary>{{ waiting.workflowId }}</details>
  </section>
</template>

<style scoped>
.supplement-panel { max-height: 32vh; overflow-y: auto; margin: .25rem 1.25rem; padding: .75rem 1rem; border: 1px solid var(--claude-border-warm); border-radius: 12px; background: var(--claude-bg-elevated); color: var(--claude-text-primary); }
.waiting-title { margin: 0 0 .4rem; font-weight: 600; }
.waiting-note, .request-source { margin: .4rem 0; color: var(--claude-text-secondary); font-size: .85rem; overflow-wrap: anywhere; }
.description-label { display: block; font-size: .85rem; margin-bottom: .35rem; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--claude-border-warm); border-radius: 8px; padding: .5rem; font: inherit; color: inherit; background: var(--claude-bg-page); }
.supplement-actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: .5rem; }
button { background: transparent; color: inherit; border: 1px solid var(--claude-border-warm); border-radius: 8px; padding: .4rem .75rem; font: inherit; cursor: pointer; }
button[type=submit] { color: white; background: var(--claude-accent, #c96442); border-color: transparent; }
button:disabled { opacity: .55; cursor: default; }
@media (max-width: 700px) {
  .supplement-panel { position: fixed; left: 1rem; right: 1rem; bottom: 1rem; z-index: 50; margin: 0; max-height: 65vh; box-shadow: 0 8px 32px #0003; }
}
</style>
