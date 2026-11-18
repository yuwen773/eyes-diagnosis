<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useLoginUserStore } from '@/stores/user'
import {
  draftTestTrace,
  listDraftTestTasks,
  runDraftTest,
  seedDraftTestTask,
  type DraftAttempt,
  type DraftTestRole,
  type DraftTestTask,
  type DraftTestTrace,
} from '@/api/patientDraftTest'
import TraceValue from './components/TraceValue.vue'

const users = useLoginUserStore()
const isAdmin = computed(() => users.loginUser.userRole === 'admin')
const tasks = ref<DraftTestTask[]>([])
const selectedTaskId = ref('')
const trace = ref<DraftTestTrace | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
let epoch = 0
let timer: number | undefined

const taskStatusLabel: Record<string, string> = {
  WAITING_REVIEW: '等待整理', DRAFTING: '整理中', RESTRICTED: '受限', PUBLISHED: '已发布',
}
const runStatusLabel: Record<string, string> = {
  RUNNING: '执行中', REVIEW_READY: '可复核', RESTRICTED: '受限',
}
const roleLabel: Record<string, string> = {
  VISION: '图像信息整理', EVIDENCE: '受控资料检索', EXPLANATION: '分层说明生成', CRITIC: '一致性检查',
}
const stateLabel: Record<string, string> = { STARTED: '进行中', COMPLETED: '已完成', STOPPED: '已停止' }
/** 每个角色的职责边界；写死在页面上，避免操作者从输出反推权限。 */
const roleDuty: Record<string, string> = {
  VISION: '只读既有推理摘要与质量限制，给出摘要、限制与再分析建议；不新增视觉发现。',
  EVIDENCE: '生成检索查询；疾病与主题由服务端绑定，模型不能改变检索范围。',
  EXPLANATION: '基于冻结证据写分层说明，每条声明必须引用片段的精确原文。',
  CRITIC: '独立检查草稿与证据，只能提出可定位的异议，不能发布或批准。',
}
const sectionLabel: Record<string, string> = {
  MAIN_FINDING: '主要发现', RISK: '风险提示', NEXT_STEP: '下一步', UNCERTAINTY: '不确定性',
  DETAIL: '详细依据', LIMITATION: '适用限制',
}
/** 传输层故障与模型输出故障分开描述：前者查凭据/配额/网络，后者改生成约束。 */
const stopReason: Record<string, { title: string; hint: string }> = {
  MESSAGE_CONFLICT: { title: '协作消息版本冲突', hint: '消息与当前草稿或证据版本不一致，已停止协作。' },
  INVALID_MESSAGE_ROUTE: { title: '协作消息路由无效', hint: '角色消息超出允许的收件范围，已停止协作。' },
  PROVIDER_AUTH: { title: '模型服务鉴权失败', hint: '检查模型凭据是否有效；已预扣调用数不会退还。' },
  PROVIDER_RATE_LIMIT: { title: '模型服务限流', hint: '提供方返回 429，稍后重试或调整配额，不是生成质量问题。' },
  PROVIDER_UNAVAILABLE: { title: '模型服务不可用', hint: '出现了 5xx 或连接/读取失败；核对网络与提供方状态后重试。' },
  INVALID_OUTPUT: { title: '输出不符合契约', hint: '模型返回的内容无法解析或缺少必需字段，属于生成可靠性问题。' },
  INVALID_CITATION: { title: '引用不是连续原文', hint: '引文未在冻结片段中逐字出现（常见于拼接、省略号或改写），草稿未被保存。' },
  INVALID_OBJECTION: { title: '异议指向无法定位', hint: 'Critic 的异议目标不在 claim/证据索引/Vision 摘要中。' },
  INSUFFICIENT_EVIDENCE: { title: '没有合格受控资料', hint: '检索未命中资格有效的资料，未进入解释生成。' },
  SOURCE_INVALIDATED: { title: '资料资格失效', hint: '冻结来源在复核时已撤回或版本变化，需要重新走资料审批。' },
  FEEDBACK_LIMIT: { title: '补证与重写次数用尽', hint: 'Critic 再次要求补证/重写，已按一次性限制停止。' },
  AGENT_TIMEOUT: { title: '单次调用超时', hint: '单次调用超过预算（默认 20 秒），常见于未关闭 thinking 的模型配置。' },
  TOTAL_TIMEOUT: { title: '总时限用尽', hint: '整个任务的 90 秒预算已耗尽。' },
  CALL_BUDGET: { title: '调用次数用尽', hint: '已达每任务 8 次的调用上限。' },
  MODEL_BUSY: { title: '模型执行队列已满', hint: '并发调用被拒绝；已预扣调用数不会退还。' },
  INTERRUPTED: { title: '调用被中断', hint: '执行线程被中断，属于进程侧问题。' },
  INTERRUPTED_OR_TIMEOUT: { title: '进程中断后恢复', hint: '上次运行未收尾，按截止时间判定为中断，不重跑模型。' },
  STALE_EXECUTOR: { title: '过期执行者', hint: '运行记录已不是 RUNNING，本次写入被拒绝。' },
  INVALID_INFERENCE: { title: '上游推理未通过门禁', hint: 'OOD、质量或标签校验失败，未发起任何模型调用。' },
}
const providerFault = computed(() => (trace.value?.stopReason ?? '').startsWith('PROVIDER_'))
const reason = computed(() => (trace.value?.stopReason ? stopReason[trace.value.stopReason] ?? null : null))

const selectedTask = computed(() => tasks.value.find(task => task.taskId === selectedTaskId.value) ?? null)
const canRun = computed(() =>
  isAdmin.value && !busy.value && !!selectedTask.value && selectedTask.value.runStatus === null
  && ['WAITING_REVIEW', 'DRAFTING'].includes(selectedTask.value.status))

const seedLabels = [
  { value: 'glaucoma', text: '青光眼' },
  { value: 'cataract', text: '白内障' },
  { value: 'amd', text: '黄斑变性' },
  { value: 'diabetes', text: '糖尿病视网膜病变' },
  { value: 'hypertension', text: '高血压视网膜病变' },
  { value: 'myopia', text: '近视' },
  { value: 'normal', text: '正常眼底' },
  { value: 'other', text: '其他眼底改变' },
]
const seedLabel = ref('glaucoma')

function seconds(millis: number | null) {
  return millis === null ? '—' : `${(millis / 1000).toFixed(1)} s`
}

function pretty(value: unknown) {
  return value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)
}

/** 一眼能看懂该角色这次做了什么；原始 JSON 留在可展开的输入/输出里。 */
function resultHeadline(role: DraftTestRole) {
  const result = role.result
  if (!result) return role.state === 'STOPPED' ? '未产出结果（已停止）' : '未产出结果'
  const length = (value: unknown) => Array.isArray(value) ? value.length : 0
  const search = result.search as { query?: unknown } | null
  switch (role.role) {
    case 'VISION': return String(result.summary ?? '—')
    case 'EVIDENCE': return `检索查询「${search?.query ?? '—'}」 · ${length(result.citations)} 条片段`
    case 'EXPLANATION': return `草稿 ${length(result.claims)} 条声明 · 证据版本 ${result.evidenceVersion ?? '—'}`
    case 'CRITIC': return result.action === 'NONE'
      ? '无异议（NONE）'
      : `${result.action} · ${length(result.objections)} 条异议`
    default: return '—'
  }
}

function criticObjections(role: DraftTestRole) {
  const objections = role.result?.objections
  return Array.isArray(objections) ? objections as { target?: string; reason?: string }[] : []
}

function visionLimitations(role: DraftTestRole) {
  const limitations = role.result?.limitations
  return Array.isArray(limitations) ? limitations.map(String) : []
}

function stopPolling() {
  if (timer !== undefined) { window.clearInterval(timer); timer = undefined }
}

async function loadTasks() {
  const current = epoch
  busy.value = true
  try {
    const result = await listDraftTestTasks()
    if (current === epoch) tasks.value = result
  } catch {
    if (current === epoch) error.value = '无法读取任务列表，请确认后端已开启试验台入口。'
  } finally { if (current === epoch) busy.value = false }
}

async function seed() {
  if (busy.value) return
  const current = epoch
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const taskId = await seedDraftTestTask(seedLabel.value)
    if (current !== epoch) return
    notice.value = '已生成合成任务与合成资料；资料标题与来源标注为 SYNTHETIC（非真实医学来源），不能用于临床判断。'
    await loadTasks()
    const created = tasks.value.find(task => task.taskId === taskId)
    if (created) await selectTask(created)
  } catch {
    if (current === epoch) error.value = '生成失败：后端可能未开启 allow-seed 开关，或当前账号不是管理员。'
  } finally { if (current === epoch) busy.value = false }
}

async function selectTask(task: DraftTestTask) {
  if (busy.value) return
  stopPolling()
  const current = ++epoch
  selectedTaskId.value = task.taskId
  trace.value = null; error.value = ''; notice.value = ''
  busy.value = true
  try {
    const result = await draftTestTrace(task.taskId)
    if (current !== epoch) return
    trace.value = result
    if (result.status === 'RUNNING') poll(task.taskId, current)
  } catch {
    if (current === epoch) error.value = '无法读取该任务的运行轨迹。'
  } finally { if (current === epoch) busy.value = false }
}

async function run() {
  if (!canRun.value || !selectedTask.value) return
  const taskId = selectedTask.value.taskId
  const current = epoch
  stopPolling()
  busy.value = true; error.value = ''; notice.value = '已开始执行；同一任务重复触发不会增加模型调用。'
  try {
    const result = await runDraftTest(taskId)
    if (current === epoch) { trace.value = result; poll(taskId, current) }
  } catch {
    if (current === epoch) error.value = '触发失败：可能已有手动任务在执行，或该任务已运行过。'
  } finally { if (current === epoch) busy.value = false }
}

function poll(taskId: string, current: number) {
  stopPolling()
  timer = window.setInterval(async () => {
    try {
      const result = await draftTestTrace(taskId)
      if (current !== epoch) return
      trace.value = result
      if (result.status !== 'RUNNING') {
        stopPolling()
        tasks.value = tasks.value.map(task => task.taskId === taskId
          ? { ...task, runStatus: result.status, stopReason: result.stopReason, calls: result.calls }
          : task)
        notice.value = result.status === 'REVIEW_READY' ? '四角色已完成，草稿进入等待医生复核。' : '运行已停止，原因见下方。'
      }
    } catch {
      if (current === epoch) { error.value = '轮询运行轨迹失败。'; stopPolling() }
    }
  }, 1000)
}

function unmatched(attempt: DraftAttempt) {
  return attempt.claims.flatMap(claim => claim.references.filter(reference => !reference.matched)).length
}

watch(() => `${users.loginUser.id}:${users.loginUser.userRole}`, () => {
  epoch++
  stopPolling()
  tasks.value = []; selectedTaskId.value = ''; trace.value = null
  error.value = ''; notice.value = ''; busy.value = false
  if (isAdmin.value) void loadTasks()
}, { immediate: true })

onBeforeUnmount(stopPolling)
</script>

<template>
  <main class="draft-test-page">
    <header class="page-heading">
      <p class="overline">OPERATOR CONSOLE</p>
      <h1>四 Agent 试验台</h1>
      <p>手动触发一次草稿协作，观察每个角色收到的上下文、产出的结果、耗时与引用校验。页面不显示原始推理快照，也不批准或发布任何结果。</p>
    </header>
    <p v-if="!isAdmin" role="alert">此入口仅对管理员开放。</p>
    <template v-else>
      <p class="responsibility">试验台与后台轮询调用同一个协调器：每任务最多 8 次模型调用、总时限 90 秒、单次 20 秒。重复触发同一任务不会增加调用。</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>

      <div class="layout">
        <nav aria-label="可试验任务">
          <div class="panel-heading">
            <h2>任务</h2>
            <button class="secondary" type="button" :disabled="busy" @click="loadTasks">刷新</button>
          </div>
          <div class="seed">
            <label>合成任务
              <select v-model="seedLabel" :disabled="busy" aria-label="合成任务标签">
                <option v-for="item in seedLabels" :key="item.value" :value="item.value">{{ item.text }}</option>
              </select>
            </label>
            <button class="secondary" type="button" :disabled="busy" data-action="seed" @click="seed">生成</button>
          </div>
          <p class="muted seed-hint">合成任务与合成资料写入当前数据库，标注为 SYNTHETIC（非真实医学来源）；需后端同时开启 allow-seed。</p>
          <p v-if="!tasks.length" class="muted">没有可展示的任务。可先生成合成任务，或等待真实图片分析完成上游门禁。</p>
          <button
            v-for="task in tasks" :key="task.taskId" class="task-row"
            :class="{ active: task.taskId === selectedTaskId }"
            type="button" :disabled="busy" data-action="select-task" @click="selectTask(task)"
          >
            <span>{{ taskStatusLabel[task.status] || task.status }}</span>
            <span class="mono task-id">{{ task.taskId }}</span>
            <span v-if="task.runStatus" class="mono badge">{{ runStatusLabel[task.runStatus] || task.runStatus }}</span>
          </button>
        </nav>

        <article class="panel" aria-label="运行轨迹">
          <p v-if="!trace" class="muted">选择左侧任务后查看轨迹；未运行的任务可以直接触发。</p>
          <template v-else>
            <div class="panel-heading">
              <h2>运行轨迹</h2>
              <span class="mono badge">{{ trace.status ? (runStatusLabel[trace.status] || trace.status) : '未运行' }}</span>
            </div>
            <dl class="kpis">
              <div><dt>角色</dt><dd class="mono">{{ trace.roles.length }}</dd></div>
              <div><dt>模型调用</dt><dd class="mono">{{ trace.calls }} / {{ trace.budget.maxCalls }}</dd></div>
              <div><dt>耗时</dt><dd class="mono">{{ seconds(trace.elapsedMs) }}</dd></div>
              <div><dt>预测标签</dt><dd class="mono">{{ trace.predictedLabel || '—' }}</dd></div>
            </dl>

            <section v-if="reason" class="stop-reason" :class="{ provider: providerFault }">
              <p class="overline">{{ providerFault ? 'PROVIDER FAULT' : 'STOP REASON' }}</p>
              <h3>{{ trace.stopReason }} · {{ reason.title }}</h3>
              <p>{{ reason.hint }}</p>
            </section>

            <section>
              <h3>协作轨迹</h3>
              <p class="muted">按调用顺序列出每个角色实际收到的上下文与产出；内容不含推理快照、对象地址或患者身份。</p>
              <ol class="trace-list">
                <li v-for="role in trace.roles" :key="role.sequence" class="trace-role" :data-state="role.state">
                  <div class="trace-head">
                    <span class="mono seq">#{{ role.sequence }}</span>
                    <h4>{{ roleLabel[role.role] || role.role }}</h4>
                    <span class="state" :data-state="role.state">{{ stateLabel[role.state] || role.state }}</span>
                    <span class="mono elapsed">{{ seconds(role.elapsedMs) }}</span>
                  </div>
                  <p class="duty muted">{{ roleDuty[role.role] }}</p>
                  <p v-if="role.role !== 'VISION' || !role.result" class="headline">{{ resultHeadline(role) }}</p>
                  <ul v-if="role.role === 'VISION' && visionLimitations(role).length" class="extras">
                    <li v-for="item in visionLimitations(role)" :key="item">{{ item }}</li>
                  </ul>
                  <ul v-if="role.role === 'CRITIC' && criticObjections(role).length" class="extras">
                    <li v-for="(objection, index) in criticObjections(role)" :key="index">
                      <span class="mono">{{ objection.target }}</span>
                      <template v-if="objection.reason"> · {{ objection.reason }}</template>
                    </li>
                  </ul>
                  <div class="io">
                    <div class="io-panel">
                      <p class="overline">收到（输入）· INPUT</p>
                      <TraceValue :value="role.context" />
                      <details class="raw">
                        <summary>原始 JSON</summary>
                        <pre class="mono">{{ pretty(role.context) }}</pre>
                      </details>
                    </div>
                    <div class="io-panel">
                      <p class="overline">产出（输出）· OUTPUT</p>
                      <TraceValue :value="role.result" />
                      <details class="raw">
                        <summary>原始 JSON</summary>
                        <pre class="mono">{{ pretty(role.result) }}</pre>
                      </details>
                    </div>
                  </div>
                  <p class="mono started">开始 {{ role.startedAt || '—' }}</p>
                </li>
              </ol>
              <p class="muted">预算：单次 {{ (trace.budget.callMillis / 1000).toFixed(0) }} 秒 · 总时限 {{ (trace.budget.totalMillis / 1000).toFixed(0) }} 秒。</p>
            </section>

            <section>
              <h3>冻结证据</h3>
              <p v-if="!trace.evidence.length" class="muted">尚未冻结证据。</p>
              <div v-for="version in trace.evidence" :key="version.version" class="evidence">
                <p class="mono">证据版本 {{ version.version }} · {{ version.citations.length }} 条片段</p>
                <div v-for="citation in version.citations" :key="`${version.version}-${citation.index}`">
                  <h4><span class="mono">{{ citation.index + 1 }}.</span> {{ citation.title }}</h4>
                  <p>{{ citation.excerpt }}</p>
                  <p class="muted mono">{{ citation.source }} · 片段 {{ citation.chunkIndex }}</p>
                </div>
              </div>
            </section>

            <section>
              <h3>解释草稿与引用校验</h3>
              <p v-if="!trace.attempts.length" class="muted">没有可展示的解释输出。</p>
              <div v-for="attempt in trace.attempts" :key="attempt.sequence" class="attempt">
                <div class="panel-heading">
                  <p class="mono">第 {{ attempt.sequence }} 次调用 · 证据版本 {{ attempt.evidenceVersion }}</p>
                  <span class="badge" :class="attempt.saved ? 'ok' : 'bad'">
                    {{ attempt.saved ? '已保存' : `未保存 · ${unmatched(attempt)} 条引用不符` }}
                  </span>
                </div>
                <p v-if="!attempt.allSectionsPresent" class="error">缺少区段：{{ attempt.missingSections.join('、') }}</p>
                <div v-for="claim in attempt.claims" :key="claim.id" class="claim">
                  <h4>{{ sectionLabel[claim.section] || claim.section }}<span class="mono seq">{{ claim.id }}</span></h4>
                  <p>{{ claim.text }}</p>
                  <p v-for="reference in claim.references" :key="`${claim.id}-${reference.citationIndex}`" class="citation">
                    <span class="mono" :class="reference.matched ? 'ok' : 'bad'">
                      {{ reference.matched ? '✓' : '✗' }} 依据 {{ reference.citationIndex + 1 }}
                    </span>
                    “{{ reference.quote }}”
                  </p>
                </div>
              </div>
            </section>

            <section v-if="canRun">
              <button type="button" :disabled="!canRun" data-action="run" @click="run">触发一次协作</button>
              <p class="muted">触发后页面每秒刷新；模型调用会产生真实费用。</p>
            </section>
            <p v-else-if="trace.status === null" class="muted">该任务已运行过或状态不满足触发条件，协调器不会重复消耗调用。</p>
          </template>
        </article>
      </div>
    </template>
  </main>
</template>

<style scoped>
.draft-test-page { max-width: 1200px; margin: auto; padding: 56px 24px 88px; color: var(--iris-ink); }
.page-heading { border-bottom: 1px solid var(--iris-line); margin-bottom: 24px; padding-bottom: 24px; }
.overline, .mono { font-family: 'JetBrains Mono', Consolas, monospace; overflow-wrap: anywhere; }
.overline { font-size: 11px; letter-spacing: 2px; color: var(--iris-ink-2); }
h1, h2, h3, h4 { font-family: Georgia, 'Songti SC', serif; font-weight: 500; }
h1 { font-size: 40px; margin: 8px 0 16px; } h2 { font-size: 24px; margin: 0; } h3 { font-size: 20px; margin: 24px 0 12px; } h4 { font-size: 16px; margin: 16px 0 8px; }
p { line-height: 1.65; } .page-heading > p:last-child, .muted { color: var(--iris-ink-2); }
.responsibility { padding: 16px 20px; background: var(--iris-accent-soft); color: var(--iris-accent-strong); border-radius: var(--iris-radius); }
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 32px; margin-top: 24px; }
.panel { padding: 24px; border: 1px solid var(--iris-line); border-radius: var(--iris-radius-lg); background: var(--iris-surface); min-width: 0; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.task-row { width: 100%; text-align: left; display: grid; gap: 6px; margin-bottom: 12px; padding: 12px 14px; border: 1px solid var(--iris-line); border-radius: var(--iris-radius); background: var(--iris-surface); color: var(--iris-ink); font: inherit; cursor: pointer; }
.seed { display: flex; align-items: end; gap: 8px; margin: 12px 0 6px; }
.seed label { display: grid; gap: 4px; font-size: 12px; color: var(--iris-ink-2); flex: 1; min-width: 0; }
.seed select { width: 100%; border: 1px solid var(--iris-line-strong); border-radius: var(--iris-radius-sm); padding: 8px; font: inherit; background: var(--iris-surface); color: var(--iris-ink); }
.seed-hint { font-size: 12px; }
.task-row.active { box-shadow: 0 0 0 1px var(--iris-line-strong); background: var(--iris-surface-2); }
.task-id { font-size: 12px; color: var(--iris-ink-2); }
.badge { font-size: 11px; letter-spacing: .5px; padding: 2px 8px; border-radius: var(--iris-radius-sm); background: var(--iris-accent-soft); color: var(--iris-accent-strong); }
.badge.bad { background: var(--iris-sev-high-soft); color: var(--iris-sev-high); }
.badge.ok { background: var(--iris-sev-low-soft); color: var(--iris-sev-low); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; margin: 20px 0; padding: 16px 0; border-top: 1px solid var(--iris-line); border-bottom: 1px solid var(--iris-line); }
.kpis dt { font-size: 12px; color: var(--iris-ink-3); } .kpis dd { margin: 4px 0 0; font-size: 24px; }
.stop-reason { margin-top: 20px; padding: 16px 20px; border-radius: var(--iris-radius); background: var(--iris-sev-high-soft); color: var(--iris-sev-high); }
.stop-reason.provider { background: var(--iris-surface-2); color: var(--iris-ink); box-shadow: inset 0 0 0 1px var(--iris-line-strong); }
.stop-reason h3 { margin: 4px 0 8px; }
section { border-top: 1px solid var(--iris-line); padding-top: 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; font-weight: 500; color: var(--iris-ink-3); padding: 8px 8px; border-bottom: 1px solid var(--iris-line); }
td { padding: 10px 8px; border-bottom: 1px solid var(--iris-line); vertical-align: top; }
.state { font-size: 12px; }
.state[data-state='COMPLETED'] { color: var(--iris-sev-low); } .state[data-state='STOPPED'] { color: var(--iris-sev-high); } .state[data-state='STARTED'] { color: var(--iris-sev-moderate); }
.seq { font-size: 11px; color: var(--iris-ink-3); margin-left: 8px; }
.trace-list { list-style: none; margin: 8px 0 0; padding: 0; }
.trace-role { position: relative; padding: 4px 0 22px 26px; border-left: 1px solid var(--iris-line); }
.trace-role::before { content: ''; position: absolute; left: -4px; top: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--iris-accent); }
.trace-role[data-state='STOPPED']::before { background: var(--iris-sev-high); }
.trace-role[data-state='STARTED']::before { background: var(--iris-sev-moderate); }
.trace-role:last-child { border-left-color: transparent; }
.trace-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.trace-head h4 { margin: 0; }
.trace-head .elapsed { color: var(--iris-ink-2); font-size: 13px; margin-left: auto; }
.duty { font-size: 12px; margin: 4px 0; }
.headline { margin: 6px 0; }
.extras { margin: 4px 0 8px; padding-left: 18px; color: var(--iris-ink-2); font-size: 13px; }
.io { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 8px; }
.io-panel { border: 1px solid var(--iris-line); border-radius: var(--iris-radius); padding: 10px 14px; background: var(--iris-surface-2); min-width: 0; }
.io-panel .overline { margin: 0 0 6px; }
.raw { margin-top: 8px; border-top: 1px dashed var(--iris-line); padding-top: 6px; }
.raw summary { cursor: pointer; font-size: 11px; color: var(--iris-ink-3); }
.raw pre { margin: 8px 0 2px; max-height: 260px; overflow: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.started { font-size: 11px; color: var(--iris-ink-3); margin-top: 6px; }
.evidence, .attempt, .claim { padding: 8px 0; }
.claim { border-top: 1px dashed var(--iris-line); }
.citation { color: var(--iris-ink-2); overflow-wrap: anywhere; }
.citation .ok { color: var(--iris-sev-low); } .citation .bad { color: var(--iris-sev-high); }
.error { color: var(--iris-error); }
button { border: 1px solid var(--iris-accent); border-radius: var(--iris-radius); padding: 10px 16px; background: var(--iris-accent); color: var(--iris-on-accent); font: inherit; cursor: pointer; }
button.secondary { background: var(--iris-surface); border-color: var(--iris-line-strong); color: var(--iris-ink); }
button:disabled { opacity: .5; cursor: default; }
button:not(:disabled):hover { background: var(--iris-accent-strong); }
button.secondary:not(:disabled):hover { background: var(--iris-surface); box-shadow: 0 0 0 1px var(--iris-line-strong); }
button:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 3px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 991px) { .layout { grid-template-columns: 1fr; } .draft-test-page { padding: 32px 16px 64px; } .io { grid-template-columns: 1fr; } }
</style>
