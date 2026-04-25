<template>
  <div class="left-sidebar" id="agent-left-sidebar" role="complementary" aria-label="会话历史">
    <!-- Header -->
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <!-- 眼睛轮廓 -->
            <path d="M2 12C2 12 6 5 12 5C18 5 22 12 22 12C22 12 18 19 12 19C6 19 2 12 2 12Z" class="eye-outline" />
            <!-- 瞳孔/内核 -->
            <circle cx="12" cy="12" r="2.5" class="pupil" />
            <!-- 神经网络脉冲：从瞳孔向外 -->
            <line x1="12" y1="9.5" x2="12" y2="7" class="pulse-line pl-1" />
            <circle cx="12" cy="6.5" r="0.8" class="pulse-dot pd-1" />
            <line x1="14.3" y1="10.5" x2="16.2" y2="9.3" class="pulse-line pl-2" />
            <circle cx="16.6" cy="8.9" r="0.8" class="pulse-dot pd-2" />
            <line x1="14.3" y1="13.5" x2="16.2" y2="14.7" class="pulse-line pl-3" />
            <circle cx="16.6" cy="15.1" r="0.8" class="pulse-dot pd-3" />
            <line x1="12" y1="14.5" x2="12" y2="17" class="pulse-line pl-4" />
            <circle cx="12" cy="17.5" r="0.8" class="pulse-dot pd-4" />
            <line x1="9.7" y1="13.5" x2="7.8" y2="14.7" class="pulse-line pl-5" />
            <circle cx="7.4" cy="15.1" r="0.8" class="pulse-dot pd-5" />
            <line x1="9.7" y1="10.5" x2="7.8" y2="9.3" class="pulse-line pl-6" />
            <circle cx="7.4" cy="8.9" r="0.8" class="pulse-dot pd-6" />
          </svg>
        </div>
        <span class="brand-name">EyeSight</span>
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
  background: var(--claude-bg-secondary);
  border-right: 1px solid var(--claude-border-subtle);
}

/* ============ Header ============ */
.sidebar-header {
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--claude-border-subtle);
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

.eye-outline {
  stroke: var(--claude-brand);
  stroke-width: 1.4;
  fill: none;
  opacity: 0.85;
}

.pupil {
  fill: var(--claude-brand);
  opacity: 0.95;
  animation: pupilThrob 2s ease-in-out infinite;
}

.pulse-line {
  stroke: var(--claude-brand);
  stroke-width: 1;
  stroke-linecap: round;
  opacity: 0;
  animation: pulseOut 2s ease-out infinite;
}

.pulse-dot {
  fill: var(--claude-brand);
  opacity: 0;
  animation: dotAppear 2s ease-out infinite;
}

.pl-1 { animation-delay: 0s; }
.pl-2 { animation-delay: 0.2s; }
.pl-3 { animation-delay: 0.4s; }
.pl-4 { animation-delay: 0.6s; }
.pl-5 { animation-delay: 0.8s; }
.pl-6 { animation-delay: 1s; }

.pd-1 { animation-delay: 0.3s; }
.pd-2 { animation-delay: 0.5s; }
.pd-3 { animation-delay: 0.7s; }
.pd-4 { animation-delay: 0.9s; }
.pd-5 { animation-delay: 1.1s; }
.pd-6 { animation-delay: 1.3s; }

@keyframes pupilThrob {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

@keyframes pulseOut {
  0% { opacity: 0; stroke-dashoffset: 4; }
  20% { opacity: 0.7; }
  100% { opacity: 0; stroke-dashoffset: 0; }
}

@keyframes dotAppear {
  0% { opacity: 0; transform: scale(0); }
  30% { opacity: 1; transform: scale(1.2); }
  60% { opacity: 0.8; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.6); }
}

.brand-name {
  font-family: var(--claude-font-serif);
  font-size: 15px;
  font-weight: 700;
  color: var(--claude-text-primary);
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
  color: var(--claude-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-secondary);
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
  border: 1px solid var(--claude-border-default);
  background: transparent;
  color: var(--claude-text-secondary);
  font-family: var(--claude-font-sans);
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

.new-chat-btn:hover {
  border-color: var(--claude-brand);
  color: var(--claude-brand);
  transform: translateY(-1px);
}

.new-chat-btn:hover::before {
  opacity: 1;
}

.new-chat-btn:active {
  transform: translateY(0) scale(0.98);
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
  background: var(--claude-border-default);
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
  background: var(--claude-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--claude-text-tertiary);
}

.empty-text {
  font-size: 13px;
  color: var(--claude-text-tertiary);
  letter-spacing: 0.01em;
}

/* History groups */
.history-group {
  margin-bottom: 4px;
}

.group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--claude-text-tertiary);
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
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
}

.history-item.active {
  background: var(--claude-bg-elevated);
}

.history-item.active .history-indicator {
  background: var(--claude-brand);
}

.history-item.active .history-title {
  color: var(--claude-brand);
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
  color: var(--claude-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
  transition: color 0.15s ease;
}

.history-time {
  font-size: 11px;
  color: var(--claude-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ============ Footer ============ */
.sidebar-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--claude-border-subtle);
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
  color: var(--claude-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.footer-btn:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-secondary);
}
</style>
