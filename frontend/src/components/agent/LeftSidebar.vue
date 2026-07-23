<template>
  <div class="left-sidebar">
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
              <div class="history-title-wrap" :class="{ editing: editingId === item.id }">
                <span
                  v-if="editingId !== item.id"
                  class="history-title"
                >
                  {{ item.title || '新对话' }}
                </span>
                <div v-else class="title-edit-wrap">
                  <input
                    v-model="editingTitle"
                    class="title-input"
                    @keyup.enter.stop="saveEdit"
                    @keyup.esc.stop="cancelEdit"
                    maxlength="50"
                    ref="titleInputRef"
                  />
                  <button class="title-action-btn confirm" @click.stop="saveEdit" title="保存">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button class="title-action-btn cancel" @click.stop="cancelEdit" title="取消">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <button
                  v-if="!multiSelectMode && editingId !== item.id"
                  class="more-btn"
                  @click.stop="toggleMenu(item.id, $event)"
                  title="更多操作"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
                  </svg>
                </button>
                <Teleport to="body" v-if="showMenuId === item.id">
                  <div class="hover-menu" :style="getMenuStyle(item.id)" @click.stop>
                    <button class="menu-item" @click.stop="handleRename(item)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      <span>重命名</span>
                    </button>
                    <button class="menu-item" @click.stop="handlePin(item)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L12 22M12 2L7 7M12 2L17 7" v-if="!item.isPinned" />
                        <path d="M12 2v20M7 7l5-5 5 5" v-if="item.isPinned" />
                      </svg>
                      <span>{{ item.isPinned ? '取消置顶' : '置顶' }}</span>
                    </button>
                    <div class="menu-item has-submenu" @click.stop>
                      <div class="submenu-trigger">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>导出</span>
                        <svg class="submenu-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                      <div class="submenu" :style="getMenuStyle(item.id)">
                        <button class="menu-item" @click.stop="handleExport(item, 'markdown')">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                          <span>Markdown</span>
                        </button>
                        <button class="menu-item" @click.stop="handleExport(item, 'json')">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <path d="M8 13h2M8 17h2M14 13h2M14 17h2" />
                          </svg>
                          <span>JSON</span>
                        </button>
                      </div>
                    </div>
                    <button class="menu-item danger" @click.stop="handleDelete(item.id)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      <span>删除</span>
                    </button>
                  </div>
                </Teleport>
              </div>
              <span class="history-time">{{ item.time }}</span>
            </div>
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
import { computed, ref, nextTick } from 'vue'
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
const menuPositions = ref<Record<string, { top: number; left: number }>>({})

const toggleMenu = (id: string, event?: MouseEvent) => {
  if (showMenuId.value === id) {
    showMenuId.value = null
  } else {
    if (event?.target) {
      const rect = (event.target as HTMLElement).getBoundingClientRect()
      // 菜单从按钮左下角弹出，避免贴边
      menuPositions.value[id] = { top: rect.bottom + 4, left: rect.left }
    }
    showMenuId.value = id
  }
}

const getMenuStyle = (id: string) => {
  const pos = menuPositions.value[id]
  if (!pos) return {}
  return {
    position: 'fixed' as const,
    top: `${pos.top}px`,
    left: `${pos.left}px`,
    maxWidth: '160px'
  }
}

const handleRename = (item: HistoryItem) => {
  showMenuId.value = null
  startEdit(item)
}

// Edit state
const editingId = ref<string | null>(null)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)
const saving = ref(false)

const startEdit = async (item: HistoryItem) => {
  editingId.value = item.id
  editingTitle.value = item.title || ''
  await nextTick()
  titleInputRef.value?.focus()
}

const saveEdit = async () => {
  if (editingId.value && !saving.value) {
    const newTitle = editingTitle.value.trim()
    if (!newTitle) {
      message.warning('标题不能为空')
      return
    }
    saving.value = true
    try {
      await updateSessionTitle(editingId.value, newTitle)
      await props.loadSessions()
    } catch (e) {
      console.error('更新标题失败', e)
      message.error('更新标题失败，请重试')
    } finally {
      saving.value = false
      editingId.value = null
      editingTitle.value = ''
    }
  }
}

const cancelEdit = () => {
  editingId.value = null
  editingTitle.value = ''
}

const handleItemClick = (item: HistoryItem) => {
  // 正在编辑该项本身 → 忽略点击
  if (editingId.value === item.id) {
    return
  }
  // 正在编辑其他项时点击 → 弹出确认防丢失
  if (editingId.value && editingId.value !== item.id) {
    Modal.confirm({
      title: '还有未保存的修改',
      content: '是否放弃当前修改？',
      okText: '放弃',
      okType: 'danger',
      cancelText: '继续编辑',
      onOk() {
        cancelEdit()
        emit('select', item.id)
      },
    })
    return
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
      } catch {
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

const sanitizeFilename = (name: string): string => {
  return name.replace(/[/\\:*?"<>|]/g, '_').substring(0, 50)
}

const handleExport = async (item: HistoryItem, format: 'markdown' | 'json' = 'markdown') => {
  try {
    const res = await exportSession(item.id, format)
    if (res.code === 0) {
      const blob = new Blob([res.data], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = format === 'json' ? 'json' : 'md'
      const filename = `${sanitizeFilename(item.title || '会话')}_${Date.now()}.${ext}`
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success('已导出')
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
      } catch {
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

.brand-mark svg {
  width: 24px;
  height: 24px;
  overflow: visible;
}

.eye-outline {
  stroke: var(--claude-brand);
  stroke-width: 1.5;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pupil {
  fill: var(--claude-brand);
}

.pulse-line {
  stroke: var(--claude-brand);
  stroke-width: 1.2;
  stroke-linecap: round;
  opacity: 0.5;
}

.pulse-dot {
  fill: var(--claude-brand);
  opacity: 0.6;
}

.pl-1 { animation: pulse 2s ease-in-out 0s infinite; }
.pl-2 { animation: pulse 2s ease-in-out 0.15s infinite; }
.pl-3 { animation: pulse 2s ease-in-out 0.3s infinite; }
.pl-4 { animation: pulse 2s ease-in-out 0.45s infinite; }
.pl-5 { animation: pulse 2s ease-in-out 0.6s infinite; }
.pl-6 { animation: pulse 2s ease-in-out 0.75s infinite; }

.pd-1 { animation: pulse 2s ease-in-out 0s infinite; }
.pd-2 { animation: pulse 2s ease-in-out 0.15s infinite; }
.pd-3 { animation: pulse 2s ease-in-out 0.3s infinite; }
.pd-4 { animation: pulse 2s ease-in-out 0.45s infinite; }
.pd-5 { animation: pulse 2s ease-in-out 0.6s infinite; }
.pd-6 { animation: pulse 2s ease-in-out 0.75s infinite; }

@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.8; }
}

[data-theme="aurora"] .pulse-dot,
[data-theme="aurora"] .pupil {
  filter: drop-shadow(0 0 3px rgba(34, 104, 245, 0.6));
}

[data-theme="pop"] .pulse-dot,
[data-theme="pop"] .pupil {
  filter: drop-shadow(0 0 3px rgba(168, 85, 247, 0.6));
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

[data-theme="aurora"] .new-chat-btn::before {
  background: linear-gradient(135deg, rgba(34, 104, 245, 0.06) 0%, rgba(110, 53, 235, 0.03) 100%);
}

[data-theme="pop"] .new-chat-btn::before {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.05) 0%, rgba(236, 72, 153, 0.03) 100%);
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
  gap: 4px;
}

.multi-select-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--claude-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.multi-select-btn:hover {
  color: var(--claude-text-secondary);
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
}

.multi-select-btn.active {
  color: var(--claude-brand);
  background: transparent;
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

[data-theme="aurora"] .history-item.active {
  box-shadow: inset 0 0 0 1px rgba(34, 104, 245, 0.08);
}

[data-theme="pop"] .history-item.active {
  box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.06);
}

.history-item.selected {
  background: var(--claude-bg-elevated);
}

.history-item.selected .history-indicator {
  background: var(--claude-brand);
}

/* Checkbox */
.checkbox {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 2px solid var(--claude-ring-warm);
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
  background: var(--claude-brand);
  border-color: var(--claude-brand);
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
  position: relative;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.history-title-wrap.editing {
  background: var(--claude-bg-elevated);
  padding-right: 4px;
}

.history-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-edit-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.title-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 2px solid var(--claude-brand);
  border-radius: 6px;
  background: var(--claude-bg-page);
  color: var(--claude-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-shadow: 0 0 0 3px oklch(0.72 0.09 30 / 0.12);
}

.title-action-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.title-action-btn.confirm {
  background: var(--claude-brand);
  color: white;
}

.title-action-btn.confirm:hover {
  background: color-mix(in oklch, var(--claude-brand) 85%, black);
}

.title-action-btn.cancel {
  background: var(--claude-bg-tertiary);
  color: var(--claude-text-secondary);
}

.title-action-btn.cancel:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-primary);
}

.more-btn {
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

.history-item:hover .more-btn {
  opacity: 1;
}

.more-btn:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-secondary);
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
  position: relative;
}

/* Batch actions */
.batch-actions {
  position: absolute;
  bottom: 60px;
  left: 12px;
  right: 12px;
  padding: 10px 14px;
  background: var(--claude-bg-elevated);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--claude-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
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
  min-width: 120px;
  max-width: 160px;
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-default);
  border-radius: 8px;
  box-shadow: var(--claude-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
  padding: 4px;
}

.has-submenu {
  position: relative;
}

.submenu-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--claude-text-secondary);
  font-size: 13px;
}

.submenu-trigger:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-primary);
}

.submenu-arrow {
  margin-left: auto;
}

.submenu {
  position: absolute;
  left: 100%;
  top: 0;
  margin-left: 4px;
  min-width: 120px;
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-default);
  border-radius: 8px;
  box-shadow: var(--claude-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
  padding: 4px;
  display: none;
  z-index: 1000;
}

.has-submenu:hover .submenu {
  display: block;
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
  color: var(--claude-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  word-break: keep-all;
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--claude-bg-hover, var(--claude-bg-tertiary));
  color: var(--claude-text-primary);
}

.menu-item.danger {
  color: #ef4444;
}

.menu-item.danger:hover {
  background: #fee2e2;
  color: #dc2626;
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
