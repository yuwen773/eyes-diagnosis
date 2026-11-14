<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useLoginUserStore } from '@/stores/user'
import {
  listReferences, referenceDetail, uploadReference, governReference, deleteReference, downloadReference,
  type ControlledReference, type ReferenceDetail,
} from '@/api/controlledReference'

const users = useLoginUserStore()
const isAdmin = computed(() => users.loginUser.userRole === 'admin')
const isReviewer = computed(() => users.loginUser.userRole === 'evidence_reviewer')
const canManage = computed(() => isAdmin.value || isReviewer.value)
const records = ref<ControlledReference[]>([])
const total = ref(0)
const page = ref(1)
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref<ReferenceDetail | null>(null)
const file = ref<File | null>(null)
const upload = reactive({ title: '', source: '', isTest: true })
const review = reactive({ diseases: '', topics: '', visibility: 'CURATED_PUBLIC' as ControlledReference['visibility'],
  enabled: true, domainReviewed: false, note: '' })
const statusLabels = { PENDING: '待审核', APPROVED: '已批准', WITHDRAWN: '已撤回' }

function showError(reason: unknown) {
  error.value = reason instanceof Error ? reason.message : '操作失败，请刷新后重试'
}
async function load() {
  loading.value = true
  try {
    const result = await listReferences(page.value)
    records.value = result.records
    total.value = result.total
  } catch (reason) { showError(reason) }
  finally { loading.value = false }
}
watch(canManage, allowed => { if (allowed) void load() }, { immediate: true })

function chooseFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}
async function submitUpload() {
  if (!file.value || busy.value) return
  busy.value = true
  error.value = ''; notice.value = ''
  try {
    const data = new FormData()
    data.append('file', file.value)
    data.append('title', upload.title)
    data.append('source', upload.source)
    data.append('isTest', String(upload.isTest))
    await uploadReference(data)
    notice.value = '候选资料已上传，等待领域审核。'
    page.value = 1
    await load()
  } catch (reason) { showError(reason) }
  finally { busy.value = false }
}
async function open(reference: ControlledReference) {
  error.value = ''; notice.value = ''; selected.value = null
  busy.value = true
  try {
    selected.value = await referenceDetail(reference.id)
    const current = selected.value.reference
    Object.assign(review, { diseases: current.diseaseCodes.join(', '), topics: current.topicCodes.join(', '),
      visibility: current.reviewStatus === 'PENDING' ? 'CURATED_PUBLIC' : current.visibility,
      enabled: current.enabled, domainReviewed: false, note: current.reviewNote })
  } catch (reason) { showError(reason) }
  finally { busy.value = false }
}
const codes = (value: string) => value.split(/[,，\n]/).map(code => code.trim()).filter(Boolean)
async function govern(status: ControlledReference['reviewStatus']) {
  if (!selected.value || busy.value) return
  busy.value = true
  error.value = ''; notice.value = ''
  try {
    selected.value.reference = await governReference(selected.value.reference.id, {
      expectedGovernanceVersion: selected.value.reference.governanceVersion, reviewStatus: status,
      visibility: review.visibility, diseaseCodes: codes(review.diseases), topicCodes: codes(review.topics),
      enabled: review.enabled, domainReviewed: review.domainReviewed, note: review.note,
    })
    review.domainReviewed = false
    notice.value = status === 'WITHDRAWN' ? '资料已撤回，旧引用不能再用于新的资格使用。' : '审核状态已更新。'
    await load()
  } catch (reason) {
    selected.value = null
    showError(reason)
    error.value += ' 请重新打开资料，核对最新版本。'
  } finally { busy.value = false }
}
async function remove(reference: ControlledReference) {
  busy.value = true
  error.value = ''; notice.value = ''
  try {
    await deleteReference(reference.id, reference.governanceVersion)
    selected.value = null
    notice.value = '资料已删除，历史引用保留追溯信息。'
    await load()
  } catch (reason) { showError(reason) }
  finally { busy.value = false }
}
async function turnPage(delta: number) { page.value += delta; await load() }
async function download() {
  if (!selected.value) return
  try {
    const blob = await downloadReference(selected.value.reference.id)
    if (blob.type.includes('application/json')) throw new Error('无法下载资料，请刷新并核对权限')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = selected.value.reference.fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Browsers read the blob after click() returns; revoke on the next task so the download is not cancelled.
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (reason) { showError(reason) }
}
</script>

<template>
  <main class="references-page">
    <header class="page-heading">
      <p class="overline">REFERENCE GOVERNANCE</p>
      <h1>受控眼科参考资料</h1>
      <p>候选资料须经领域审核。患者说明只能引用当前获准、范围匹配的资料版本。</p>
    </header>
    <p v-if="!canManage" role="alert">此入口仅对管理员与领域审核人员开放。</p>
    <template v-else>
      <p class="safety-note">测试资料始终排除于临床检索；普通知识库资料不会自动获准。</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <form v-if="isAdmin" class="upload-form" @submit.prevent="submitUpload">
        <h2>上传候选资料</h2>
        <label>标题<input v-model="upload.title" name="title" required maxlength="200" :disabled="busy" /></label>
        <label>来源 / 出版信息<input v-model="upload.source" name="source" required maxlength="1024" :disabled="busy" /></label>
        <label>资料文件<input type="file" accept=".pdf,.doc,.docx,.txt,.md,.markdown" required :disabled="busy" @change="chooseFile" /></label>
        <label class="check"><input v-model="upload.isTest" type="checkbox" name="isTest" :disabled="busy" />测试资料（不用于临床证据）</label>
        <p v-if="!upload.isTest" class="hint">真实资料必须由指定领域审核人员核对原文、来源与适用范围后批准。</p>
        <button type="submit" :disabled="busy || !file">{{ busy ? '处理中…' : '上传并进入待审' }}</button>
      </form>

      <section aria-label="参考资料列表">
        <div class="section-heading"><h2>资料目录 <span class="mono">{{ total }}</span></h2><button class="secondary" :disabled="busy || loading" @click="load">刷新</button></div>
        <p v-if="loading" role="status">加载中…</p>
        <p v-else-if="!records.length">暂无候选资料。</p>
        <div v-else class="table-scroll">
          <table>
            <thead><tr><th>资料 / 来源</th><th>用途</th><th>资格状态</th><th>治理版本</th><th>操作</th></tr></thead>
            <tbody><tr v-for="record in records" :key="record.id">
              <td><strong>{{ record.title }}</strong><small>{{ record.source }}</small></td>
              <td>{{ record.isTest ? '测试资料' : '真实资料 · 须领域审核' }}</td>
              <td>{{ statusLabels[record.reviewStatus] }} · {{ record.enabled ? '已启用' : '已停用' }}<small>{{ record.visibility === 'CURATED_PUBLIC' ? '受控公开' : '私有' }}</small></td>
              <td class="mono">{{ record.governanceVersion }}</td>
              <td><button class="secondary" data-action="open" :disabled="busy" @click="open(record)">查看 / 审核</button></td>
            </tr></tbody>
          </table>
        </div>
        <nav class="pagination" aria-label="目录分页">
          <button class="secondary" :disabled="page <= 1 || busy || loading" @click="turnPage(-1)">上一页</button>
          <span class="mono">{{ page }}</span>
          <button class="secondary" :disabled="page * 20 >= total || busy || loading" @click="turnPage(1)">下一页</button>
        </nav>
      </section>

      <section v-if="selected" class="review-section" aria-label="资料审核">
        <p class="overline">SOURCE REVIEW</p><h2>{{ selected.reference.title }}</h2>
        <p>{{ selected.reference.isTest ? '测试资料 · 即使批准也不能进入临床检索' : '真实资料 · 请核对来源、原文及适用范围' }}</p>
        <dl class="provenance">
          <dt>来源</dt><dd>{{ selected.reference.source }}</dd>
          <dt>当前状态</dt><dd>{{ statusLabels[selected.reference.reviewStatus] }}</dd>
          <dt>文档版本</dt><dd class="mono">{{ selected.reference.documentVersion }}</dd>
          <dt>治理版本</dt><dd class="mono">{{ selected.reference.governanceVersion }}</dd>
          <dt>审核人员 / 时间</dt><dd class="mono">{{ selected.reference.reviewedBy ?? '—' }} / {{ selected.reference.reviewedAt ?? '—' }}</dd>
        </dl>
        <button class="secondary" :disabled="busy" @click="download">下载原始文件核对</button>
        <details open><summary>解析原文与引用片段</summary>
          <article v-for="chunk in selected.chunks" :key="chunk.chunkIndex" class="excerpt">
            <p>{{ chunk.excerpt }}</p><small class="mono">{{ chunk.chunkIndex }} · {{ chunk.excerptDigest }}</small>
          </article>
        </details>
        <form v-if="isReviewer" class="review-form" @submit.prevent="govern('PENDING')">
          <label>疾病编码（逗号分隔）<input v-model="review.diseases" name="diseaseCodes" :disabled="busy" /></label>
          <label>主题编码（逗号分隔）<input v-model="review.topics" name="topicCodes" :disabled="busy" /></label>
          <label>可见范围<select v-model="review.visibility" :disabled="busy"><option value="CURATED_PUBLIC">受控公开</option><option value="PRIVATE_USER">私有（不能作为临床证据）</option></select></label>
          <label class="check"><input v-model="review.enabled" type="checkbox" :disabled="busy" />启用资料</label>
          <label>审核 / 撤回说明<textarea v-model="review.note" name="reviewNote" required maxlength="2000" :disabled="busy" /></label>
          <label class="check"><input v-model="review.domainReviewed" name="domainReviewed" type="checkbox" :disabled="busy" />我已完成领域审核，核对来源、原文与疾病 / 主题范围</label>
          <div class="actions">
            <button type="button" data-action="approve" :disabled="busy || !review.domainReviewed || !review.note.trim() || !review.diseases.trim() || !review.topics.trim()" @click="govern('APPROVED')">批准当前版本</button>
            <button type="submit" class="secondary" :disabled="busy || !review.note.trim()">保存范围并置为待审</button>
            <button type="button" class="withdraw" data-action="withdraw" :disabled="busy || !review.note.trim()" @click="govern('WITHDRAWN')">撤回资料</button>
          </div>
        </form>
        <details v-if="isAdmin" class="delete-section"><summary>删除候选资料</summary>
          <p>删除后禁止新的资格使用，已有引用不能通过复验。</p>
          <button class="withdraw" :disabled="busy" @click="remove(selected.reference)">确认删除此资料</button>
        </details>
      </section>
    </template>
  </main>
</template>

<style scoped>
.references-page { max-width: 1200px; margin: 0 auto; padding: 48px 24px 80px; color: var(--iris-ink); }
.page-heading { max-width: 760px; margin-bottom: 32px; }
h1, h2 { font-family: var(--iris-font-serif); font-weight: 500; }
h1 { font-size: 36px; margin: 8px 0 16px; }
h2 { font-size: 22px; margin: 0 0 16px; }
p { line-height: 1.6; }
.overline, .mono { font-family: var(--iris-font-mono); overflow-wrap: anywhere; }
.overline { font-size: 11px; letter-spacing: 2px; color: var(--iris-ink-2); }
.safety-note { background: var(--iris-accent-soft); color: var(--iris-accent-strong); padding: 16px 20px; border-radius: var(--iris-radius); }
section, .upload-form { border-top: 1px solid var(--iris-line); padding-top: 24px; margin-top: 32px; }
.upload-form, .review-form { display: grid; gap: 16px; max-width: 760px; }
label { display: grid; gap: 8px; font-size: 14px; }
input:not([type=checkbox]), select, textarea { width: 100%; padding: 10px 12px; background: var(--iris-surface); border: 1px solid var(--iris-line-strong); border-radius: var(--iris-radius); color: var(--iris-ink); font: inherit; box-sizing: border-box; }
textarea { min-height: 96px; }
.check { display: flex; align-items: center; }
button { padding: 10px 16px; border: 1px solid transparent; border-radius: var(--iris-radius); background: var(--iris-accent); color: var(--iris-on-accent); font: inherit; cursor: pointer; width: fit-content; }
button:hover { background: var(--iris-accent-strong); }
button.secondary { background: var(--iris-surface); color: var(--iris-ink); border-color: var(--iris-line-strong); }
button.withdraw { background: var(--iris-surface); color: var(--iris-error); border-color: var(--iris-line-strong); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 3px; }
.section-heading, .actions, .pagination { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.section-heading { justify-content: space-between; margin-bottom: 16px; }
.section-heading h2 { margin: 0; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
th, td { border-bottom: 1px solid var(--iris-line); padding: 16px 12px; vertical-align: top; }
th { color: var(--iris-ink-2); font-weight: 500; }
td { overflow-wrap: anywhere; }
small { display: block; color: var(--iris-ink-2); margin-top: 8px; }
.pagination { justify-content: flex-end; margin-top: 16px; }
.provenance { display: grid; grid-template-columns: 120px 1fr; gap: 12px; font-size: 13px; margin: 24px 0; }
dt { color: var(--iris-ink-2); } dd { margin: 0; overflow-wrap: anywhere; }
summary { cursor: pointer; padding: 12px 0; }
.excerpt { border-left: 2px solid var(--iris-line-strong); padding: 0 16px 16px; margin: 16px 0; }
.excerpt p { white-space: pre-wrap; overflow-wrap: anywhere; }
.review-form { margin-top: 24px; }
.hint { font-size: 13px; color: var(--iris-ink-2); margin: 0; }
.error { color: var(--iris-error); }
.delete-section { margin-top: 24px; }
@media (max-width: 639px) { .references-page { padding: 32px 16px; } h1 { font-size: 28px; } .provenance { grid-template-columns: 1fr; gap: 8px; } }
</style>
