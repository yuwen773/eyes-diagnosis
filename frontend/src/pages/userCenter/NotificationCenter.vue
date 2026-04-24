<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  BellOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  InboxOutlined
} from '@ant-design/icons-vue'
import { useNotificationStore } from '@/stores/notification'
import type { Notification } from '@/stores/notification'
import NotificationStats from '@/components/user/NotificationStats.vue'
import NotificationItem from '@/components/user/NotificationItem.vue'

const notificationStore = useNotificationStore()

const activeTab = ref('all')

const filteredNotifications = computed(() => {
  switch (activeTab.value) {
    case 'unread':
      return notificationStore.notifications.filter((n) => !n.isRead)
    case 'read':
      return notificationStore.notifications.filter((n) => n.isRead)
    default:
      return notificationStore.notifications
  }
})

const hasUnread = computed(() => notificationStore.unreadCount > 0)

onMounted(() => {
  notificationStore.fetchNotifications()
})

const handleNotificationClick = (notification: Notification) => {
  if (!notification.isRead) {
    notificationStore.markAsRead(notification.id)
    message.success('已标记为已读')
  }
}

const handleMarkRead = (notification: Notification) => {
  notificationStore.markAsRead(notification.id)
  message.success('已标记为已读')
}

const handleMarkAllRead = () => {
  notificationStore.markAllAsRead()
  message.success('已全部标为已读')
}

const handleDelete = (notification: Notification) => {
  notificationStore.deleteNotification(notification.id)
  message.success('通知已删除')
}
</script>

<template>
  <div class="notification-container">
    <a-page-header title="通知中心" class="page-header">
      <template #extra>
        <a-button
          v-if="hasUnread"
          type="primary"
          class="mark-read-btn"
          @click="handleMarkAllRead"
        >
          <template #icon><CheckOutlined /></template>
          全部已读
        </a-button>
      </template>
    </a-page-header>

    <!-- 通知统计 -->
    <NotificationStats
      :total="notificationStore.notifications.length"
      :unread-count="notificationStore.unreadCount"
      :read-count="notificationStore.readCount"
    />

    <!-- 标签页 -->
    <div class="notification-tabs">
      <a-tabs v-model:activeKey="activeTab" class="tabs">
        <a-tab-pane key="all">
          <template #tab>
            <span class="tab-label">
              <InboxOutlined />
              全部通知
              <span class="tab-count">{{ notificationStore.notifications.length }}</span>
            </span>
          </template>
        </a-tab-pane>
        <a-tab-pane key="unread">
          <template #tab>
            <span class="tab-label">
              <BellOutlined />
              未读通知
              <span class="tab-count" v-if="notificationStore.unreadCount > 0">{{ notificationStore.unreadCount }}</span>
            </span>
          </template>
        </a-tab-pane>
        <a-tab-pane key="read">
          <template #tab>
            <span class="tab-label">
              <CheckCircleOutlined />
              已读通知
            </span>
          </template>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 通知列表 -->
    <div class="notification-list">
      <a-empty v-if="filteredNotifications.length === 0" class="empty-state">
        <template #image>
          <BellOutlined class="empty-icon" />
        </template>
        <template #description>
          <span class="empty-text">暂无通知</span>
        </template>
      </a-empty>

      <transition-group name="list" tag="div" class="notification-items" v-else>
        <NotificationItem
          v-for="notification in filteredNotifications"
          :key="notification.id"
          :notification="notification"
          @click="handleNotificationClick"
          @mark-read="handleMarkRead"
          @delete="handleDelete"
        />
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
.notification-container {
  flex: 1;
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* === 页面标题 === */
.page-header {
  margin-bottom: var(--claude-space-5);
  padding: 0;
  background: transparent;
}

.page-header :deep(.ant-page-header-content) {
  padding: 0;
}

.mark-read-btn {
  background: var(--claude-brand);
  border-color: var(--claude-brand);
  border-radius: var(--claude-radius-md);
  transition: all var(--claude-transition-base);
}

.mark-read-btn:hover {
  background: var(--claude-brand-dark) !important;
  border-color: var(--claude-brand-dark) !important;
}

/* === 标签页 === */
.notification-tabs {
  margin-bottom: var(--claude-space-5);
}

.tabs :deep(.ant-tabs-nav) {
  margin-bottom: 0;
}

.tabs :deep(.ant-tabs-tab) {
  padding: var(--claude-space-3) 0;
  font-size: 15px;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--claude-brand);
  border-radius: 10px;
  margin-left: 4px;
}

/* === 通知列表 === */
.notification-list {
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-4);
  min-height: 300px;
}

.notification-items {
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-3);
}

/* === 空状态 === */
.empty-state {
  padding: var(--claude-space-12) 0;
}

.empty-icon {
  font-size: 48px;
  color: var(--claude-text-disabled);
}

.empty-text {
  color: var(--claude-text-tertiary);
  font-size: 15px;
}

/* === 列表动画 === */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
