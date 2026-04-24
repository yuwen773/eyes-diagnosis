<template>
  <div class="agent-chat-page">
    <AgentChatLayout
      :left-collapsed="leftCollapsed"
      :right-expanded="resourcePanelVisible"
    >
      <!-- 左栏 -->
      <template #left>
        <LeftSidebar
          :histories="histories"
          :active-id="currentThreadId"
          @new-chat="handleNewChat"
          @select="handleSelectHistory"
          @collapse="leftCollapsed = true"
          @settings="settingsModalVisible = true"
        />
      </template>

      <!-- 中间 -->
      <template #center>
        <!-- 左折叠按钮组 -->
        <div v-if="leftCollapsed" class="collapsed-actions">
          <button
            class="toggle-left-btn"
            @click="leftCollapsed = false"
            aria-label="展开侧边栏"
            title="展开侧边栏"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <button
            class="quick-new-chat-btn"
            @click="handleNewChat"
            aria-label="新对话"
            title="新对话"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <!-- 右栏切换按钮 -->
        <button
          class="toggle-right-btn"
          :class="{ active: resourcePanelVisible }"
          @click="resourcePanelVisible = !resourcePanelVisible"
          aria-label="切换资源面板"
          title="资源面板"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span v-if="totalResourceCount > 0" class="resource-badge">{{ totalResourceCount }}</span>
        </button>

        <!-- 消息列表 -->
        <AgentMessageList
          :messages="messages"
          :loading="streaming || historyLoading"
          @confirm="handleConfirm"
          @cancel="handleCancel"
          @send="handleSend"
          @toggle-resources="toggleResourcePanel"
        />

        <!-- 底部区域：输入框 -->
        <div class="bottom-area">
          <AgentChatInput
            :loading="streaming"
            @send="handleSend"
            @stop="abort"
          />
        </div>
      </template>

      <!-- 右栏 -->
      <template #right>
        <AgentResourcePanel
          :images="panelImages"
          :links="panelLinks"
          @close="resourcePanelVisible = false"
          @preview-image="handlePreviewImage"
          @download-image="handleDownloadImage"
        />
      </template>
    </AgentChatLayout>

    <!-- 图片预览弹窗 -->
    <ImagePreview v-model:open="previewVisible" :url="previewUrl" />

    <!-- MCP 服务管理抽屉 -->
    <SettingsModal v-model:open="settingsModalVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import AgentChatLayout from '@/components/agent/AgentChatLayout.vue'
import type { HistoryItem } from '@/components/agent/LeftSidebar.vue'
import LeftSidebar from '@/components/agent/LeftSidebar.vue'
import AgentMessageList from '@/components/agent/AgentMessageList.vue'
import AgentChatInput from '@/components/agent/AgentChatInput.vue'
import AgentResourcePanel from '@/components/agent/AgentResourcePanel.vue'
import ImagePreview from '@/components/ImagePreview.vue'
import SettingsModal from '@/components/agent/settings/SettingsModal.vue'
import type { ResourceData, ImageResource, LinkResource } from '@/components/agent/types'
import { useAgentStream } from '@/composables/useAgentStream'
import { getChatHistory, getSessions, type SessionVO } from '@/api/agentController'
import '@/assets/agent-theme.css'

const THREAD_ID_KEY = 'agent_current_thread_id'
const DATE_LOCALE = 'zh-CN'
const TIME_OPTIONS = { hour: '2-digit', minute: '2-digit' } as const

const generateThreadId = () => crypto.randomUUID()

const loadThreadId = (): string => {
  return localStorage.getItem(THREAD_ID_KEY) || ''
}

const saveThreadId = (id: string) => {
  if (id) localStorage.setItem(THREAD_ID_KEY, id)
  else localStorage.removeItem(THREAD_ID_KEY)
}

// State
const threadId = ref(generateThreadId())
const currentThreadId = ref('')
const leftCollapsed = ref(false)
const resourcePanelVisible = ref(false)
const panelImages = ref<ImageResource[]>([])
const panelLinks = ref<LinkResource[]>([])
const historyLoading = ref(false)

// Sessions
const sessions = ref<SessionVO[]>([])

const loadSessions = async () => {
  try {
    const res = await getSessions(undefined, 20)
    sessions.value = res?.data || []
  } catch (e) {
    console.warn('加载会话列表失败:', e)
  }
}

const histories = computed<HistoryItem[]>(() =>
  sessions.value.map(s => ({
    id: s.sessionId,
    title: s.title || '新对话',
    time: s.updatedTime ? new Date(s.updatedTime).toLocaleString(DATE_LOCALE) : '',
  }))
)

const loadHistoryMessages = async (sessionId: string) => {
  historyLoading.value = true
  try {
    const res = await getChatHistory(sessionId, undefined, 100)
    const data = res?.data
    if (!data?.messages) return

    messages.value = data.messages
      .map((m: any) => {
        let type: string
        if (m.role === 'USER') {
          type = 'user'
        } else {
          switch (m.subType) {
            case 'reasoning': type = 'reasoning'; break
            case 'tool-call': type = 'tool-request'; break
            case 'tool-result': type = 'tool-response'; break
            default: type = 'assistant'
          }
        }
        return {
          type,
          content: m.content,
          toolName: (m.subType === 'tool-call' || m.subType === 'tool-result') ? m.content.split(':')[0] || '工具' : undefined,
          node: 'agent',
          isLoading: false,
          time: m.createdTime
            ? new Date(m.createdTime).toLocaleTimeString(DATE_LOCALE, TIME_OPTIONS)
            : '',
        }
      })
  } catch (e) {
    console.warn('加载历史消息失败:', e)
    message.warning('历史消息加载失败')
  } finally {
    historyLoading.value = false
  }
}

onMounted(async () => {
  const savedThreadId = loadThreadId()
  await Promise.all([
    loadSessions(),
    savedThreadId ? loadHistoryMessages(savedThreadId) : Promise.resolve(),
  ])
  currentThreadId.value = savedThreadId
  threadId.value = savedThreadId
})

// Agent stream
const agentStream = useAgentStream()
const messages = agentStream.messages
const streaming = agentStream.isStreaming
const sendMessage = agentStream.sendMessage
const abort = agentStream.abort
const pushMessage = agentStream.pushMessage
const resetStream = agentStream.reset

const totalResourceCount = computed(() => panelImages.value.length + panelLinks.value.length)

// Handlers
const handleSend = async (text: string, files: File[] = []) => {
  if ((!text.trim() && files.length === 0) || streaming.value) return

  pushMessage({
    type: 'user',
    content: text,
    time: new Date().toLocaleTimeString(DATE_LOCALE, TIME_OPTIONS),
  })

  try {
    await sendMessage(text, threadId.value, files.length > 0 ? files : undefined)
    saveThreadId(threadId.value)
    currentThreadId.value = threadId.value
  } catch (error) {
    message.error('发送失败，请重试')
  }
}

const handleNewChat = () => {
  saveThreadId('')
  currentThreadId.value = ''
  threadId.value = generateThreadId()
  resetStream()
  resourcePanelVisible.value = false
}

const handleSelectHistory = async (id: string) => {
  currentThreadId.value = id
  threadId.value = id
  saveThreadId(id)
  resetStream()
  await loadHistoryMessages(id)
}

const toggleResourcePanel = (data?: ResourceData) => {
  if (data) {
    panelImages.value = data.images
    panelLinks.value = data.links
  }
  resourcePanelVisible.value = !resourcePanelVisible.value
}

const handleConfirm = () => {}
const handleCancel = () => {}

// 图片预览
const previewVisible = ref(false)
const previewUrl = ref('')
const settingsModalVisible = ref(false)

const handlePreviewImage = (url: string) => {
  previewUrl.value = url
  previewVisible.value = true
}

const handleDownloadImage = (url: string) => { window.open(url, '_blank') }
</script>

<style scoped>
.agent-chat-page {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-primary, #f5f5f5);
  position: relative;
  display: flex;
  flex-direction: column;
}

.collapsed-actions {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toggle-left-btn,
.quick-new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  background: #fff;
  color: #999;
  cursor: pointer;
  transition: all 0.15s ease;
}

.toggle-left-btn:hover,
.quick-new-chat-btn:hover {
  color: #333;
  border-color: #d9d9d9;
}

.quick-new-chat-btn:hover {
  color: var(--claude-brand);
  border-color: var(--claude-brand);
}

.toggle-right-btn {
  position: absolute;
  top: 14px;
  right: 20px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  background: #fff;
  color: #999;
  cursor: pointer;
  transition: all 0.15s ease;
}

.toggle-right-btn:hover {
  color: #333;
  border-color: #d9d9d9;
}

.toggle-right-btn.active {
  color: var(--claude-brand);
  border-color: var(--claude-brand);
  background: rgba(24, 144, 255, 0.08);
}

.resource-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--claude-brand);
  color: white;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}

.bottom-area {
  flex-shrink: 0;
  border-top: 1px solid #f0f0f0;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
}
</style>
