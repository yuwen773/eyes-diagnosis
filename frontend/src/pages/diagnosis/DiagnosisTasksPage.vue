<script setup lang="ts">
import { onMounted, ref } from 'vue'
import request from '@/request'

type Task = { taskId: string; status: string }
const tasks = ref<Task[]>([])
const file = ref<File | null>(null)
const requestKey = ref('')
const busy = ref(false)
const message = ref('')

function stateText(status: string): string {
  if (status === 'PROCESSING') return '正在处理'
  if (status === 'WAITING_REVIEW') return '等待后续复核'
  return '暂无法继续'
}

async function refresh() {
  try {
    const response = await request.get('/diagnosis-tasks')
    if (response.data.code !== 0 || !Array.isArray(response.data.data)) throw new Error()
    tasks.value = response.data.data.map((task: Task) => ({ taskId: task.taskId, status: task.status }))
  } catch {
    message.value = '暂时无法获取任务，请稍后刷新。'
  }
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
  message.value = ''
  const form = new FormData()
  form.append('file', file.value)
  form.append('idempotencyKey', requestKey.value)
  try {
    const response = await request.post('/diagnosis-tasks', form)
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
    message.value = '提交未确认，请重试；同一张已选图片会使用相同的请求编号。'
  } finally { busy.value = false }
}

onMounted(refresh)
</script>

<template>
  <main class="task-page">
    <div class="kpi-strip" aria-label="任务信息">
      <div class="kpi-card"><span>服务</span><strong>眼底图片分析</strong></div>
      <div class="kpi-card"><span>支持格式</span><strong>JPG / PNG</strong></div>
      <div class="kpi-card"><span>进度</span><strong>可随时查看</strong></div>
      <div class="kpi-card"><span>展示范围</span><strong>仅展示安全进度</strong></div>
    </div>
    <div class="page-grid">
      <section class="card-accent upload-section">
        <p class="section-overline">01 / 创建任务</p>
        <h1>上传眼底图片</h1>
        <p class="intro">选择一张清晰的眼底图片，提交后可在这里查看处理状态。</p>
        <form @submit.prevent="createTask">
          <label for="fundus-file">选择图片</label>
          <input id="fundus-file" type="file" accept="image/jpeg,image/png" :disabled="busy" @change="selectFile" />
          <p class="hint">支持 JPG、PNG，文件不超过 <span class="numeric">10</span> MB。</p>
          <button type="submit" :disabled="!file || !requestKey || busy">{{ busy ? '正在提交…' : '创建分析任务' }}</button>
        </form>
        <p v-if="message" class="notice" role="status">{{ message }}</p>
      </section>
      <section class="tasks-section" aria-labelledby="tasks-heading">
        <div class="section-top">
          <div><p class="section-overline">02 / 我的任务</p><h2 id="tasks-heading">分析进度</h2></div>
          <button type="button" class="refresh" @click="refresh">刷新状态</button>
        </div>
        <p class="intro">当前仅展示处理进度，不展示未经审核的预测内容。</p>
        <p v-if="tasks.length === 0" class="empty">暂无任务。创建后可在这里查看。</p>
        <div v-for="task in tasks" :key="task.taskId" class="dt-row">
          <div><span class="row-label">任务编号</span><span class="task-id">{{ task.taskId }}</span></div>
          <strong>{{ stateText(task.status) }}</strong>
        </div>
      </section>
    </div>
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
.section-top { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.refresh { background: transparent; color: var(--iris-accent); border: 1px solid var(--iris-line); }
.dt-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 18px 0; border-bottom: 1px solid var(--iris-line); }
.dt-row div { display: grid; gap: 4px; min-width: 0; }
.dt-row strong { font-size: 13px; font-weight: 500; white-space: nowrap; }
.task-id { font-family: var(--iris-font-mono); font-size: 12px; overflow-wrap: anywhere; }
.empty { padding: 24px 0; border-top: 1px solid var(--iris-line); }
@media (max-width: 700px) { .task-page { padding: 20px 18px 60px; } .kpi-strip { grid-template-columns: repeat(2, 1fr); } .kpi-card:nth-child(2) { border-right: 0; } .kpi-card:nth-child(-n+2) { border-bottom: 1px solid var(--iris-line); } .page-grid { grid-template-columns: 1fr; gap: 32px; } }
</style>
