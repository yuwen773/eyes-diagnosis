<script setup lang="ts">
/**
 * 四角色会诊议事录。独立页面，不与运行时/自治视图混排。
 *
 * 这里刻意不用聊天气泡、头像、emoji 或装饰动效：一份临床判读记录不是聊天软件。
 * 版式取「议事录 / 会议纪要」：台账编号、发丝线、等宽读数、旁注式引文、
 * 严重度语义色只标异议、causation 用细连接线表达回复关系。
 * 所有文本来自真实落库轨迹，不生成脚本化对话，不编造异议。
 */
import { computed, ref } from 'vue'
import { useDraftTrace } from './useDraftTrace'
import { buildDiscussion, type DiscussionTurn } from './agentCollab'

const { isAdmin, tasks, selectedTaskId, trace, error, running, loadTasks, selectTask } = useDraftTrace()

const turns = computed(() => buildDiscussion(trace.value))
const rounds = computed(() => turns.value.filter(turn => turn.isFeedback).length)
const openNote = ref<string | null>(null)

const ENTRY: Record<DiscussionTurn['entryKind'], string> = {
  work: '工作记录', objection: '异议 / 打回', revision: '修订回应', consensus: '复核结论',
}
const STATE: Record<string, string> = {
  PENDING: '待开始', RUNNING: '进行中', DONE: '已完成', STOPPED: '已停止',
}
const ROLE_TAG: Record<string, string> = {
  VISION: 'VISION', EVIDENCE: 'EVIDENCE', EXPLANATION: 'EXPLANATION', CRITIC: 'CRITIC', GATE: 'GATE',
}

function seconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`
}
function clock(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function toggle(key: string): void {
  openNote.value = openNote.value === key ? null : key
}
function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}
const headline = computed(() => {
  if (!trace.value) return '尚未载入轨迹'
  if (trace.value.status === 'REVIEW_READY') return '草稿已就绪，等待医生独立复核'
  if (trace.value.stopReason) return `本次已受限：${trace.value.stopReason}`
  return '协作进行中，尚未形成可复核草稿'
})
</script>

<template>
  <main class="docket" aria-label="四角色会诊议事录">
    <p v-if="!isAdmin" class="gate" role="alert">此入口仅对管理员开放。</p>

    <template v-else>
      <!-- 报头：左对齐，不用居中 hero；读数全部等宽 -->
      <header class="masthead">
        <div class="masthead-top">
          <span class="instrument">IRIS / PATIENT DRAFT · REVIEW DOCKET</span>
          <span v-if="running" class="live mono">● 运行中 · 每秒刷新</span>
        </div>
        <h1>四角色会诊议事录</h1>
        <p class="dek">四个独立角色对同一份获准推理摘要的交接、引用与异议记录。内部草稿仍须医生独立复核。</p>

        <div class="controls">
          <label class="field">
            <span>轨迹来源</span>
            <select v-model="selectedTaskId" @change="selectTask(selectedTaskId)">
              <option value="" disabled>选择任务</option>
              <option v-for="task in tasks" :key="task.taskId" :value="task.taskId">
                {{ task.runStatus || '未运行' }} · {{ task.taskId.slice(0, 8) }}
              </option>
            </select>
          </label>
          <button class="secondary" type="button" @click="loadTasks">刷新列表</button>
        </div>
      </header>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <!-- 读数条：4 列 mono 指标，不是卡片 -->
      <dl v-if="trace" class="readout mono">
        <div><dt>发言记录</dt><dd>{{ turns.length }}</dd></div>
        <div><dt>异议来回</dt><dd>{{ rounds }}</dd></div>
        <div><dt>模型调用</dt><dd>{{ trace.calls }} / {{ trace.budget.maxCalls }}</dd></div>
        <div><dt>流程版本</dt><dd class="version">{{ trace.workflowVersion || 'SEQUENTIAL_V1' }}</dd></div>
      </dl>
      <p v-if="trace" class="status-line" :data-state="trace.status">
        <span class="mono">STATE</span> {{ headline }}
      </p>

      <!-- 议事录正文 -->
      <p v-if="!trace" class="empty">选择一条任务后，此处显示逐条会诊记录。</p>
      <p v-else-if="!turns.length" class="empty">此任务尚无角色发言记录。</p>

      <ol v-else class="entries">
        <li v-for="(turn, index) in turns" :key="turn.key" class="entry"
          :data-kind="turn.entryKind" :data-state="turn.state"
          :class="{ reply: turn.isReply }">
          <!-- 左栏：台账编号 + 角色 + 时间读数 -->
          <div class="rail">
            <span class="seq mono">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="role-tag mono">{{ ROLE_TAG[turn.role] || turn.role }}</span>
            <span class="role-name">{{ turn.label }}</span>
            <span class="timing mono">{{ clock(turn.startedAt) }} · {{ seconds(turn.elapsedMs) }}</span>
          </div>

          <!-- 右栏：条目内容 -->
          <div class="body">
            <div class="entry-head">
              <span class="kind" :data-kind="turn.entryKind">{{ ENTRY[turn.entryKind] }}</span>
              <span class="state mono" :data-state="turn.state">{{ STATE[turn.state] || turn.state }}</span>
              <span class="call mono">#{{ turn.sequence }}</span>
            </div>

            <p v-if="turn.addressedTo.length" class="addressed mono">
              送 <span>{{ turn.addressedTo.map(role => ROLE_TAG[role] || role).join(', ') }}</span>
              <template v-if="turn.isConsensus"> · 请求终态复验（非批准）</template>
            </p>

            <p class="utterance">{{ turn.utterance }}</p>

            <!-- 引文作为旁注，不用气泡 -->
            <div v-if="turn.quotes.length" class="margin-notes">
              <div v-for="(quote, q) in turn.quotes" :key="q" class="note">
                <span class="note-label mono">引 · {{ quote.from }} · {{ quote.label }}</span>
                <p>{{ quote.text }}</p>
              </div>
            </div>

            <!-- 异议作为台账批注，语义色 + 文字标签，颜色不单独承载信息 -->
            <div v-if="turn.objections.length" class="objections">
              <p class="objections-head mono">异议 {{ turn.objections.length }} 条 · 逐条指向具体声明</p>
              <p v-for="(objection, o) in turn.objections" :key="o" class="objection">
                <span class="mono target">{{ objection.target }}</span>
                <span v-if="objection.section" class="section mono">{{ objection.section }}</span>
                <span class="reason">{{ objection.reason }}</span>
              </p>
            </div>

            <button class="disclosure" type="button" @click="toggle(turn.key)">
              {{ openNote === turn.key ? '收起消息链' : '查看消息链' }}
            </button>
            <div v-if="openNote === turn.key" class="chain">
              <p class="mono chain-head">回复关系（causationMessageId）</p>
              <p v-for="reply in turn.replyTo" :key="reply.messageId" class="mono chain-line">
                ↳ {{ reply.label }} · {{ shortId(reply.messageId) }}
              </p>
              <p v-if="!turn.replyTo.length" class="mono chain-line">无（本轮为独立工作，没有可追溯的回复消息）</p>
              <p class="mono chain-line">缩进层级 {{ turn.depth }}</p>
            </div>
          </div>
        </li>
      </ol>

      <footer class="footnote">
        <p>引文取自真实 <code>payload.objections[].target</code> 反查草稿 <code>claims[].text</code> 与 <code>reason</code>；消息链由 <code>causationMessageId</code> 串接。没有异议时如实记为「无异议」，不补造讨论内容。</p>
        <p>正式 <code>/agent</code> 聊天页未接入四 Agent 流程；模型复核无异议不代表临床发布授权。</p>
      </footer>
    </template>
  </main>
</template>

<style scoped>
/* 单一令牌系统：沿用本前端 --iris-*；圆角在本页统一为 0；动效仅 focus / hover。 */
.docket {
  --rule: var(--iris-line);
  --rule-strong: var(--iris-line-strong);
  max-width: 1120px;
  margin: 0 auto;
  padding: 40px 32px 96px;
  color: var(--iris-ink);
  font-family: var(--iris-font-sans);
}
/* 所有读数走等宽 + tabular，避免数字在议事录里跳动。 */
.docket :is(.mono, .readout, .seq, .timing, .call, .note-label, .chain-line, code) {
  font-family: var(--iris-font-mono);
  font-variant-numeric: tabular-nums;
}

.gate, .error { color: var(--iris-sev-high); font-size: 13px; }
.error { border-left: 2px solid var(--iris-sev-high); padding: 6px 12px; margin: 12px 0; }

.masthead { border-bottom: 1px solid var(--rule-strong); padding-bottom: 22px; }
.masthead-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.instrument { font-family: var(--iris-font-mono); font-size: 10.5px; letter-spacing: 0.16em; color: var(--iris-ink-3); }
.live { font-size: 11px; color: var(--iris-sev-moderate); }
h1 {
  font-family: var(--iris-font-serif);
  font-weight: 400;
  font-size: 34px;
  line-height: 1.25;
  letter-spacing: 0.01em;
  margin: 14px 0 8px;
}
.dek { font-size: 12.5px; line-height: 1.7; color: var(--iris-ink-2); max-width: 68ch; margin: 0; }

.controls { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; margin-top: 22px; }
.field { display: grid; gap: 5px; }
.field > span { font-size: 11px; color: var(--iris-ink-2); }
select, button {
  font-family: var(--iris-font-sans);
  font-size: 12px;
  border-radius: 0;
}
select {
  min-width: 260px;
  padding: 8px 10px;
  border: 1px solid var(--rule-strong);
  background: var(--iris-surface);
  color: var(--iris-ink);
}
button {
  padding: 8px 16px;
  border: 1px solid var(--iris-ink);
  background: var(--iris-ink);
  color: var(--iris-surface);
  cursor: pointer;
}
button.secondary { background: var(--iris-surface); color: var(--iris-ink); border-color: var(--rule-strong); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 2px; }
button:active { transform: translateY(1px); }

/* 读数条：4 列，数字等宽 + tabular */
.readout { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--rule-strong); margin: 0; }
.readout > div { padding: 14px 16px 14px 0; border-right: 1px solid var(--rule); }
.readout > div:last-child { border-right: 0; }
.readout dt { font-size: 10px; letter-spacing: 0.1em; color: var(--iris-ink-3); }
.readout dd { margin: 6px 0 0; font-size: 18px; font-variant-numeric: tabular-nums; color: var(--iris-ink); }
.readout dd.version { font-size: 12px; padding-top: 5px; }

.status-line { font-size: 12px; color: var(--iris-ink-2); padding: 12px 0 4px; margin: 0; }
.status-line .mono { font-size: 10px; letter-spacing: 0.12em; color: var(--iris-ink-3); margin-right: 10px; }
.status-line[data-state='RESTRICTED'] { color: var(--iris-sev-high); }
.status-line[data-state='REVIEW_READY'] { color: var(--iris-sev-low); }

.empty { font-size: 12.5px; color: var(--iris-ink-2); padding: 32px 0; }

/* 议事录条目：左栏台账 / 右栏内容，发丝线分隔，不用卡片 */
.entries { list-style: none; padding: 0; margin: 18px 0 0; }
.entry {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: 28px;
  padding: 22px 0 24px;
  border-top: 1px solid var(--rule);
}
.entry:first-child { border-top: 0; }
.entry[data-state='PENDING'] { opacity: 0.55; }
.entry.reply { padding-left: 18px; border-left: 2px solid var(--iris-sev-moderate); }

.rail { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; }
.seq { font-size: 22px; line-height: 1; color: var(--iris-ink-3); font-variant-numeric: tabular-nums; }
.role-tag { font-size: 9.5px; letter-spacing: 0.12em; color: var(--iris-accent-strong); margin-top: 8px; }
.role-name { font-size: 12px; color: var(--iris-ink-2); }
.timing { font-size: 10px; color: var(--iris-ink-3); margin-top: 4px; font-variant-numeric: tabular-nums; }

.entry-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.kind { font-size: 11px; font-weight: 500; padding: 2px 8px; border: 1px solid var(--rule-strong); color: var(--iris-ink-2); }
.kind[data-kind='objection'] { color: var(--iris-sev-high); border-color: var(--iris-sev-high); background: var(--iris-sev-high-soft); }
.kind[data-kind='consensus'] { color: var(--iris-sev-low); border-color: var(--iris-sev-low); background: var(--iris-sev-low-soft); }
.kind[data-kind='revision'] { color: var(--iris-sev-moderate); border-color: var(--iris-sev-moderate); }
.state, .call { font-size: 10px; color: var(--iris-ink-3); }
.state[data-state='STOPPED'] { color: var(--iris-sev-high); }
.call { margin-left: auto; }

.addressed { font-size: 10.5px; color: var(--iris-ink-3); margin: 12px 0 0; }
.addressed span { color: var(--iris-ink-2); }
.utterance { font-size: 13.5px; line-height: 1.75; margin: 12px 0 0; max-width: 72ch; }

/* 旁注式引文：左细线 + 缩进，不是气泡 */
.margin-notes { margin: 14px 0 0; display: grid; gap: 10px; }
.note { border-left: 2px solid var(--rule-strong); padding: 2px 0 2px 14px; }
.note-label { font-size: 9.5px; letter-spacing: 0.06em; color: var(--iris-ink-3); }
.note p { margin: 4px 0 0; font-size: 12px; line-height: 1.65; color: var(--iris-ink-2); max-width: 66ch; }

/* 异议台账批注 */
.objections { margin-top: 14px; border-left: 2px solid var(--iris-sev-high); padding-left: 14px; }
.objections-head { font-size: 9.5px; letter-spacing: 0.06em; color: var(--iris-sev-high); margin: 0 0 6px; }
.objection { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; font-size: 11.5px; margin: 4px 0; }
.objection .target { color: var(--iris-sev-high); font-size: 10px; }
.objection .section { color: var(--iris-ink-3); font-size: 10px; }
.objection .reason { color: var(--iris-ink); }

.disclosure {
  margin-top: 14px; padding: 0; border: 0; background: none;
  color: var(--iris-accent-strong); font-size: 11px; text-decoration: underline;
}
.disclosure:active { transform: none; }
.chain { margin-top: 10px; border-top: 1px dashed var(--rule); padding-top: 10px; }
.chain-head { font-size: 9.5px; letter-spacing: 0.08em; color: var(--iris-ink-3); margin: 0 0 5px; }
.chain-line { font-size: 10.5px; color: var(--iris-ink-2); margin: 3px 0; word-break: break-all; }

.footnote { border-top: 1px solid var(--rule-strong); margin-top: 28px; padding-top: 14px; }
.footnote p { font-size: 11px; line-height: 1.7; color: var(--iris-ink-3); margin: 4px 0; }
code { font-family: var(--iris-font-mono); font-size: 10px; color: var(--iris-ink-2); }

/* 900px 以下：左栏折到条目上方，缩进取消 */
@media (max-width: 900px) {
  .docket { padding: 28px 20px 72px; }
  .entry { grid-template-columns: 1fr; gap: 12px; }
  .entry.reply { padding-left: 12px; }
  .rail { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; }
  .seq { font-size: 16px; }
  .role-tag { margin-top: 0; }
  .timing { margin-top: 0; }
  .readout { grid-template-columns: 1fr 1fr; }
  .readout > div:nth-child(2) { border-right: 0; }
  .readout > div:nth-child(3), .readout > div:nth-child(4) { border-top: 1px solid var(--rule); }
}
@media (max-width: 560px) {
  .docket { padding: 22px 14px 60px; }
  h1 { font-size: 26px; }
  .controls .field, .controls select { width: 100%; min-width: 0; }
}

/* 暗色：只换令牌别名，不改结构；纸面读数在任何主题下保持同一套层级 */
:global([data-theme='dark']) .docket {
  --iris-bg: var(--claude-bg-page);
  --iris-surface: var(--claude-bg-card);
  --iris-surface-2: var(--claude-bg-elevated);
  --iris-ink: var(--claude-text-primary);
  --iris-ink-2: var(--claude-text-secondary);
  --iris-ink-3: var(--claude-text-secondary);
  --iris-line: var(--claude-border-cream);
  --iris-line-strong: var(--claude-border-warm);
  --iris-accent-soft: var(--claude-bg-elevated);
  --iris-sev-high-soft: var(--claude-bg-elevated);
  --iris-sev-low-soft: var(--claude-bg-elevated);
}
</style>
