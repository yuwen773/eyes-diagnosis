<template>
  <div class="notification-container">
    <a-page-header title="通知中心" />

    <div class="notification-content">
      <a-tabs v-model:activeKey="activeTab" @change="handleTabChange">
        <a-tab-pane key="all" tab="全部通知" />
        <a-tab-pane key="unread" tab="未读通知" />
        <a-tab-pane key="read" tab="已读通知" />
      </a-tabs>

      <div class="notification-list">
        <a-empty v-if="filteredNotifications.length === 0" description="暂无通知" />
        <div v-else>
          <div
            v-for="notification in filteredNotifications"
            :key="notification.id"
            class="notification-item"
            :class="{ unread: !notification.isRead }"
            @click="handleNotificationClick(notification)"
          >
            <div class="notification-icon">
              <BellOutlined />
            </div>
            <div class="notification-body">
              <div class="notification-title">{{ notification.title }}</div>
              <div class="notification-message">{{ notification.message }}</div>
              <div class="notification-time">{{ formatTime(notification.createTime) }}</div>
            </div>
            <div v-if="!notification.isRead" class="unread-badge"></div>
          </div>
        </div>
      </div>

      <div class="notification-footer">
        <a-button v-if="hasUnread" type="primary" @click="handleMarkAllRead">
          全部标为已读
        </a-button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { BellOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'

interface Notification {
  id: string
  title: string
  message: string
  isRead: boolean
  createTime: number
}

const activeTab = ref('all')
const notifications = ref<Notification[]>([
  {
    id: '1',
    title: '诊断报告已生成',
    message: '您的眼底图像诊断报告已生成，请及时查看。',
    isRead: false,
    createTime: Date.now() - 3600000,
  },
  {
    id: '2',
    title: '复诊提醒',
    message: '您有一项待复诊记录，请注意按时复诊。',
    isRead: false,
    createTime: Date.now() - 86400000,
  },
  {
    id: '3',
    title: '系统更新通知',
    message: '眼疾诊断系统已更新至最新版本。',
    isRead: true,
    createTime: Date.now() - 172800000,
  },
])

const filteredNotifications = computed(() => {
  switch (activeTab.value) {
    case 'unread':
      return notifications.value.filter((n) => !n.isRead)
    case 'read':
      return notifications.value.filter((n) => n.isRead)
    default:
      return notifications.value
  }
})

const hasUnread = computed(() => notifications.value.some((n) => !n.isRead))

const formatTime = (timestamp: number) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

const handleTabChange = () => {
  // Tab change handling if needed
}

const handleNotificationClick = (notification: Notification) => {
  if (!notification.isRead) {
    notification.isRead = true
    message.success('已标记为已读')
  }
}

const handleMarkAllRead = () => {
  notifications.value.forEach((n) => {
    n.isRead = true
  })
  message.success('已全部标为已读')
}

onMounted(() => {
  // Load notifications from API if needed
})
</script>

<style scoped>
.notification-container {
  padding: 24px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  min-height: 400px;
}

.notification-content {
  margin-top: 16px;
}

.notification-list {
  margin-top: 16px;
  max-height: 500px;
  overflow-y: auto;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  padding: 16px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.3s;
  position: relative;
  background: var(--color-bg);
  margin-bottom: 12px;
}

.notification-item:hover {
  background: var(--color-primary-light);
}

.notification-item.unread {
  background: rgba(201, 100, 66, 0.08);
}

.notification-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.notification-icon :deep(.anticon) {
  font-size: 18px;
  color: #c96442;
}

.notification-body {
  flex: 1;
  min-width: 0;
}

.notification-title {
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 4px;
}

.notification-message {
  color: var(--color-text-secondary);
  font-size: 14px;
  margin-bottom: 8px;
}

.notification-time {
  font-size: 12px;
  color: var(--color-text-disabled);
}

.unread-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c96442;
}

.notification-footer {
  margin-top: 24px;
  text-align: center;
}

.notification-footer :deep(.ant-btn-primary) {
  background: #c96442;
  border-color: #c96442;
}

.notification-footer :deep(.ant-btn-primary:hover) {
  background: #b5593a;
  border-color: #b5593a;
}
</style>
