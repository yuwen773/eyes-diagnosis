<script setup lang="ts">
import { onMounted, reactive, shallowRef, watch } from 'vue'
import { getEvidenceCatalog, updateKnowledgeGovernance, type KnowledgeDocument } from '@/api/knowledgeController'

const props = defineProps<{ document: KnowledgeDocument }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const form = reactive({ visibility: props.document.visibility ?? 'PRIVATE_USER',
  reviewStatus: props.document.reviewStatus ?? 'PENDING',
  diseaseCodes: [...(props.document.diseaseCodes ?? [])], topicCodes: [...(props.document.topicCodes ?? [])] })
const catalog = shallowRef<{ diseaseCodes: Record<string, string>; topicCodes: Record<string, string> } | null>(null)
const confirmed = shallowRef(false)
const saving = shallowRef(false)
const error = shallowRef('')
watch(form, () => { confirmed.value = false })

onMounted(async () => {
  try { catalog.value = await getEvidenceCatalog() }
  catch { error.value = '受控编码目录加载失败，请关闭后重试。' }
})

async function save() {
  if (!confirmed.value || saving.value || !catalog.value) return
  saving.value = true
  error.value = ''
  try {
    const response = await updateKnowledgeGovernance(props.document.id, { ...form,
      expectedVersion: props.document.governanceVersion ?? 0, confirmed: true })
    if (response.code !== 0) throw new Error(response.msg)
    emit('saved')
  } catch (cause) {
    const failure = cause as { response?: { data?: { msg?: string } }; message?: string }
    error.value = failure.response?.data?.msg ?? failure.message ?? '审核变更失败，请刷新资料后重试。'
    confirmed.value = false
  } finally { saving.value = false }
}
</script>

<template>
  <form class="governance-editor" aria-label="参考资料审核" @submit.prevent="save">
    <h3>审核参考资料：{{ document.title }}</h3>
    <p>来源文件：{{ document.fileName }} · 当前审核版本 {{ document.governanceVersion ?? 0 }}</p>
    <label>可见范围
      <select v-model="form.visibility" aria-label="可见范围" :disabled="saving">
        <option value="PRIVATE_USER">私人资料</option><option value="CURATED_PUBLIC">公共参考资料</option>
        <option value="QUARANTINED">隔离资料</option>
      </select>
    </label>
    <label>审核状态
      <select v-model="form.reviewStatus" aria-label="审核状态" :disabled="saving">
        <option value="PENDING">待审核</option><option value="APPROVED">审核通过</option>
        <option value="REJECTED">审核拒绝</option><option value="WITHDRAWN">已撤回</option>
      </select>
    </label>
    <fieldset :disabled="saving || !catalog"><legend>疾病编码</legend>
      <label v-for="(term, code) in catalog?.diseaseCodes" :key="code">
        <input v-model="form.diseaseCodes" type="checkbox" :value="code" />{{ code }} · {{ term }}
      </label>
    </fieldset>
    <fieldset :disabled="saving || !catalog"><legend>主题编码</legend>
      <label v-for="(term, code) in catalog?.topicCodes" :key="code">
        <input v-model="form.topicCodes" type="checkbox" :value="code" />{{ code }} · {{ term }}
      </label>
    </fieldset>
    <p>只有公共、审核通过且编码匹配的资料可用于正式诊断参考。私人和隔离资料不会进入该检索。</p>
    <label><input v-model="confirmed" type="checkbox" aria-label="确认审核变更" :disabled="saving" />
      我已核对资料来源、分享范围和以上属性，确认保存本次审核变更。
    </label>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="editor-actions">
      <button type="submit" :disabled="!confirmed || saving || !catalog">{{ saving ? '正在保存…' : '确认保存审核变更' }}</button>
      <button type="button" :disabled="saving" @click="emit('cancel')">关闭</button>
    </div>
  </form>
</template>

<style scoped>
.governance-editor { margin: 1rem 0; padding: 1.25rem; border: 1px solid var(--claude-border-warm); border-radius: 12px; background: var(--claude-bg-card); color: var(--claude-text-primary); }
.governance-editor > label { display: flex; align-items: center; gap: .75rem; margin: .75rem 0; }
.governance-editor fieldset { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0; padding: .75rem; border: 1px solid var(--claude-border-warm); border-radius: 6px; }
.governance-editor legend { font-size: .95rem; font-weight: 600; width: auto; }
.governance-editor fieldset label { display: flex; align-items: center; gap: .35rem; font-size: .85rem; }
.governance-editor select, .editor-actions button { padding: .5rem .75rem; border-radius: 6px; border: 1px solid var(--claude-border-warm); color: inherit; background: var(--claude-bg-page); }
.editor-actions { display: flex; gap: .75rem; }
.editor-actions button[type=submit] { background: var(--claude-brand); color: white; }
.editor-actions button:disabled { opacity: .5; }
.governance-editor [role=alert] { color: var(--claude-error, #aa382d); }
</style>
