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
      <div class="header-actions">
        <button class="multi-select-btn" @click="toggleMultiSelect" :class="{ active: multiSelectMode }">
          {{ multiSelectMode ? '取消' : '选择' }}
        </button>
        <button class="new-chat-btn" @click="emit('newChat')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>新对话</span>
      </button>
      </div>
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
        <div v-for="group in groupedHistories" :key="group.label" class="history-group" role="listbox" aria-multiselectable="true">
          <div class="group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            class="history-item"
            :class="{ active: activeId === item.id, selected: selectedIds.has(item.id) }"
            @click="handleItemClick(item)"
            @mouseenter="showMenuId = item.id"
            @mouseleave="showMenuId = null"
          >
            <div v-if="multiSelectMode"
                 class="checkbox"
                 :class="{ checked: selectedIds.has(item.id) }"
                 role="checkbox"
                 :aria-checked="selectedIds.has(item.id)"
                 :aria-label="item.title || '选择会话'"
                 tabindex="0"
                 @keydown.space.enter.prevent="toggleSelect(item.id)"
                 @click="toggleSelect(item.id)">
              <svg v-if="selectedIds.has(item.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div class="history-indicator" aria-hidden="true"></div>
            <div class="history-content">
              <div class="history-title-wrap">
                <span
                  v-if="editingId !== item.id"
                  class="history-title"
                  @dblclick="startEdit(item)"
                >
                  {{ item.title || '新对话' }}
                </span>
                <input
                  v-else
                  v-model="editingTitle"
                  class="title-input"
                  @keyup.enter="saveEdit"
                  @keyup.esc="cancelEdit"
                  @blur="saveEdit"
                  maxlength="50"
                  autofocus
                />
                <button
                  v-if="!multiSelectMode && editingId !== item.id"
                  class="edit-btn"
                  @click.stop="startEdit(item)"
                  title="重命名"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <div v-if="showMenuId === item.id && !multiSelectMode && editingId !== item.id" class="hover-menu">
                  <button class="menu-item" @click.stop="handlePin(item)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 2L12 22M12 2L7 7M12 2L17 7" v-if="!item.isPinned" />
                      <path d="M12 2v20M7 7l5-5 5 5" v-if="item.isPinned" />
                    </svg>
                    <span>{{ item.isPinned ? '取消置顶' : '置顶' }}</span>
                  </button>
                  <button class="menu-item" @click.stop="handleExport(item, 'markdown')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>导出 Markdown</span>
                  </button>
                  <button class="menu-item" @click.stop="handleExport(item, 'json')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>导出 JSON</span>
                  </button>
                </div>
              </div>
              <span class="history-time">{{ item.time }}</span>
            </div>
            <button
              v-if="!multiSelectMode"
              class="delete-btn"
              :disabled="deleting"
              @click.stop="handleDelete(item.id)"
              title="删除"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </button>
        </div>
      </template>
    </div>

    <!-- Batch actions -->
    <div v-if="multiSelectMode && selectedIds.size > 0" class="batch-actions">
      <span>已选择 {{ selectedIds.size }} 项</span>
      <button class="batch-delete-btn" :disabled="deleting" @click="handleBatchDelete">删除</button>
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
import { computed, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { deleteSession, batchDeleteSessions, updateSessionTitle, updatePinStatus, exportSession } from '@/api/agentController'

export interface HistoryItem {
  id: string
  title: string
  time: string
  isPinned?: boolean
}

interface Props {
  histories: HistoryItem[]
  activeId?: string
  loadSessions?: () => Promise<void>
}

const props = withDefaults(defineProps<Props>(), {
  histories: () => [],
  activeId: '',
  loadSessions: async () => {}
})

const emit = defineEmits<{
  (e: 'newChat'): void
  (e: 'select', id: string): void
  (e: 'collapse'): void
  (e: 'settings'): void
}>()

// Multi-select mode
const multiSelectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

// Hover menu
const showMenuId = ref<string | null>(null)

const toggleMenu = (id: string) => {
  showMenuId.value = showMenuId.value === id ? null : id
}

// Edit state
const editingId = ref<string | null>(null)
const editingTitle = ref('')

const startEdit = (item: HistoryItem) => {
  editingId.value = item.id
  editingTitle.value = item.title || ''
}

const saveEdit = async () => {
  if (editingId.value) {
    const newTitle = editingTitle.value.trim()
    if (newTitle) {
      try {
        await updateSessionTitle(editingId.value, newTitle)
        await props.loadSessions()
      } catch (e) {
        console.error('更新标题失败', e)
        message.error('更新标题失败，请重试')
      }
    } else {
      message.warning('标题不能为空')
    }
    editingId.value = null
    editingTitle.value = ''
  }
}

const cancelEdit = () => {
  editingId.value = null
  editingTitle.value = ''
}

const handleItemClick = (item: HistoryItem) => {
  // 如果正在编辑其他项，先取消
  if (editingId.value && editingId.value !== item.id) {
    cancelEdit()
  }
  if (multiSelectMode.value) {
    toggleSelect(item.id)
  } else {
    emit('select', item.id)
  }
}

const toggleMultiSelect = () => {
  multiSelectMode.value = !multiSelectMode.value
  if (!multiSelectMode.value) {
    selectedIds.value.clear()
  }
}

const toggleSelect = (id: string) => {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

const deleting = ref(false)

const handleDelete = (id: string) => {
  if (deleting.value) return
  Modal.confirm({
    title: '确定删除该会话？',
    content: '删除后可从回收站恢复',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      deleting.value = true
      try {
        await deleteSession(id)
        message.success('会话已删除')
        await props.loadSessions()
      } catch (e) {
        message.error('删除失败')
      } finally {
        deleting.value = false
      }
    }
  })
}

const handlePin = async (item: HistoryItem) => {
  try {
    await updatePinStatus(item.id, !item.isPinned)
    message.success(item.isPinned ? '已取消置顶' : '已置顶')
    await props.loadSessions()
    showMenuId.value = null  // 成功后关闭菜单
  } catch (e) {
    console.error('置顶操作失败', e)
    message.error('操作失败')
    // 失败时保持菜单打开，用户可以重试
  }
}

const handleExport = async (item: HistoryItem, format: 'markdown' | 'json') => {
  try {
    const res = await exportSession(item.id, format)
    if (res.code === 0) {
      const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${item.title || '会话'}_${Date.now()}.${format === 'json' ? 'json' : 'md'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success(`已导出为 ${format === 'json' ? 'JSON' : 'Markdown'}`)
    } else {
      message.error('导出失败')
    }
  } catch (e) {
    console.error('导出失败', e)
    message.error('导出失败')
  } finally {
    showMenuId.value = null
  }
}

const handleBatchDelete = async () => {
  if (deleting.value) return
  const count = selectedIds.value.size
  Modal.confirm({
    title: `确定删除选中的 ${count} 个会话？`,
    content: '删除后可从回收站恢复',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      deleting.value = true
      try {
        await batchDeleteSessions(Array.from(selectedIds.value))
        message.success(`${count} 个会话已删除`)
        multiSelectMode.value = false
        selectedIds.value.clear()
        await props.loadSessions()
      } catch (e) {
        message.error('批量删除失败')
      } finally {
        deleting.value = false
      }
    }
  })
}

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

/* Header actions */
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.multi-select-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: transparent;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.multi-select-btn:hover {
  border-color: var(--color-primary-500);
  color: var(--color-primary-500);
}

.multi-select-btn.active {
  background: var(--color-primary-500);
  color: white;
  border-color: var(--color-primary-500);
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

.history-item.selected {
  background: var(--color-bg-elevated);
}

.history-item.selected .history-indicator {
  background: var(--color-primary-500);
}

/* Checkbox */
.checkbox {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid var(--color-border-default);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 8px;
  transition: all 0.15s ease;
  color: white;
}

.checkbox.checked {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
}

.history-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.history-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.history-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.title-input {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  border: 1px solid var(--claude-brand);
  border-radius: 4px;
  background: var(--claude-bg-page);
  color: var(--claude-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.title-input:focus {
  box-shadow: 0 0 0 2px oklch(0.72 0.09 30 / 0.15);
}

.edit-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--claude-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-item:hover .edit-btn {
  opacity: 1;
}

.edit-btn:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-secondary);
}

.history-time {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.delete-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #fee2e2;
  color: #ef4444;
}

/* ============ Footer ============ */
.sidebar-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-subtle);
  position: relative;
}

/* Batch actions */
.batch-actions {
  position: absolute;
  bottom: 60px;
  left: 12px;
  right: 12px;
  padding: 10px 14px;
  background: var(--color-bg-elevated);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
  font-size: 13px;
}

.batch-delete-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: #ef4444;
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.batch-delete-btn:hover {
  background: #dc2626;
}

/* Hover menu */
.hover-menu {
  position: absolute;
  right: 8px;
  top: calc(100% + 4px);
  min-width: 120px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
  padding: 4px;
  z-index: 100;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--color-bg-hover, var(--color-bg-tertiary));
  color: var(--color-text-primary);
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
