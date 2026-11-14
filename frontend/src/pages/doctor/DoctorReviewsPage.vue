<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLoginUserStore } from '@/stores/user'
import { assignReview, decideReview, listReviews, reviewDetail, type ReviewDetail, type ReviewStatus, type ReviewSummary } from '@/api/doctorReview'

const users = useLoginUserStore()
const isDoctor = computed(() => users.loginUser.userRole === 'doctor')
const isAdmin = computed(() => users.loginUser.userRole === 'admin')
const records = ref<ReviewSummary[]>([])
const selected = ref<ReviewDetail | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const note = ref('')
const confirmed = ref(false)
const taskId = ref('')
const doctorId = ref('')
let epoch = 0
const statusLabel: Record<ReviewStatus, string> = { PENDING: '等待复核', APPROVED: '已通过', REJECTED: '未通过', INVALIDATED: '材料已失效' }
const sectionLabel: Record<string, string> = { MAIN_FINDING: '主要信息', RISK: '风险提示', NEXT_STEP: '下一步', UNCERTAINTY: '不确定性', DETAIL: '详细依据', LIMITATION: '适用限制' }
const canDecide = computed(() => !!selected.value && selected.value.status === 'PENDING' && confirmed.value && !!note.value.trim() && !busy.value)
const objections = computed(() => selected.value?.materials.agentMessages.flatMap(message =>
  (message.output.result?.objections ?? []).map(objection => ({ ...objection, sequence: message.sequence }))) ?? [])
const vision = computed(() => selected.value?.materials.agentMessages.find(message => message.role === 'VISION')?.output.result)

async function load() {
  const current = epoch
  busy.value = true
  try { const result = await listReviews(); if (current === epoch) records.value = result }
  catch { if (current === epoch) error.value = '无法读取复核任务，请刷新重试。' }
  finally { if (current === epoch) busy.value = false }
}
watch(() => `${users.loginUser.id}:${users.loginUser.userRole}`, () => {
  epoch++; selected.value = null; records.value = []; note.value = ''; confirmed.value = false
  error.value = ''; notice.value = ''; busy.value = false
  if (isDoctor.value) void load()
}, { immediate: true })

async function open(review: ReviewSummary) {
  if (busy.value) return
  const current = ++epoch
  selected.value = null; note.value = ''; confirmed.value = false; error.value = ''; notice.value = ''; busy.value = true
  try { const result = await reviewDetail(review.reviewId); if (current === epoch) selected.value = result }
  catch { if (current === epoch) error.value = '无法打开任务，请核对授权后重试。' }
  finally { if (current === epoch) busy.value = false }
}
async function decide(decision: 'APPROVED' | 'REJECTED') {
  if (!selected.value || !canDecide.value) return
  const review = selected.value
  const current = epoch
  busy.value = true; error.value = ''
  try {
    const result = await decideReview(review.reviewId, {
      expectedTaskVersion: review.taskVersion, expectedDraftVersion: review.draftVersion, expectedEvidenceVersion: review.evidenceVersion,
      expectedMaterialDigest: review.materialDigest, decision, note: note.value.trim(),
    })
    if (current === epoch) {
      selected.value = result
      records.value = records.value.map(row => row.reviewId === result.reviewId ? result : row)
      notice.value = '复核决定已记录。'
    }
  } catch {
    if (current === epoch) {
      selected.value = null; confirmed.value = false
      error.value = '提交未完成，请重新打开任务，核对最新版本与已有决定。'
      await load()
    }
  } finally { if (current === epoch) busy.value = false }
}
async function assign() {
  if (busy.value || !isAdmin.value) return
  const current = epoch
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await assignReview(taskId.value.trim(), doctorId.value.trim())
    if (current === epoch) notice.value = '任务已分配给指定医生，等待独立复核。'
  } catch { if (current === epoch) error.value = '分配失败，请核对任务状态、医生账号及已有分配。' }
  finally { if (current === epoch) busy.value = false }
}
</script>

<template>
  <main class="review-page">
    <header class="page-heading">
      <p class="overline">CLINICAL REVIEW</p>
      <h1>医生复核</h1>
      <p>独立核对患者解释、冻结证据与 Agent 异议，记录你的专业判断。</p>
    </header>
    <p v-if="!isDoctor && !isAdmin" role="alert">此入口仅对医生与任务分配管理员开放。</p>
    <template v-else>
      <p class="responsibility">复核针对当前冻结材料。模型预测不等同于确诊，复核通过不构成患者保存授权。</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <section v-if="isAdmin" class="panel">
        <h2>分配复核任务</h2>
        <p>将已就绪任务明确分配给医生。患者本人不能复核自己的任务。</p>
        <form @submit.prevent="assign">
          <label>任务 ID<input v-model="taskId" name="taskId" required maxlength="36" /></label>
          <label>医生账号 ID<input v-model="doctorId" name="doctorId" required inputmode="numeric" pattern="[1-9][0-9]*" /></label>
          <button :disabled="busy" type="submit">分配给医生</button>
        </form>
      </section>
      <template v-if="isDoctor">
        <div class="inbox-heading"><h2>我的复核任务 <span class="mono">{{ records.length }}</span></h2><button class="secondary" :disabled="busy" @click="load">刷新任务</button></div>
        <p v-if="busy" role="status">正在读取或提交，请稍候。</p>
        <p v-else-if="!records.length">暂无获授权的复核任务。待分配后将在此显示。</p>
        <div class="review-layout">
          <nav aria-label="获授权复核任务">
            <button v-for="record in records" :key="record.reviewId" class="task-row secondary" :disabled="busy" data-action="open" @click="open(record)">
              <span>{{ statusLabel[record.status] }}</span><span class="mono">{{ record.taskId }}</span>
            </button>
          </nav>
          <article v-if="selected" class="panel" aria-label="冻结复核材料">
            <div class="inbox-heading"><h2>冻结患者解释</h2><span>{{ statusLabel[selected.status] }}</span></div>
            <p class="mono">任务 {{ selected.taskVersion }} · 草稿 {{ selected.draftVersion }} · 证据 {{ selected.evidenceVersion }}</p>
            <details><summary>冻结标识与溯源</summary><p class="mono">{{ selected.materialDigest }}</p><p>分配人：<span class="mono">{{ selected.assignedBy }}</span> · <span class="mono">{{ selected.assignedAt }}</span></p></details>
            <section v-if="vision"><h3>模型观察与限制</h3><p>{{ vision.summary }}</p><ul><li v-for="limitation in vision.limitations" :key="limitation">{{ limitation }}</li></ul><p v-if="vision.reanalysisSuggestion">再分析建议：{{ vision.reanalysisSuggestion }}（仅记录建议）</p></section>
            <section v-for="claim in selected.materials.draft.claims" :key="claim.id">
              <h3>{{ sectionLabel[claim.section] || claim.section }}</h3><p>{{ claim.text }}</p>
              <p v-for="reference in claim.references" :key="reference.citationIndex" class="citation">依据 <span class="mono">{{ reference.citationIndex + 1 }}</span>：“{{ reference.quote }}”</p>
            </section>
            <section><h3>冻结证据</h3>
              <div v-for="(source, index) in selected.materials.evidence" :key="`${source.documentId}:${index}`" class="source">
                <h4><span class="mono">{{ index + 1 }}.</span> {{ source.title }}</h4><p>{{ source.excerpt }}</p><p>{{ source.source }}</p>
                <details><summary>来源版本</summary><p class="mono">文档 {{ source.documentVersion }} · 治理 {{ source.governanceVersion }}</p></details>
              </div>
            </section>
            <section><h3>Agent 异议与不确定性</h3><p v-if="!objections.length">未记录 Agent 异议，仍需医生独立判断。</p>
              <div v-for="(objection, index) in objections" :key="index" class="source"><p>{{ objection.reason }}</p><p class="mono">轮次 {{ objection.sequence }} · {{ objection.target }}</p></div>
            </section>
            <form v-if="selected.status === 'PENDING'" @submit.prevent="decide('APPROVED')">
              <label>复核意见（通过与不通过均需填写）<textarea v-model="note" name="note" required maxlength="2000" rows="4" :disabled="busy" /></label>
              <label class="confirmation"><input v-model="confirmed" name="confirmed" type="checkbox" :disabled="busy" />我已核对以上冻结草稿、证据与异议</label>
              <div class="actions"><button data-action="approve" :disabled="!canDecide" type="button" @click="decide('APPROVED')">通过复核</button><button data-action="reject" class="secondary" :disabled="!canDecide" type="button" @click="decide('REJECTED')">不通过</button></div>
            </form>
            <section v-else><h3>复核记录</h3><p>{{ selected.note }}</p><p class="mono">{{ selected.decidedBy }} · {{ selected.decidedAt }}</p><p>已有决定不可覆盖。</p></section>
          </article>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
.review-page { max-width: 1200px; margin: auto; padding: 56px 24px 88px; color: var(--iris-ink); }
.page-heading { border-bottom: 1px solid var(--iris-line); margin-bottom: 24px; padding-bottom: 24px; }
.overline, .mono { font-family: 'JetBrains Mono', Consolas, monospace; overflow-wrap: anywhere; }
.overline { font-size: 11px; letter-spacing: 2px; color: var(--iris-ink-2); }
h1, h2, h3 { font-family: Georgia, 'Songti SC', serif; font-weight: 500; }
h1 { font-size: 40px; margin: 8px 0 16px; } h2 { font-size: 24px; } h3 { font-size: 20px; }
p { line-height: 1.65; } .page-heading > p:last-child, .citation { color: var(--iris-ink-2); }
.responsibility { padding: 16px 20px; background: var(--iris-accent-soft); color: var(--iris-accent-strong); border-radius: var(--iris-radius); }
.inbox-heading, .actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.review-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 32px; margin-top: 24px; }
.panel { padding: 24px; border: 1px solid var(--iris-line); border-radius: var(--iris-radius-lg); background: var(--iris-surface); min-width: 0; }
.task-row { width: 100%; text-align: left; display: grid; gap: 12px; margin-bottom: 12px; }.task-row .mono { font-size: 12px; }
article section { border-top: 1px solid var(--iris-line); padding: 20px 0; }.source { padding: 8px 0; overflow-wrap: anywhere; }
label { display: grid; gap: 8px; margin: 16px 0; } input, textarea { width: 100%; border: 1px solid var(--iris-line-strong); border-radius: var(--iris-radius-sm); padding: 10px; font: inherit; background: var(--iris-surface); color: var(--iris-ink); }
.confirmation { display: flex; align-items: flex-start; gap: 10px; }.confirmation input { width: auto; margin-top: 5px; }
button { border: 1px solid var(--iris-accent); border-radius: var(--iris-radius); padding: 10px 16px; background: var(--iris-accent); color: var(--iris-on-accent); font: inherit; cursor: pointer; }
button.secondary { background: var(--iris-surface); border-color: var(--iris-line-strong); color: var(--iris-ink); }button:disabled { opacity: .5; cursor: default; }
button:not(:disabled):hover { background: var(--iris-accent-strong); }
button.secondary:not(:disabled):hover { background: var(--iris-surface); box-shadow: 0 0 0 1px var(--iris-line-strong); }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 3px; }
.error { color: var(--iris-error); } details .mono { font-size: 12px; } summary { cursor: pointer; }
@media (max-width: 991px) { .review-layout { grid-template-columns: 1fr; }.review-page { padding: 32px 16px 64px; } }
</style>
