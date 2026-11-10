<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import request from '@/request'
import { useLoginUserStore } from '@/stores/user'
import type { PatientExplanation } from '@/api/patientExplanation'
import type { PatientAuthorization } from '@/api/patientAuthorization'
import MedicalDisclaimer from '@/components/medical/MedicalDisclaimer.vue'
import PatientFollowUpPanel from '@/components/medical/PatientFollowUpPanel.vue'

type Task = { taskId: string; status: string }
const tasks = ref<Task[]>([])
const file = ref<File | null>(null)
const requestKey = ref('')
const busy = ref(false)
const message = ref('')
const users = useLoginUserStore()
const selectedId = ref('')
const presentation = ref<PatientExplanation | null>(null)
const reading = ref(false)
const authorization = ref<PatientAuthorization | null>(null)
const consent = ref(false)
const saving = ref(false)
let identityVersion = 0
let listRequest = 0
let detailRequest = 0
const sectionLabels: Record<string, string> = { MAIN_FINDING: '主要信息', RISK: '风险提示', NEXT_STEP: '下一步', UNCERTAINTY: '不确定性', DETAIL: '详细依据', LIMITATION: '适用限制' }
const stageLabels: Record<string, string> = { QUEUED: '等待处理', IMAGE_ANALYSIS: '图像分析', COLLABORATION: '协作整理', DOCTOR_REVIEW: '等待医生', RESULT: '结果可读', RESTRICTED: '暂无法继续' }
const mainClaims = computed(() => presentation.value?.result?.claims.filter(claim => ['MAIN_FINDING', 'RISK', 'NEXT_STEP'].includes(claim.section)) ?? [])
const detailClaims = computed(() => presentation.value?.result?.claims.filter(claim => ['UNCERTAINTY', 'DETAIL', 'LIMITATION'].includes(claim.section)) ?? [])

function closeDetails() {
  detailRequest++; selectedId.value = ''; presentation.value = null; reading.value = false
  authorization.value = null; consent.value = false; saving.value = false
}

function restrictFollowUps() {
  closeDetails()
  message.value = '无法核对本次追问的最新权限或依据，已关闭旧内容。请重新打开任务。'
}

function stateText(status: string): string {
  if (status === 'PROCESSING') return '正在处理'
  if (status === 'WAITING_REVIEW') return '等待后续复核'
  return '暂无法继续'
}

async function refresh() {
  const current = ++listRequest
  const identity = identityVersion
  closeDetails()
  try {
    const response = await request.get('/diagnosis-tasks')
    if (identity !== identityVersion || current !== listRequest) return
    if (response.data.code !== 0 || !Array.isArray(response.data.data)) throw new Error()
    tasks.value = response.data.data.map((task: Task) => ({ taskId: task.taskId, status: task.status }))
  } catch {
    if (identity === identityVersion && current === listRequest) {
      tasks.value = []; message.value = '暂时无法获取任务，请稍后刷新。'
    }
  }
}

async function open(taskId: string) {
  const current = ++detailRequest
  const identity = identityVersion
  selectedId.value = taskId; presentation.value = null; reading.value = true; message.value = ''
  authorization.value = null; consent.value = false; saving.value = false
  try {
    const response = await request.get(`/diagnosis-tasks/${encodeURIComponent(taskId)}/explanation`)
    if (identity !== identityVersion || current !== detailRequest) return
    const value: PatientExplanation = response.data.data
    if (response.data.code !== 0 || !value || value.taskId !== taskId) throw new Error()
    if (!['AVAILABLE', 'PROCESSING', 'WAITING_REVIEW', 'RESTRICTED'].includes(value.status)) throw new Error()
    presentation.value = { ...value, result: value.status === 'AVAILABLE' ? value.result : null }
  } catch {
    if (identity === identityVersion && current === detailRequest) {
      presentation.value = null; message.value = '无法读取最新结果，请核对任务授权后重新打开。'
    }
  } finally { if (identity === identityVersion && current === detailRequest) reading.value = false }
}

async function prepareSave() {
  if (!selectedId.value || saving.value) return
  const taskId = selectedId.value
  const current = detailRequest
  const identity = identityVersion
  authorization.value = null; consent.value = false; saving.value = true; message.value = ''
  try {
    const response = await request.get(`/diagnosis-tasks/${encodeURIComponent(taskId)}/save-authorization`)
    if (current !== detailRequest || identity !== identityVersion) return
    const value: PatientAuthorization = response.data.data
    if (response.data.code !== 0 || !value || value.taskId !== taskId || !['OFFERED', 'APPROVED', 'RESTRICTED'].includes(value.status)) throw new Error()
    if (value.status === 'OFFERED' && (!value.content?.explanation || !value.authorizationId || !value.contentDigest || !Number.isFinite(Date.parse(value.expiresAt)))) throw new Error()
    authorization.value = value
    if (value.status === 'OFFERED' && value.content) presentation.value = { taskId, status: 'AVAILABLE', stage: 'RESULT', message: '请阅读本次拟保存的辅助说明。', workNotes: [], result: value.content.explanation }
    if (value.status === 'RESTRICTED') { presentation.value = null; message.value = '本次内容已受限，无法授权保存。' }
  } catch {
    if (current === detailRequest && identity === identityVersion) { presentation.value = null; message.value = '无法确认拟保存内容，请重新打开任务。' }
  } finally { if (current === detailRequest && identity === identityVersion) saving.value = false }
}

async function approveSave() {
  const offer = authorization.value
  if (!offer || offer.status !== 'OFFERED' || !consent.value || saving.value) return
  if (Date.parse(offer.expiresAt) <= Date.now()) {
    authorization.value = null; consent.value = false; presentation.value = null; message.value = '授权内容已过期，请重新打开任务。'; return
  }
  const current = detailRequest
  const identity = identityVersion
  saving.value = true; message.value = ''
  try {
    const response = await request.post(`/diagnosis-tasks/${encodeURIComponent(offer.taskId)}/save-authorization/approve`, {
      authorizationId: offer.authorizationId, expectedTaskVersion: offer.taskVersion, expectedDraftVersion: offer.draftVersion,
      expectedEvidenceVersion: offer.evidenceVersion, expectedContentDigest: offer.contentDigest,
    })
    if (current !== detailRequest || identity !== identityVersion) return
    const value: PatientAuthorization = response.data.data
    if (response.data.code !== 0 || value?.taskId !== offer.taskId || value.authorizationId !== offer.authorizationId || value.status !== 'APPROVED'
      || !value.receipt?.receiptId || value.receipt.taskId !== offer.taskId || value.receipt.contentDigest !== offer.contentDigest) throw new Error()
    authorization.value = value; consent.value = false
  } catch {
    if (current === detailRequest && identity === identityVersion) {
      authorization.value = null; consent.value = false; presentation.value = null
      message.value = '保存未确认，请重新打开任务并查询保存状态与回执；重复批准不会创建重复记录。'
    }
  } finally { if (current === detailRequest && identity === identityVersion) saving.value = false }
}

function selectFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  if (file.value && typeof globalThis.crypto !== 'undefined') {
    const random = crypto.getRandomValues(new Uint8Array(16))
    requestKey.value = Array.from(random, value => value.toString(16).padStart(2, '0')).join('')
  } else {
    requestKey.value = ''
    if (file.value) message.value = '当前浏览器无法安全生成请求编号，请更换浏览器。'
  }
  if (requestKey.value || !file.value) message.value = ''
}

async function createTask() {
  if (!file.value || !requestKey.value || busy.value) return
  busy.value = true
  const identity = identityVersion
  message.value = ''
  const form = new FormData()
  form.append('file', file.value)
  form.append('idempotencyKey', requestKey.value)
  try {
    const response = await request.post('/diagnosis-tasks', form)
    if (identity !== identityVersion) return
    if (response.data.code === 40000) {
      message.value = '图片无效，请选择有效的 JPG 或 PNG 图片。'
      return
    }
    if (response.data.code !== 0) throw new Error()
    file.value = null
    requestKey.value = ''
    const input = document.getElementById('fundus-file') as HTMLInputElement | null
    if (input) input.value = ''
    message.value = '任务已创建，可在下方查看进度。'
    await refresh()
  } catch {
    if (identity === identityVersion) message.value = '提交未确认，请重试；同一张已选图片会使用相同的请求编号。'
  } finally { if (identity === identityVersion) busy.value = false }
}

watch(() => `${users.loginUser.id}:${users.loginUser.userRole}`, () => {
  identityVersion++; listRequest++; closeDetails(); tasks.value = []; file.value = null; requestKey.value = ''; message.value = ''; busy.value = false
  if (users.loginUser.id) void refresh()
}, { immediate: true })
onUnmounted(() => { identityVersion++; listRequest++; detailRequest++ })
</script>

<template>
  <main class="task-page">
    <div class="kpi-strip" aria-label="任务信息">
      <div class="kpi-card"><span>服务</span><strong>眼底图片分析</strong></div>
      <div class="kpi-card"><span>支持格式</span><strong>JPG / PNG</strong></div>
      <div class="kpi-card"><span>进度</span><strong>可随时查看</strong></div>
      <div class="kpi-card"><span>展示范围</span><strong>安全进度与获准结果</strong></div>
    </div>
    <div class="page-grid">
      <section class="card-accent upload-section">
        <p class="section-overline">01 / 创建任务</p>
        <h1>上传眼底图片</h1>
        <p class="intro">选择一张清晰的眼底图片，提交后可在这里查看处理状态。</p>
        <form @submit.prevent="createTask">
          <label for="fundus-file">选择图片</label>
          <input id="fundus-file" :key="identityVersion" type="file" accept="image/jpeg,image/png" :disabled="busy" @change="selectFile" />
          <p class="hint">支持 JPG、PNG，文件不超过 <span class="numeric">10</span> MB。</p>
          <button type="submit" :disabled="!file || !requestKey || busy">{{ busy ? '正在提交…' : '创建分析任务' }}</button>
        </form>
      </section>
      <section class="tasks-section" aria-labelledby="tasks-heading">
        <div class="section-top">
          <div><p class="section-overline">02 / 我的任务</p><h2 id="tasks-heading">分析进度</h2></div>
          <button type="button" class="refresh" @click="refresh">刷新状态</button>
        </div>
        <p class="intro">可查看安全处理进度。医生复核及读取检查通过后，可打开分层辅助说明。</p>
        <p v-if="tasks.length === 0" class="empty">暂无任务。创建后可在这里查看。</p>
        <div v-for="task in tasks" :key="task.taskId" class="dt-row">
          <div><span class="row-label">任务编号</span><span class="task-id">{{ task.taskId }}</span></div>
          <strong>{{ stateText(task.status) }}</strong>
          <button type="button" class="refresh" data-action="open" @click="open(task.taskId)">查看进度与结果</button>
        </div>
      </section>
    </div>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <section v-if="selectedId" class="explanation" aria-labelledby="explanation-heading" aria-live="polite" :aria-busy="reading">
      <div class="section-top">
        <div><p class="section-overline">03 / 本次任务</p><h2 id="explanation-heading">进度与辅助说明</h2></div>
        <button type="button" class="refresh" data-action="close" @click="closeDetails">关闭</button>
      </div>
      <p class="task-id">{{ selectedId }}</p>
      <p v-if="reading" class="intro">正在检查任务权限与最新来源…</p>
      <template v-if="presentation">
        <h3>{{ stageLabels[presentation.stage] || '暂无法继续' }}</h3>
        <p>{{ presentation.message }}</p>
        <ul v-if="presentation.workNotes.length" class="work-notes"><li v-for="(note, index) in presentation.workNotes" :key="index">{{ note }}</li></ul>
        <template v-if="presentation.status === 'AVAILABLE' && presentation.result">
          <p class="responsibility">{{ presentation.result.disclaimer }}</p>
          <section v-for="claim in mainClaims" :key="claim.id" class="claim">
            <h3>{{ sectionLabels[claim.section] }}</h3><p>{{ claim.text }}</p>
          </section>
          <details :key="`${selectedId}:${detailRequest}`" class="supporting-details">
            <summary>展开依据、不确定性与适用限制</summary>
            <p class="intro">{{ presentation.result.calibrationNotice }}</p>
            <section v-for="claim in detailClaims" :key="claim.id" class="claim">
              <h3>{{ sectionLabels[claim.section] }}</h3><p>{{ claim.text }}</p>
            </section>
            <section class="claim"><h3>逐条依据</h3>
              <div v-for="claim in presentation.result.claims" :key="claim.id" class="source">
                <p>{{ sectionLabels[claim.section] }}：{{ claim.text }}</p>
                <p v-for="(reference, index) in claim.references" :key="index" class="intro">来源 <span class="numeric">{{ reference.citationIndex + 1 }}</span>：“{{ reference.quote }}”</p>
              </div>
            </section>
            <section class="claim"><h3>受控来源</h3>
              <div v-for="source in presentation.result.sources" :key="source.citationIndex" class="source">
                <h4><span class="numeric">{{ source.citationIndex + 1 }}</span> · {{ source.title }}</h4>
                <p>{{ source.excerpt }}</p><p class="intro">{{ source.source }}</p>
                <p class="task-id">文档版本 {{ source.documentVersion }} · 治理版本 {{ source.governanceVersion }}</p>
              </div>
            </section>
            <p class="task-id">模型 {{ presentation.result.modelVersion || '未提供' }} · 预处理 {{ presentation.result.preprocessVersion || '未提供' }}</p>
          </details>
          <MedicalDisclaimer scope="review" :model-version="presentation.result.modelVersion" />
          <PatientFollowUpPanel :key="`${identityVersion}:${detailRequest}`" :task-id="selectedId" :disabled="saving" @restricted="restrictFollowUps" />
        </template>
      </template>
      <section v-if="presentation?.status === 'AVAILABLE' || authorization?.receipt" class="save-authorization" aria-labelledby="save-heading">
        <h3 id="save-heading">由你决定是否保存</h3>
        <p class="intro">医生复核与保存授权相互独立。只有你明确同意后，才会创建正式记录；模型预测并非确诊。</p>
        <button v-if="!authorization" type="button" :disabled="saving" data-action="prepare-save" @click="prepareSave">{{ saving ? '正在检查…' : '查看拟保存内容或查询回执' }}</button>
        <template v-if="authorization?.status === 'OFFERED'">
          <p class="intro">上方展示的是本次拟保存的完整辅助说明及来源，请阅读后决定。</p>
          <p v-if="authorization.content">拟保存的模型预测：{{ authorization.content.modelPrediction }}；原始模型概率 <span class="numeric">{{ authorization.content.modelProbability }}%</span>。概率不代表临床可靠性，模型预测并非确诊。</p>
          <p>本次授权有效期至 <time class="numeric">{{ new Date(authorization.expiresAt).toLocaleString() }}</time></p>
          <label class="consent"><input v-model="consent" type="checkbox" :disabled="saving" />我已阅读本次内容，同意将其保存为我的正式诊断辅助记录。</label>
          <button type="button" :disabled="!consent || saving" data-action="approve-save" @click="approveSave">{{ saving ? '正在保存…' : '同意并保存' }}</button>
        </template>
        <div v-if="authorization?.status === 'APPROVED' && authorization.receipt" role="status">
          <p>已授权保存，可使用下方唯一回执核对本次记录。</p>
          <p class="task-id">回执 {{ authorization.receipt.receiptId }}</p>
          <p class="task-id">记录 {{ authorization.receipt.diagnosisId }} · 保存时间 {{ new Date(authorization.receipt.authorizedAt).toLocaleString() }}</p>
        </div>
      </section>
      <button v-if="selectedId && presentation?.status !== 'AVAILABLE' && !authorization?.receipt && !reading" type="button" class="refresh" :disabled="saving" @click="prepareSave">查询保存状态与回执</button>
    </section>
  </main>
</template>

<style scoped>
.task-page { max-width: 1200px; margin: 0 auto; padding: 32px 32px 80px; color: var(--iris-ink); }
.kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--iris-line); background: var(--iris-surface); }
.kpi-card { padding: 20px; border-right: 1px solid var(--iris-line); display: grid; gap: 8px; }
.kpi-card:last-child { border-right: 0; }
.kpi-card span, .row-label { font-size: 12px; color: var(--iris-ink-3); }
.kpi-card strong { font-weight: 500; }
.page-grid { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(320px, 1.2fr); gap: 40px; margin-top: 48px; align-items: start; }
.upload-section { background: var(--iris-surface); border: 1px solid var(--iris-line); border-top: 3px solid var(--iris-accent); padding: 28px; }
.section-overline { font-family: var(--iris-font-mono); font-size: 11px; letter-spacing: .08em; color: var(--iris-accent); }
h1, h2 { font-family: var(--iris-font-serif); font-weight: 600; margin: 8px 0 12px; }
h1 { font-size: 28px; } h2 { font-size: 24px; }
.intro, .hint, .notice, .empty { color: var(--iris-ink-2); line-height: 1.7; font-size: 14px; }
form { display: grid; gap: 12px; margin-top: 24px; }
input { max-width: 100%; color: var(--iris-ink-2); }
.hint { margin: 0; font-size: 12px; }
.numeric { font-family: var(--iris-font-mono); }
button { cursor: pointer; border: 0; border-radius: 5px; padding: 11px 16px; background: var(--iris-accent); color: var(--iris-on-accent); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:hover:not(:disabled) { background: var(--iris-accent-strong); }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 3px; }
.section-top { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.refresh { background: transparent; color: var(--iris-accent); border: 1px solid var(--iris-line); }
.refresh:hover:not(:disabled) { background: var(--iris-accent-soft); }
.dt-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 18px 0; border-bottom: 1px solid var(--iris-line); }
.dt-row div { display: grid; gap: 4px; min-width: 0; }
.dt-row strong { font-size: 13px; font-weight: 500; white-space: nowrap; }
.task-id { font-family: var(--iris-font-mono); font-size: 12px; overflow-wrap: anywhere; }
.empty { padding: 24px 0; border-top: 1px solid var(--iris-line); }
.explanation { margin-top: 48px; border: 1px solid var(--iris-line); border-top: 3px solid var(--iris-accent); border-radius: var(--iris-radius); padding: 28px; background: var(--iris-surface); overflow-wrap: anywhere; }
.explanation h3 { font-family: var(--iris-font-serif); font-size: 20px; font-weight: 500; }
.explanation p, .work-notes { line-height: 1.7; }
.work-notes { color: var(--iris-ink-2); padding-left: 20px; }
.responsibility { padding: 16px; background: var(--iris-accent-soft); color: var(--iris-accent-strong); border-radius: var(--iris-radius); }
.claim { padding: 12px 0; border-top: 1px solid var(--iris-line); }
.supporting-details { margin: 24px 0; border-block: 1px solid var(--iris-line); padding: 18px 0; }
summary { cursor: pointer; color: var(--iris-accent); line-height: 1.6; }
.source { padding: 10px 0; border-bottom: 1px solid var(--iris-line); }
.source h4 { font-weight: 500; }
.save-authorization { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--iris-line); }
.save-authorization button { border-radius: var(--iris-radius); }
.consent { display: flex; gap: 12px; align-items: start; line-height: 1.7; margin: 20px 0; }
.consent input { margin-top: 6px; accent-color: var(--iris-accent); }
@media (max-width: 700px) { .task-page { padding: 20px 18px 60px; } .kpi-strip { grid-template-columns: repeat(2, 1fr); } .kpi-card:nth-child(2) { border-right: 0; } .kpi-card:nth-child(-n+2) { border-bottom: 1px solid var(--iris-line); } .page-grid { grid-template-columns: 1fr; gap: 32px; } .dt-row { flex-wrap: wrap; } .dt-row > div { flex-basis: 100%; } .explanation { padding: 20px; } }
</style>
