<script setup lang="ts">
/** ① 运行时协作视图：真实轨迹驱动，保留每次调用及实际收件信息。 */
import { computed } from 'vue'
import type { CollabStage } from '../agentCollab'

const props = defineProps<{ stages: CollabStage[]; running: boolean }>()

const STATE_LABEL: Record<CollabStage['state'], string> = {
  PENDING: '待开始', RUNNING: '进行中', DONE: '已完成', STOPPED: '已停止',
}

const ICONS: Record<CollabStage['role'], string> = {
  VISION: '◉', EVIDENCE: '▤', EXPLANATION: '✎', CRITIC: '⌕',
}

const visible = computed(() => props.stages)

function seconds(ms: number | null) { return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s` }
</script>

<template>
  <section class="live-view" aria-label="运行时协作视图">
    <div class="live-head">
      <p class="overline">LIVE COLLABORATION · 真实轨迹</p>

    </div>
    <p class="muted intro">展示每次模型调用的实际状态与材料；调用序号是登记顺序，并行起止和定向消息见自治泳道。</p>

    <div class="rail">
      <template v-for="(stage, index) in visible" :key="`${stage.role}-${stage.sequence}`">
        <div class="node" :data-state="stage.state" :class="{ active: stage.state === 'RUNNING' }">
          <span class="icon" aria-hidden="true">{{ ICONS[stage.role] }}</span>
          <span class="mono seq">#{{ index + 1 }}</span>
          <h4>{{ stage.label }}</h4>
          <p class="duty">{{ stage.duty }}</p>
          <p class="mono timing">{{ seconds(stage.elapsedMs) }}</p>
          <span class="state-tag">{{ STATE_LABEL[stage.state] }}</span>
        </div>

      </template>
    </div>

    <div class="ledger">
      <h3>调用记录</h3>
      <ol>
        <li v-for="(stage, index) in visible" :key="`${stage.role}-${stage.sequence}`">
          <span class="mono seq">#{{ index + 1 }}</span>
          <strong>{{ stage.label }}</strong>
          <span v-if="stage.received" class="received">收到：{{ stage.received }}</span>
          <span v-if="stage.handoff" class="handoff">交出：{{ stage.handoff.label }} · {{ stage.handoff.detail }}</span>
          <span v-if="stage.state === 'STOPPED'" class="stopped">在此停止</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.live-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.overline, .mono { font-family: 'JetBrains Mono', Consolas, monospace; }
.overline { font-size: 11px; letter-spacing: 2px; color: var(--iris-ink-2); margin: 0; }
.controls { display: flex; gap: 8px; }
.muted { color: var(--iris-ink-2); }
.intro { font-size: 12px; }
button { border: 1px solid var(--iris-accent); border-radius: var(--iris-radius); padding: 8px 14px; background: var(--iris-accent); color: var(--iris-on-accent); font: inherit; font-size: 12px; cursor: pointer; }
button.secondary { background: var(--iris-surface); border-color: var(--iris-line-strong); color: var(--iris-ink); }
.rail { display: flex; align-items: stretch; gap: 0; margin: 20px 0; overflow-x: auto; padding-bottom: 8px; }
.node { flex: 1 1 0; min-width: 148px; padding: 14px; border: 1px solid var(--iris-line); border-radius: var(--iris-radius); background: var(--iris-surface); position: relative; transition: box-shadow .3s, background .3s; }
.node[data-state='DONE'] { background: var(--iris-sev-low-soft); border-color: var(--iris-sev-low); }
.node[data-state='RUNNING'], .node.active { box-shadow: 0 0 0 2px var(--iris-accent); }
.node[data-state='STOPPED'] { background: var(--iris-sev-high-soft); border-color: var(--iris-sev-high); }
.node[data-state='PENDING'] { opacity: .5; }
.icon { font-size: 22px; color: var(--iris-accent-strong); }
.seq { font-size: 11px; color: var(--iris-ink-3); display: block; margin-top: 4px; }
h4, h3 { font-family: Georgia, 'Songti SC', serif; font-weight: 500; margin: 6px 0 4px; font-size: 15px; }
.duty { font-size: 11px; color: var(--iris-ink-2); margin: 0; line-height: 1.4; }
.timing { font-size: 13px; margin: 8px 0 4px; }
.state-tag { font-size: 11px; color: var(--iris-ink-3); }
.link { flex: 0 0 62px; position: relative; display: flex; align-items: center; justify-content: center; }
.line { position: absolute; left: 0; right: 0; height: 1px; background: var(--iris-line-strong); }
.packet { position: relative; font-size: 10px; padding: 3px 6px; border-radius: 10px; background: var(--iris-accent-soft); color: var(--iris-accent-strong); white-space: nowrap; max-width: 60px; overflow: hidden; text-overflow: ellipsis; }
.link.flowing .line { background: var(--iris-accent); }
.link.flowing .packet { animation: travel 2.2s ease-in-out infinite; }
.line-label { position: relative; font-size: 10px; color: var(--iris-ink-3); background: var(--iris-surface); padding: 0 4px; }
@keyframes travel { 0% { transform: translateX(-18px); opacity: .55; } 50% { opacity: 1; } 100% { transform: translateX(18px); opacity: .55; } }
.ledger { border-top: 1px solid var(--iris-line); padding-top: 8px; }
.ledger ol { list-style: none; padding: 0; margin: 0; }
.ledger li { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; padding: 7px 0; border-bottom: 1px dashed var(--iris-line); font-size: 13px; }
.ledger strong { font-weight: 500; }
.received { color: var(--iris-accent-strong); }
.handoff { color: var(--iris-ink-2); }
.stopped { color: var(--iris-sev-high); }
@media (prefers-reduced-motion: reduce) { .link.flowing .packet { animation: none; } }
</style>
