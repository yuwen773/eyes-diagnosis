<template>
  <div class="left-sidebar">
    <!-- Header -->
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <!-- 连线 -->
            <line x1="12" y1="3" x2="4" y2="9" class="mark-line mark-line-1" />
            <line x1="12" y1="3" x2="20" y2="9" class="mark-line mark-line-2" />
            <line x1="4" y1="9" x2="12" y2="21" class="mark-line mark-line-3" />
            <line x1="20" y1="9" x2="12" y2="21" class="mark-line mark-line-4" />
            <line x1="4" y1="9" x2="20" y2="9" class="mark-line mark-line-5" />
            <!-- 节点 -->
            <circle cx="12" cy="3" r="2" class="mark-node mark-node-top" />
            <circle cx="4" cy="9" r="1.6" class="mark-node mark-node-left" />
            <circle cx="20" cy="9" r="1.6" class="mark-node mark-node-right" />
            <circle cx="12" cy="21" r="2.4" class="mark-node mark-node-core" />
          </svg>
        </div>
        <span class="brand-name">SpaceMind</span>
        <button class="collapse-btn" @click="emit('collapse')" aria-label="收起侧边栏" title="收起侧边栏">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>
      <button class="new-chat-btn" @click="emit('newChat')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>新对话</span>
      </button>
    </div>

    <!-- History list -->
    <div class="sidebar-body">
      <div v-if="histories.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <span class="empty-text">开始一段新对话</span>
      </div>

      <template v-else>
        <div v-for="group in groupedHistories" :key="group.label" class="history-group">
          <div class="group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            class="history-item"
            :class="{ active: activeId === item.id }"
            @click="emit('select', item.id)"
          >
            <div class="history-indicator" aria-hidden="true"></div>
            <div class="history-content">
              <span class="history-title">{{ item.title || '新对话' }}</span>
              <span class="history-time">{{ item.time }}</span>
            </div>
          </button>
        </div>
      </template>
    </div>

    <!-- Footer -->
    <div class="sidebar-footer">
      <button class="footer-btn" title="设置" aria-label="设置" @click="emit('settings')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface HistoryItem {
  id: string
  title: string
  time: string
}

interface Props {
  histories: HistoryItem[]
  activeId?: string
}

const props = withDefaults(defineProps<Props>(), {
  histories: () => [],
  activeId: '',
})

const emit = defineEmits<{
  (e: 'newChat'): void
  (e: 'select', id: string): void
  (e: 'collapse'): void
  (e: 'settings'): void
}>()

const groupedHistories = computed(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000

  const groups: { label: string; items: HistoryItem[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]

  for (const item of props.histories) {
    try {
      const itemDate = new Date(item.time).getTime()
      if (itemDate >= today) {
        groups[0].items.push(item)
      } else if (itemDate >= yesterday) {
        groups[1].items.push(item)
      } else {
        groups[2].items.push(item)
      }
    } catch {
      groups[2].items.push(item)
    }
  }

  return groups.filter(g => g.items.length > 0)
})
</script>

<style scoped>
.left-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border-subtle);
}

/* ============ Header ============ */
.sidebar-header {
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
  margin-bottom: 0;
}

.brand-mark {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mark-line {
  stroke: var(--color-primary-500);
  stroke-width: 1.2;
  opacity: 0.35;
  stroke-linecap: round;
}

.mark-node {
  fill: var(--color-primary-500);
  opacity: 0.9;
}

.mark-node-core {
  fill: url(#markGrad);
  opacity: 1;
  animation: nodeBreath 3s ease-in-out infinite;
}

[data-theme="aurora"] .mark-node-core {
  filter: drop-shadow(0 0 4px rgba(34, 104, 245, 0.5));
}

[data-theme="pop"] .mark-node-core {
  filter: drop-shadow(0 0 4px rgba(168, 85, 247, 0.5));
}

.mark-line-1 { animation: lineFade 4s ease-in-out 0s infinite; }
.mark-line-2 { animation: lineFade 4s ease-in-out 0.5s infinite; }
.mark-line-3 { animation: lineFade 4s ease-in-out 1s infinite; }
.mark-line-4 { animation: lineFade 4s ease-in-out 1.5s infinite; }
.mark-line-5 { animation: lineFade 4s ease-in-out 2s infinite; }

.mark-node-top { animation: nodeBreath 3s ease-in-out 0s infinite; }
.mark-node-left { animation: nodeBreath 3s ease-in-out 0.4s infinite; }
.mark-node-right { animation: nodeBreath 3s ease-in-out 0.8s infinite; }

@keyframes nodeBreath {
  0%, 100% { opacity: 0.7; transform-origin: center; }
  50% { opacity: 1; }
}

@keyframes lineFade {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.6; }
}

.brand-name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
  flex: 1;
}

/* Collapse button */
.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--color-bg-hover, var(--color-bg-tertiary));
  color: var(--color-text-secondary);
}

[data-theme="aurora"] .collapse-btn:hover {
  color: rgba(34, 104, 245, 0.7);
}

[data-theme="pop"] .collapse-btn:hover {
  color: rgba(168, 85, 247, 0.7);
}

/* New Chat Button */
.new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

.new-chat-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.2s ease;
  border-radius: inherit;
}

[data-theme="aurora"] .new-chat-btn::before {
  background: linear-gradient(135deg, rgba(34, 104, 245, 0.06) 0%, rgba(110, 53, 235, 0.03) 100%);
}

[data-theme="pop"] .new-chat-btn::before {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.05) 0%, rgba(236, 72, 153, 0.03) 100%);
}

.new-chat-btn:hover {
  border-color: var(--color-primary-500);
  color: var(--color-primary-500);
  transform: translateY(-1px);
}

.new-chat-btn:hover::before {
  opacity: 1;
}

.new-chat-btn:active {
  transform: translateY(0) scale(0.98);
}

[data-theme="aurora"] .new-chat-btn:hover {
  box-shadow: 0 0 0 1px rgba(34, 104, 245, 0.15), 0 2px 8px rgba(34, 104, 245, 0.08);
}

[data-theme="pop"] .new-chat-btn:hover {
  box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.12), 0 2px 8px rgba(168, 85, 247, 0.06);
}

.new-chat-btn svg,
.new-chat-btn span {
  position: relative;
  z-index: 1;
}

/* ============ Body ============ */
.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

/* Scrollbar */
.sidebar-body::-webkit-scrollbar {
  width: 4px;
}

.sidebar-body::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-body::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 4px;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 16px;
}

.empty-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
}

.empty-text {
  font-size: 13px;
  color: var(--color-text-tertiary);
  letter-spacing: 0.01em;
}

/* History groups */
.history-group {
  margin-bottom: 4px;
}

.group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 8px 12px 4px;
}

/* History item */
.history-item {
  display: flex;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  padding: 10px 12px 10px 8px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  position: relative;
}

.history-indicator {
  width: 3px;
  height: 100%;
  min-height: 28px;
  border-radius: 2px;
  background: transparent;
  flex-shrink: 0;
  margin-right: 10px;
  transition: background 0.15s ease;
}

.history-item:hover {
  background: var(--color-bg-hover, var(--color-bg-tertiary));
}

.history-item.active {
  background: var(--color-bg-elevated);
}

.history-item.active .history-indicator {
  background: var(--color-primary-500);
}

.history-item.active .history-title {
  color: var(--color-primary-500);
}

[data-theme="aurora"] .history-item.active {
  box-shadow: inset 0 0 0 1px rgba(34, 104, 245, 0.08);
}

[data-theme="pop"] .history-item.active {
  box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.06);
}

.history-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.history-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
  transition: color 0.15s ease;
}

.history-time {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ============ Footer ============ */
.sidebar-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-subtle);
}

.footer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.footer-btn:hover {
  background: var(--color-bg-hover, var(--color-bg-tertiary));
  color: var(--color-text-secondary);
}
</style>
