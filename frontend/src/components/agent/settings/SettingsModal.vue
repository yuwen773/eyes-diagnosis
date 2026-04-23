<template>
  <a-modal
    :open="open"
    title=""
    :footer="null"
    :width="1000"
    :maskClosable="true"
    class="settings-modal"
    @cancel="handleClose"
  >
    <div class="settings-container">
      <!-- 左侧导航 -->
      <div class="settings-sidebar">
        <div class="sidebar-header">
          <h2 class="sidebar-title">设置</h2>
        </div>
        <nav class="sidebar-nav">
          <button
            class="nav-item"
            :class="{ active: activeTab === 'mcp' }"
            @click="activeTab = 'mcp'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>MCP 配置</span>
          </button>
          <button
            class="nav-item"
            :class="{ active: activeTab === 'preference', disabled: true }"
            disabled
            @click="activeTab = 'preference'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>用户偏好</span>
            <span class="coming-soon">待开发</span>
          </button>
        </nav>
      </div>

      <!-- 右侧内容 -->
      <div class="settings-content">
        <!-- MCP 配置内容 -->
        <div v-if="activeTab === 'mcp'" class="content-section">
          <McpServicePanel />
        </div>

        <!-- 用户偏好内容 -->
        <div v-if="activeTab === 'preference'" class="content-section placeholder">
          <div class="placeholder-content">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <p>用户偏好设置正在开发中</p>
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import McpServicePanel from './McpServicePanel.vue'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const activeTab = ref<'mcp' | 'preference'>('mcp')

const handleClose = () => {
  emit('update:open', false)
}
</script>

<style scoped>
.settings-container {
  display: flex;
  height: 700px;
  margin: -24px;
  background: #f8fafc;
}

/* 左侧导航 */
.settings-sidebar {
  width: 200px;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.sidebar-nav {
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  transition: all 0.2s ease;
  text-align: left;
  width: 100%;
  position: relative;
}

.nav-item:hover:not(.disabled) {
  background: #f3f4f6;
  color: #374151;
}

.nav-item.active {
  background: #eff6ff;
  color: #3b82f6;
}

.nav-item.active svg {
  stroke: #3b82f6;
}

.nav-item.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.coming-soon {
  font-size: 10px;
  padding: 2px 6px;
  background: #e5e7eb;
  color: #9ca3af;
  border-radius: 4px;
  margin-left: auto;
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-section {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-section.placeholder {
  align-items: center;
  justify-content: center;
}

.placeholder-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #9ca3af;
}

.placeholder-content p {
  margin: 0;
  font-size: 14px;
}
</style>
