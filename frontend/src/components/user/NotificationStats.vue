<script setup lang="ts">
interface Props {
  total: number
  unreadCount: number
  readCount: number
}

defineProps<Props>()
</script>

<template>
  <div class="notification-stats">
    <div class="stat-item">
      <div class="stat-value">{{ total }}</div>
      <div class="stat-label">全部通知</div>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <div class="stat-value unread">{{ unreadCount }}</div>
      <div class="stat-label">未读</div>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <div class="stat-value">{{ readCount }}</div>
      <div class="stat-label">已读</div>
    </div>
  </div>
</template>

<style scoped>
.notification-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--claude-space-6);
  padding: var(--claude-space-5);
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-lg);
  margin-bottom: var(--claude-space-5);
}

.stat-item {
  text-align: center;
  min-width: 80px;
}

.stat-value {
  font-family: var(--claude-font-serif);
  font-size: 28px;
  font-weight: 600;
  color: var(--claude-text-primary);
  line-height: 1.2;
}

.stat-value.unread {
  color: var(--claude-brand);
}

.stat-label {
  font-size: 13px;
  color: var(--claude-text-tertiary);
  margin-top: 4px;
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: var(--claude-border-cream);
}

@media (max-width: 768px) {
  .notification-stats {
    gap: var(--claude-space-4);
    padding: var(--claude-space-4);
  }

  .stat-value {
    font-size: 24px;
  }
}
</style>
