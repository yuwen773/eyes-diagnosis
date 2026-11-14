<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import request from '@/request'
import type { PatientFollowUp } from '@/api/patientFollowUp'

const props = defineProps<{ taskId: string; disabled: boolean }>()
const emit = defineEmits<{ restricted: [] }>()
const question = ref('')
const answer = ref<PatientFollowUp | null>(null)
const asking = ref(false)
let requestVersion = 0
watch(() => [props.taskId, props.disabled], () => { requestVersion++; answer.value = null; asking.value = false })
onUnmounted(() => { requestVersion++ })

async function ask() {
  if (asking.value || props.disabled || !question.value.trim() || question.value.length > 1000) return
  const current = ++requestVersion
  const taskId = props.taskId
  asking.value = true; answer.value = null
  try {
    const response = await request.post(`/diagnosis-tasks/${encodeURIComponent(taskId)}/follow-ups`, { question: question.value.trim() })
    if (current !== requestVersion) return
    const value: PatientFollowUp = response.data.data
    if (response.data.code !== 0 || !value || value.taskId !== taskId || !['RELATED_INFORMATION', 'INSUFFICIENT_EVIDENCE', 'RESTRICTED'].includes(value.status)) throw new Error()
    if (value.status === 'RESTRICTED') { emit('restricted'); return }
    answer.value = { ...value, claims: value.status === 'RELATED_INFORMATION' ? value.claims : [], sources: value.status === 'RELATED_INFORMATION' ? value.sources : [] }
  } catch {
    if (current === requestVersion) emit('restricted')
  } finally { if (current === requestVersion) asking.value = false }
}
</script>

<template>
  <section class="follow-up" aria-labelledby="follow-up-heading" :aria-busy="asking">
    <h3 id="follow-up-heading">围绕本次已发布结果追问</h3>
    <p>仅查找本次已发布说明及仍有效的原有依据；未覆盖的问题会明确提示。追问不会修改结果或授权保存。</p>
    <p>一般眼健康咨询与本次结果分开，普通聊天内容不作为本次受控临床证据。<a href="/agent" data-action="general-health">进入一般眼健康咨询</a></p>
    <form data-action="follow-up" @submit.prevent="ask">
      <label for="follow-up-question">关于本次结果的问题</label>
      <textarea id="follow-up-question" v-model="question" maxlength="1000" rows="3" :disabled="asking || disabled" placeholder="例如：说明中提到的眼科检查是什么？" />
      <button type="submit" :disabled="asking || disabled || !question.trim()">{{ asking ? '正在核对依据…' : '查找已发布依据' }}</button>
    </form>
    <div v-if="answer" role="status" class="answer">
      <p>{{ answer.message }}</p>
      <div v-for="claim in answer.claims" :key="claim.id" class="claim">
        <p>{{ claim.text }}</p>
        <p v-for="(reference, index) in claim.references" :key="index">来源 <span class="numeric">{{ reference.citationIndex + 1 }}</span>：“{{ reference.quote }}”</p>
      </div>
      <div v-for="source in answer.sources" :key="source.citationIndex" class="claim">
        <h4><span class="numeric">{{ source.citationIndex + 1 }}</span> · {{ source.title }}</h4>
        <p>{{ source.excerpt }}</p><p>{{ source.source }}</p>
        <p class="numeric">文档版本 {{ source.documentVersion }} · 治理版本 {{ source.governanceVersion }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.follow-up { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--iris-line); overflow-wrap: anywhere; }
h3, h4 { font-family: var(--iris-font-serif); font-weight: 500; }
p { line-height: 1.7; color: var(--iris-ink-2); }
a { color: var(--iris-accent); }
form { display: grid; gap: 12px; }
textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 12px; font: inherit; color: var(--iris-ink); border: 1px solid var(--iris-line); border-radius: var(--iris-radius); background: var(--iris-surface); }
button { justify-self: start; padding: 11px 16px; border: 0; border-radius: var(--iris-radius); background: var(--iris-accent); color: var(--iris-on-accent); cursor: pointer; }
button:hover:not(:disabled) { background: var(--iris-accent-strong); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 3px; }
.numeric { font-family: var(--iris-font-mono); font-size: 12px; }
.claim { border-top: 1px solid var(--iris-line); padding-block: 12px; }
</style>
