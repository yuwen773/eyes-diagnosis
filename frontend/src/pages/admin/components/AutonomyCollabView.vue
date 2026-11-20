<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DraftTestTrace } from '@/api/patientDraftTest'
import { buildAutonomyEvents, ROLE_ORDER } from '../agentCollab'

const props = defineProps<{ trace: DraftTestTrace | null }>()
const labels = ['图像信息整理', '受控资料检索', '分层说明生成', '一致性检查']
const events = computed(() => buildAutonomyEvents(props.trace))
const duration = computed(() => Math.max(1, ...events.value.map(event => event.at)))
const elapsed = ref<number | null>(null)
const playing = ref(false)
let timer: number | undefined
const shown = computed(() => events.value.filter(event => elapsed.value === null || event.at <= elapsed.value))
const progress = computed(() => elapsed.value === null ? 100 : Math.min(100, elapsed.value / duration.value * 100))
const kindLabel = { work: '执行', message: '消息', objection: '异议', rewrite: '修订', review: '复核无异议', stop: '停止' }

function pause() { playing.value = false; if (timer !== undefined) window.clearInterval(timer); timer = undefined }
function live() { pause(); elapsed.value = null }
function play() {
  pause()
  if (elapsed.value === null || elapsed.value >= duration.value) elapsed.value = 0
  playing.value = true
  timer = window.setInterval(() => {
    elapsed.value = Math.min(duration.value, (elapsed.value ?? 0) + 400)
    if (elapsed.value >= duration.value) pause()
  }, 100)
}
watch(() => props.trace?.taskId, live)
onBeforeUnmount(pause)
</script>

<template>
  <section class="autonomy" aria-label="自治多 Agent 真实协作">
    <div class="head">
      <div><p class="overline">AUTONOMOUS AGENTS · 真实协作</p><h3>并行 · 定向消息 · 异议与修订</h3></div>
      <div v-if="events.length" class="controls">
        <button v-if="!playing" type="button" @click="play">{{ elapsed === null || elapsed >= duration ? '重播真实轨迹' : '继续' }}</button>
        <button v-else type="button" @click="pause">暂停</button>
        <button v-if="elapsed !== null" class="secondary" type="button" @click="live">返回当前轨迹</button>
      </div>
    </div>
    <p v-if="!trace" class="notice">请选择任务，查看真实调用和消息；重播不会调用模型。</p>
    <p v-else-if="trace.workflowVersion !== 'AUTONOMOUS_V2'" class="notice">历史顺序流程：此记录没有自治消息，请在其他视图查看原始调用。</p>
    <template v-else>
      <p class="notice" role="status">
        {{ trace.status === 'REVIEW_READY' ? '草稿已就绪，等待医生独立复核。' : trace.status === 'RESTRICTED' ? `本次已受限：${trace.stopReason}` : '协作进行中，尚未形成可复核草稿。' }}
        <span class="mono">调用 {{ trace.calls }} / {{ trace.budget.maxCalls }} · {{ trace.workflowVersion }}</span>
      </p>
      <div class="progress"><span :style="{ width: `${progress}%` }" /></div>
      <p class="mono clock">{{ elapsed === null ? '当前真实轨迹' : `重播 ${(elapsed / 1000).toFixed(1)} s` }} · {{ shown.length }} 个事件</p>
      <div class="lanes">
        <div v-for="(role, index) in ROLE_ORDER" :key="role" class="lane" :class="{ active: shown.some(event => event.lane === role) }">
          <div class="lane-head"><strong>{{ labels[index] }}</strong></div>
          <div class="events">
            <div v-for="event in shown.filter(item => item.lane === role)" :key="event.id" class="event" :data-kind="event.kind">
              <span class="mono badge">{{ kindLabel[event.kind] }} · {{ (event.at / 1000).toFixed(2) }} s</span>
              <p v-if="event.route" class="mono route">{{ event.route }}</p><p>{{ event.text }}</p>
            </div>
            <p v-if="!shown.some(event => event.lane === role)" class="muted idle">等待事件…</p>
          </div>
        </div>
      </div>
      <p class="muted footnote">事件来自持久化时间和已接受的角色消息；模型复核无异议仍须来源复验与医生批准。</p>
    </template>
  </section>
</template>

<style scoped>
.overline, .mono { font-family: 'JetBrains Mono', Consolas, monospace; }
.overline { font-size: 11px; letter-spacing: 2px; color: var(--iris-ink-2); margin: 0; }
.head { display: flex; justify-content: space-between; align-items: start; gap: 12px; flex-wrap: wrap; }
h3 { font-family: Georgia, 'Songti SC', serif; font-weight: 500; font-size: 20px; margin: 6px 0 0; }
.controls { display: flex; gap: 8px; }
button { border: 1px solid var(--iris-accent); border-radius: var(--iris-radius); padding: 8px 14px; background: var(--iris-accent); color: var(--iris-on-accent); font: inherit; font-size: 12px; cursor: pointer; }
button.secondary { background: var(--iris-surface); border-color: var(--iris-line-strong); color: var(--iris-ink); }
.notice { padding: 12px 16px; border-radius: var(--iris-radius); background: var(--iris-sev-moderate-soft); color: var(--iris-ink); font-size: 12px; line-height: 1.65; }
.progress { height: 3px; background: var(--iris-line); border-radius: 2px; overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--iris-accent); transition: width .1s linear; }
.clock { font-size: 11px; color: var(--iris-ink-3); margin: 6px 0 14px; }
.lanes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.lane { border: 1px solid var(--iris-line); border-radius: var(--iris-radius); background: var(--iris-surface); padding: 10px; min-width: 0; }
.lane.active { border-color: var(--iris-accent); box-shadow: inset 0 0 0 1px var(--iris-accent-soft); }
.lane-head { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--iris-line); padding-bottom: 8px; }
.lane-head strong { font-size: 12px; font-weight: 500; }
.icon { color: var(--iris-accent-strong); }
.events { display: grid; gap: 8px; margin-top: 8px; }
.event { border-left: 2px solid var(--iris-line-strong); padding: 4px 8px; font-size: 12px; background: var(--iris-surface-2); }
.event[data-kind='message'] { border-left-color: var(--iris-accent); }
.event[data-kind='objection'] { border-left-color: var(--iris-sev-high); background: var(--iris-sev-high-soft); }
.event[data-kind='rewrite'] { border-left-color: var(--iris-sev-moderate); }
.event[data-kind='review'] { border-left-color: var(--iris-sev-low); background: var(--iris-sev-low-soft); }
.event p { margin: 4px 0 0; line-height: 1.45; }
.badge { font-size: 10px; color: var(--iris-ink-3); }
.route { font-size: 10px; color: var(--iris-accent-strong); margin-left: 6px; }
.idle { font-size: 11px; }
.footnote { font-size: 11px; margin-top: 12px; }
.muted { color: var(--iris-ink-2); }
@media (max-width: 991px) { .lanes { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) { .lanes { grid-template-columns: 1fr; } }
</style>

<style scoped>
.notice .mono { display: block; margin-top: 6px; }
.event { overflow-wrap: anywhere; }
.badge { color: var(--iris-ink-2); }
.route { color: var(--iris-ink); }
button:focus-visible { outline: 2px solid var(--iris-focus); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .progress span { transition: none; } }
</style>
