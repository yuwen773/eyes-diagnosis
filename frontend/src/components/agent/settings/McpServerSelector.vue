<template>
  <div class="mcp-server-selector">
    <div class="selector-header">
      <div class="header-left">
        <span class="selector-title">MCP 服务器</span>
        <span class="selection-info">
          已选择 {{ selectedIds.length }} / {{ maxSelection }}
        </span>
      </div>
      <a-button type="link" size="small" @click="loadMcpServerList">
        <template #icon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="1 4 1 10 7 10"></polyline>
            <polyline points="23 20 23 14 17 14"></polyline>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
          </svg>
        </template>
        刷新
      </a-button>
    </div>

    <!-- 加载状态 -->
    <a-spin :spinning="loading">
      <!-- 空状态 -->
      <div v-if="!loading && mcpServerList.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </div>
        <p class="empty-text">暂无可用的 MCP 服务器</p>
        <p class="empty-hint">请先在设置中添加 MCP 服务</p>
      </div>

      <!-- 服务器列表 -->
      <div v-else class="server-list-container">
        <div
          v-for="server in mcpServerList"
          :key="server.mcpServerCode"
          class="server-item"
          :class="{
            selected: isSelected(server.mcpServerCode),
            disabled: !isSelected(server.mcpServerCode) && selectedIds.length >= maxSelection,
          }"
          @click="toggleServer(server)"
        >
          <div class="server-checkbox">
            <a-checkbox
              :checked="isSelected(server.mcpServerCode)"
              :disabled="!isSelected(server.mcpServerCode) && selectedIds.length >= maxSelection"
              @click.stop="toggleServer(server)"
            />
          </div>
          <div class="server-info">
            <div class="server-title-row">
              <span class="server-name">{{ server.name }}</span>
              <a-tag :color="server.enabled ? 'green' : 'default'" class="status-tag">
                {{ server.enabled ? '已启用' : '已禁用' }}
              </a-tag>
            </div>
            <div class="server-meta">
              <span class="server-type">{{ getServerTypeLabel(server.type) }}</span>
              <span v-if="server.toolCount !== undefined" class="tools-count">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
                </svg>
                {{ server.toolCount }} 个工具
              </span>
            </div>
          </div>
        </div>
      </div>
    </a-spin>

    <!-- 已选服务器标签 -->
    <div v-if="selectedServers.length > 0" class="selected-tags">
      <div class="tags-label">已选择：</div>
      <div class="tags-container">
        <a-tag
          v-for="server in selectedServers"
          :key="server.mcpServerCode"
          class="selected-tag"
          closable
          @close="removeServer(server)"
        >
          {{ server.name }}
        </a-tag>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { McpServerVO } from '@/types/mcp'
import { getServerTypeLabel } from '@/types/mcp'

interface Props {
  modelValue: string[]
  maxSelection?: number
}

const props = withDefaults(
  defineProps<Props>(),
  {
    modelValue: () => [],
    maxSelection: 5,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

// 状态
const loading = ref(false)
const mcpServerList = ref<McpServerVO[]>([])

// 选中的服务器 ID 列表
const selectedIds = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// 选中的服务器对象列表
const selectedServers = computed(() => {
  return mcpServerList.value.filter((server) => server.mcpServerCode && selectedIds.value.includes(server.mcpServerCode))
})

// API 函数
import { listMcpServers } from '@/api/mcpController'

const listMcpServersUsingGet = async () => {
  return await listMcpServers({})
}

// 加载 MCP 服务器列表
const loadMcpServerList = async () => {
  loading.value = true
  try {
    const res = await listMcpServersUsingGet()
    if (res.data.code === 0) {
      mcpServerList.value = res.data.data?.records || []
    } else {
      message.error('加载 MCP 服务列表失败: ' + res.data.message)
    }
  } catch (error) {
    message.error('加载 MCP 服务列表失败')
    console.error('Load MCP servers error:', error)
  } finally {
    loading.value = false
  }
}

// 检查服务器是否已选中
const isSelected = (mcpServerCode?: string): boolean => {
  return mcpServerCode !== undefined && selectedIds.value.includes(mcpServerCode)
}

// 切换服务器选中状态
const toggleServer = (server: McpServerVO) => {
  if (!server.mcpServerCode) return

  // 如果服务器未启用，不允许选中
  if (!server.enabled) {
    message.warning('该服务已禁用，无法选择')
    return
  }

  if (isSelected(server.mcpServerCode)) {
    // 取消选中
    selectedIds.value = selectedIds.value.filter((code) => code !== server.mcpServerCode)
  } else {
    // 选中新服务器
    if (selectedIds.value.length >= props.maxSelection) {
      message.warning(`最多只能选择 ${props.maxSelection} 个服务器`)
      return
    }
    selectedIds.value = [...selectedIds.value, server.mcpServerCode]
  }
}

// 移除选中的服务器
const removeServer = (server: McpServerVO) => {
  if (!server.mcpServerCode) return
  selectedIds.value = selectedIds.value.filter((code) => code !== server.mcpServerCode)
}

// 初始化加载
watch(
  () => props,
  () => {
    if (mcpServerList.value.length === 0) {
      loadMcpServerList()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.mcp-server-selector {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
  font-family: var(--font-body, system-ui);
}

.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-3, 0.75rem);
  border-bottom: 1px solid var(--color-border-subtle, #f0eee6);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-4, 1rem);
}

.selector-title {
  font-weight: 500;
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #141413);
  letter-spacing: -0.005em;
}

.selection-info {
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-text-secondary, #5e5d59);
  background: var(--color-bg-secondary, #faf9f5);
  padding: 2px var(--space-2, 0.5rem);
  border-radius: var(--radius-sm, 4px);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-10, 2.5rem) var(--space-4, 1rem);
  text-align: center;
}

.empty-icon {
  color: var(--color-text-tertiary, #87867f);
  opacity: 0.4;
  margin-bottom: var(--space-4, 1rem);
}

.empty-text {
  font-size: var(--text-sm, 0.875rem);
  font-weight: 500;
  color: var(--color-text-primary, #141413);
  margin: 0 0 var(--space-1, 0.25rem) 0;
}

.empty-hint {
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-text-secondary, #5e5d59);
}

.server-list-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-1, 0.25rem);
  max-height: 240px;
  overflow-y: auto;
  padding-right: var(--space-1, 0.25rem);
}

.server-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4, 1rem);
  padding: var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: background var(--transition-fast, 150ms ease);
  border: 1px solid transparent;
}

.server-item:hover:not(.disabled) {
  background: var(--color-bg-hover, #f7f5ef);
}

.server-item.selected {
  background: color-mix(in oklch, var(--color-primary-500, #c96442) 8%, transparent);
  border-color: color-mix(in oklch, var(--color-primary-500, #c96442) 25%, transparent);
}

.server-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.server-checkbox {
  padding-top: 2px;
}

.server-info {
  flex: 1;
  min-width: 0;
}

.server-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-1, 0.25rem);
}

.server-name {
  font-weight: 500;
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #141413);
}

.status-tag {
  font-size: 0.6875rem;
  padding: 0 6px;
  line-height: 18px;
}

.server-meta {
  display: flex;
  align-items: center;
  gap: var(--space-4, 1rem);
}

.server-type {
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-text-tertiary, #87867f);
  background: var(--color-bg-secondary, #faf9f5);
  padding: 2px var(--space-2, 0.5rem);
  border-radius: var(--radius-sm, 4px);
}

.tools-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-text-secondary, #5e5d59);
}

.tools-count svg {
  color: var(--color-text-tertiary, #87867f);
}

.selected-tags {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2, 0.5rem);
  padding-top: var(--space-3, 0.75rem);
  border-top: 1px solid var(--color-border-subtle, #f0eee6);
}

.tags-label {
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-text-secondary, #5e5d59);
  padding-top: 4px;
  flex-shrink: 0;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
}

.selected-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px var(--space-2, 0.5rem);
  font-size: var(--text-xs, 0.75rem);
  background: color-mix(in oklch, var(--color-primary-500, #c96442) 10%, transparent);
  border-color: color-mix(in oklch, var(--color-primary-500, #c96442) 30%, transparent);
  color: var(--color-primary-600, #a34f2f);
}
</style>
