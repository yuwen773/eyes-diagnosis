<template>
  <div class="notification-panel">
    <div class="panel-header">
      <h3>通知</h3>
      <a-button
        v-if="unreadCount > 0"
        type="link"
        size="small"
        @click="handleMarkAllAsRead"
      >
        全部已读
      </a-button>
    </div>

    <div v-if="loading" class="loading-state">
      <a-spin size="large" />
    </div>

    <div v-else-if="notifications.length === 0" class="empty-state">
      <BellOutlined class="empty-icon" />
      <p>暂无通知</p>
    </div>

    <div v-else class="notification-list">
      <div
        v-for="notification in notifications"
        :key="notification.id"
        class="notification-item"
        :class="{ unread: !notification.isRead }"
      >
        <div class="item-icon" :class="notification.type">
          <FileTextOutlined v-if="notification.type === 'report'" />
          <ScheduleOutlined v-else-if="notification.type === 'reexamine'" />
          <NotificationOutlined v-else />
        </div>

        <div class="item-content">
          <div class="item-header">
            <span class="item-title">{{ notification.title }}</span>
            <a-badge
              v-if="notification.isRead"
              status="default"
              text="已读"
              class="read-badge"
            />
          </div>
          <p class="item-text">{{ notification.content }}</p>
          <span class="item-time">{{ formatTime(notification.createTime) }}</span>
        </div>

        <div class="item-actions">
          <a-button
            v-if="!notification.isRead"
            type="text"
            size="small"
            @click="handleMarkAsRead(notification.id)"
          >
            标记已读
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { BellOutlined, FileTextOutlined, ScheduleOutlined, NotificationOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useNotificationStore } from '@/stores/notification'

dayjs.extend(relativeTime)

const notificationStore = useNotificationStore()
const loading = ref(false)

const notifications = computed(() => notificationStore.notifications)
const unreadCount = computed(() => notificationStore.unreadCount)

const formatTime = (time: string) => {
  return dayjs(time).fromNow()
}

const handleMarkAsRead = async (id: string) => {
  notificationStore.markAsRead(id)
  message.success('已标记为已读')
}

const handleMarkAllAsRead = async () => {
  notificationStore.markAllAsRead()
  message.success('已全部标记为已读')
}

onMounted(async () => {
  loading.value = true
  try {
    await notificationStore.fetchNotifications()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.notification-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-ivory);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border-cream);
}

.panel-header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-near-black);
}

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  color: var(--color-stone-gray);
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: var(--space-4);
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: var(--text-base);
}

.notification-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
  background: transparent;
}

.notification-item:hover {
  background: var(--color-parchment);
}

.notification-item.unread {
  background: #f5f4ed;
}

.notification-item.unread:hover {
  background: #edecea;
}

.item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  font-size: var(--text-base);
  color: #fff;
}

.item-icon.report {
  background: #3898ec;
}

.item-icon.reexamine {
  background: #4a7c59;
}

.item-icon.system {
  background: #87867f;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.item-title {
  font-weight: 500;
  color: var(--color-near-black);
  font-size: var(--text-sm);
}

.read-badge {
  font-size: var(--text-xs);
}

.read-badge :deep(.ant-badge-status-text) {
  color: var(--color-stone-gray);
}

.item-text {
  margin: 0 0 var(--space-1) 0;
  font-size: var(--text-sm);
  color: var(--color-olive-gray);
  line-height: var(--leading-normal);
}

.item-time {
  font-size: var(--text-xs);
  color: var(--color-stone-gray);
}

.item-actions {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.notification-item:hover .item-actions {
  opacity: 1;
}
</style>
