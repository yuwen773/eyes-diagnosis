<script setup lang="ts">
/** 运行时协作与自治消息视图：同一真实任务的两个工程视角。讨论视图已独立成页。 */
import { computed, ref } from 'vue'
import { buildStages } from './agentCollab'
import { useDraftTrace } from './useDraftTrace'
import LiveCollabView from './components/LiveCollabView.vue'
import AutonomyCollabView from './components/AutonomyCollabView.vue'

const { isAdmin, tasks, selectedTaskId, trace, error, running, loadTasks, selectTask } = useDraftTrace()

type View = 'live' | 'autonomy'
const views: { key: View; label: string; note: string }[] = [
  { key: 'live', label: '① 运行时协作', note: '真实轨迹 · 调用状态 · 材料流转' },
  { key: 'autonomy', label: '② 自治多 Agent', note: '真实消息 · 并行 · 异议与修订' },
]
const view = ref<View>('live')

const stages = computed(() => buildStages(trace.value))
</script>

<template>
  <main class="collab-page">
    <header class="page-heading">
      <p class="overline">AGENT COLLABORATION · TWO VIEWS</p>
      <h1>四 Agent 协作效果</h1>
      <p>两个工程视角呈现同一任务的真实调用与并行消息。多角色讨论已独立为会诊议事录页。内部草稿仍须医生独立复核。</p>
    </header>

    <p v-if="!isAdmin" role="alert">此入口仅对管理员开放。</p>
    <template v-else>
      <div class="tabs" role="tablist">
        <button v-for="item in views" :key="item.key" role="tab" :aria-selected="view === item.key"
          :class="{ active: view === item.key }" type="button" @click="view = item.key">
          <strong>{{ item.label }}</strong><small>{{ item.note }}</small>
        </button>
        <RouterLink class="docket-link" to="/admin/agent-discussion">
          <strong>③ 多角色讨论 →</strong><small>独立页面 · 四角色会诊议事录</small>
        </RouterLink>
      </div>

      <div class="task-bar">
        <label>轨迹来源
          <select v-model="selectedTaskId" @change="selectTask(selectedTaskId)">
            <option value="" disabled>选择任务</option>
            <option v-for="task in tasks" :key="task.taskId" :value="task.taskId">
              {{ task.runStatus || '未运行' }} · {{ task.taskId.slice(0, 8) }}
            </option>
          </select>
        </label>
        <span v-if="running" class="mono live-tag">● 运行中 · 每秒刷新</span>
        <button class="secondary" type="button" @click="loadTasks">刷新列表</button>
      </div>
      <p v-if="error" role="alert" class="error">{{ error }}</p>

      <div class="surface">
        <LiveCollabView v-if="view === 'live'" :stages="stages" :running="running" />
        <AutonomyCollabView v-else :trace="trace" />
      </div>
    </template>
  </main>
</template>

<style scoped>
.collab-page { max-width: 1200px; margin: auto; padding: 56px 24px 88px; color: var(--iris-ink); background: var(--iris-bg); }
.page-heading { border-bottom: 1px solid var(--iris-line); margin-bottom: 24px; padding-bottom: 24px; }
.overline, .mono { font-family: 'JetBrains Mono', Consolas, monospace; }
.overline { font-size: 11px; letter-spacing: 2px; color: var(--iris-ink-2); margin: 0; }
h1 { font-family: Georgia, 'Songti SC', serif; font-weight: 500; font-size: 40px; margin: 8px 0 16px; }
.page-heading > p:last-child { color: var(--iris-ink-2); line-height: 1.65; }
.tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.tabs button, .tabs .docket-link { display: grid; gap: 4px; align-content: start; text-align: left; padding: 12px 14px; border: 1px solid var(--iris-line); border-radius: var(--iris-radius); background: var(--iris-surface); color: var(--iris-ink); font: inherit; cursor: pointer; text-decoration: none; }
.tabs button.active { border-color: var(--iris-accent); background: var(--iris-accent-soft); }
.tabs .docket-link { border-style: dashed; color: var(--iris-accent-strong); }
.tabs strong { font-weight: 500; font-size: 14px; }
.tabs small { font-size: 11px; color: var(--iris-ink-2); }
.task-bar { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; margin: 20px 0 12px; }
.task-bar label { display: grid; gap: 4px; font-size: 12px; color: var(--iris-ink-2); }
.task-bar select { padding: 8px; border: 1px solid var(--iris-line-strong); border-radius: var(--iris-radius-sm); background: var(--iris-surface); color: var(--iris-ink); font: inherit; min-width: 260px; }
.live-tag { font-size: 12px; color: var(--iris-sev-moderate); }
button { border: 1px solid var(--iris-accent); border-radius: var(--iris-radius); padding: 10px 16px; background: var(--iris-accent); color: var(--iris-on-accent); font: inherit; cursor: pointer; }
button.secondary { background: var(--iris-surface); border-color: var(--iris-line-strong); color: var(--iris-ink); }
.surface { padding: 24px; border: 1px solid var(--iris-line); border-radius: var(--iris-radius-lg); background: var(--iris-surface); }
.error { color: var(--iris-error); }
@media (max-width: 991px) { .tabs { grid-template-columns: 1fr; } .collab-page { padding: 32px 16px 64px; } }
@media (max-width: 640px) {
  .collab-page { padding: 24px 0 40px; }
  .surface { padding: 12px; }
  .task-bar label { width: 100%; min-width: 0; }
  .task-bar select { min-width: 0; width: 100%; }
}
[data-theme='dark'] .collab-page {
  --iris-bg: var(--claude-bg-page);
  --iris-surface: var(--claude-bg-card);
  --iris-surface-2: var(--claude-bg-elevated);
  --iris-ink: var(--claude-text-primary);
  --iris-ink-2: var(--claude-text-secondary);
  --iris-ink-3: var(--claude-text-secondary);
  --iris-line: var(--claude-border-cream);
  --iris-line-strong: var(--claude-border-warm);
  --iris-accent-soft: var(--claude-bg-elevated);
  --iris-sev-moderate-soft: var(--claude-bg-elevated);
  --iris-sev-high-soft: var(--claude-bg-elevated);
  --iris-sev-low-soft: var(--claude-bg-elevated);
}
</style>
