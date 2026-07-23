<template>
  <div class="mobile-tabs-wrapper">
    <div class="mobile-header">
      <div class="mobile-user-info" @click="emit('avatarClick')">
        <a-avatar :size="36" :src="loginUser.userAvatar" />
        <span class="mobile-user-name">{{ loginUser.userName }}</span>
      </div>
      <div class="mobile-notification-bell" @click="emit('notificationClick')">
        <BellOutlined class="bell-icon" />
        <span v-if="unreadCount > 0" class="badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
      </div>
    </div>
    <a-tabs :activeKey="activeTab" @change="handleTabChange" class="mobile-tabs">
      <a-tab-pane key="profile">
        <template #tab>
          <div class="mobile-tab-item">
            <UserOutlined class="tab-icon" />
            <span class="tab-label">资料</span>
          </div>
        </template>
      </a-tab-pane>
      <a-tab-pane key="accountSettings">
        <template #tab>
          <div class="mobile-tab-item">
            <SettingOutlined class="tab-icon" />
            <span class="tab-label">设置</span>
          </div>
        </template>
      </a-tab-pane>
      <a-tab-pane key="diagnosisHistory">
        <template #tab>
          <div class="mobile-tab-item">
            <HistoryOutlined class="tab-icon" />
            <span class="tab-label">历史</span>
          </div>
        </template>
      </a-tab-pane>
      <a-tab-pane key="notification">
        <template #tab>
          <div class="mobile-tab-item">
            <BellOutlined class="tab-icon" />
            <span class="tab-label">通知</span>
          </div>
        </template>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import {
  UserOutlined,
  SettingOutlined,
  HistoryOutlined,
  BellOutlined
} from '@ant-design/icons-vue'

interface Props {
  loginUser: API.LoginUserVO
  activeTab: string
  unreadCount: number
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:activeTab', key: string): void
  (e: 'notificationClick'): void
  (e: 'avatarClick'): void
}>()

const router = useRouter()

const handleTabChange = (key: string) => {
  router.push(`/user/userCenter/${key}`)
  emit('update:activeTab', key)
}
</script>

<style scoped>
/* === 移动端标签导航 === */
.mobile-tabs-wrapper {
  width: 100%;
  background: var(--claude-bg-card);
  border-bottom: 1px solid var(--claude-border-cream);
}

.mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--claude-space-3) var(--claude-space-4);
  border-bottom: 1px solid var(--claude-border-cream);
}

.mobile-user-info {
  display: flex;
  align-items: center;
  gap: var(--claude-space-3);
  cursor: pointer;
}

.mobile-user-name {
  font-family: var(--claude-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--claude-text-primary);
}

.mobile-notification-bell {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: var(--claude-space-2);
  border-radius: var(--claude-radius-md);
  background: var(--claude-bg-elevated);
  cursor: pointer;
  border: 1px solid var(--claude-border-cream);
}

.mobile-notification-bell .bell-icon {
  font-size: 18px;
  color: var(--claude-text-primary);
}

.mobile-notification-bell .badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: var(--claude-error);
  border-radius: 8px;
  padding: 0 4px;
}

.mobile-tabs {
  background: var(--claude-bg-card);
}

.mobile-tabs :deep(.ant-tabs-nav) {
  margin: 0;
}

.mobile-tabs :deep(.ant-tabs-tab) {
  padding: var(--claude-space-2) 0;
  margin: 0;
}

.mobile-tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.tab-icon {
  font-size: 18px;
}

.tab-label {
  font-size: 11px;
}

/* === 桌面端隐藏移动端导航 === */
@media (min-width: 768px) {
  .mobile-tabs-wrapper {
    display: none !important;
  }
}
</style>
