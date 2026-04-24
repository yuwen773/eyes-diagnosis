<script setup lang="ts">
import {
  BellOutlined,
  FileSearchOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue'
import type { Notification } from '@/stores/notification'

interface Props {
  notification: Notification
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'click', notification: Notification): void
  (e: 'markRead', notification: Notification): void
  (e: 'delete', notification: Notification): void
}>()

const getIconClass = (type: string) => {
  return {
    'icon-system': type === 'system',
    'icon-diagnosis': type === 'diagnosis',
    'icon-reminder': type === 'reminder',
    'icon-message': type === 'message'
  }
}

const formatTime = (timestamp: string | number) => {
  const now = Date.now()
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp
  const diff = now - ts
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div
    class="notification-item"
    :class="{ unread: !notification.isRead }"
    @click="emit('click', notification)"
  >
    <div class="item-indicator" v-if="!notification.isRead"></div>

    <div class="notification-icon" :class="getIconClass(notification.type)">
      <BellOutlined v-if="notification.type === 'system'" />
      <FileSearchOutlined v-else-if="notification.type === 'diagnosis'" />
      <ClockCircleOutlined v-else-if="notification.type === 'reminder'" />
      <MessageOutlined v-else />
    </div>

    <div class="notification-content">
      <div class="notification-header">
        <span class="notification-title">{{ notification.title }}</span>
        <span class="notification-time">{{ formatTime(notification.createTime) }}</span>
      </div>
      <div class="notification-message">{{ notification.message }}</div>
    </div>

    <div class="notification-actions">
      <a-tooltip title="标记已读">
        <CheckCircleOutlined
          class="action-icon"
          v-if="!notification.isRead"
          @click.stop="emit('markRead', notification)"
        />
      </a-tooltip>
      <a-tooltip title="删除">
        <DeleteOutlined
          class="action-icon delete"
          @click.stop="emit('delete', notification)"
        />
      </a-tooltip>
    </div>
  </div>
</template>

<style scoped>
.notification-item {
  display: flex;
  align-items: flex-start;
  gap: var(--claude-space-4);
  padding: var(--claude-space-4);
  border-radius: var(--claude-radius-md);
  cursor: pointer;
  transition: all var(--claude-transition-base);
  position: relative;
  background: var(--claude-bg-card);
  border: 1px solid transparent;
}

.notification-item:hover {
  background: var(--claude-bg-hover);
  border-color: var(--claude-border-cream);
}

.notification-item.unread {
  background: rgba(201, 100, 66, 0.05);
  border-color: rgba(201, 100, 66, 0.15);
}

.notification-item.unread:hover {
  background: rgba(201, 100, 66, 0.08);
}

.item-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 60%;
  background: var(--claude-brand);
  border-radius: 0 2px 2px 0;
}

.notification-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--claude-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 20px;
  transition: all var(--claude-transition-base);
}

.icon-system {
  background: rgba(56, 152, 236, 0.1);
  color: #3898ec;
}

.icon-diagnosis {
  background: rgba(82, 196, 26, 0.1);
  color: #52c41a;
}

.icon-reminder {
  background: rgba(250, 173, 20, 0.1);
  color: #faad14;
}

.icon-message {
  background: rgba(201, 100, 66, 0.1);
  color: var(--claude-brand);
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--claude-space-3);
  margin-bottom: var(--claude-space-2);
}

.notification-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--claude-text-primary);
}

.notification-time {
  font-size: 12px;
  color: var(--claude-text-tertiary);
  white-space: nowrap;
}

.notification-message {
  font-size: 14px;
  color: var(--claude-text-secondary);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
  opacity: 0;
  transition: opacity var(--claude-transition-base);
}

.notification-item:hover .notification-actions {
  opacity: 1;
}

.action-icon {
  padding: var(--claude-space-2);
  font-size: 16px;
  color: var(--claude-text-tertiary);
  cursor: pointer;
  transition: all var(--claude-transition-fast);
  border-radius: var(--claude-radius-sm);
}

.action-icon:hover {
  color: var(--claude-brand);
  background: var(--claude-bg-hover);
}

.action-icon.delete:hover {
  color: var(--claude-error);
}

@media (max-width: 768px) {
  .notification-item {
    padding: var(--claude-space-3);
  }

  .notification-icon {
    width: 36px;
    height: 36px;
    font-size: 16px;
  }

  .notification-actions {
    opacity: 1;
  }
}
</style>
