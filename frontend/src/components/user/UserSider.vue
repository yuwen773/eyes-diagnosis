<template>
  <a-layout-sider
    width="240"
    :collapsedWidth="72"
    :collapsed="collapsed"
    class="sider desktop-sider"
    :trigger="null"
  >
    <!-- 折叠切换按钮 -->
    <button
      class="collapse-toggle"
      @click="toggleCollapse"
      :aria-label="collapsed ? '展开侧边栏' : '折叠侧边栏'"
    >
      <MenuFoldOutlined v-if="collapsed" class="collapse-icon" />
      <MenuUnfoldOutlined v-else class="collapse-icon" />
    </button>

    <!-- 通知铃铛 -->
    <div class="notification-bell" @click="emit('notificationClick')">
      <BellOutlined class="bell-icon" />
      <span v-if="unreadCount > 0" class="badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
      <span class="bell-ring"></span>
    </div>

    <!--用户信息卡片-->
    <div class="user-card">
      <div class="user-card-bg"></div>
      <a-avatar
        :size="72"
        :src="loginUser.userAvatar"
        @click="emit('avatarClick')"
        class="user-avatar"
      />
      <div class="user-name">{{ loginUser.userName }}</div>
      <div class="user-role">
        <a-tag :color="loginUser.userRole === 'admin' ? '#1890ff' : '#52c41a'" class="role-tag">
          <template #icon>
            <SafetyCertificateOutlined v-if="loginUser.userRole === 'admin'" />
            <UserOutlined v-else />
          </template>
          {{ loginUser.userRole === 'admin' ? '管理员' : '用户' }}
        </a-tag>
      </div>
    </div>

    <!--导航项 -->
    <a-menu
      :selectedKeys="selectedKeys"
      @update:selectedKeys="emit('update:selectedKeys', $event)"
      mode="inline"
      theme="light"
      @click="handleMenuClick"
      class="nav-menu"
    >
      <a-menu-item key="profile" class="nav-item">
        <template #icon><UserOutlined /></template>
        <a-tooltip title="个人资料" placement="right"><span class="nav-text">个人资料</span></a-tooltip>
      </a-menu-item>
      <a-menu-item key="accountSettings" class="nav-item">
        <template #icon><SettingOutlined /></template>
        <a-tooltip title="账号设置" placement="right"><span class="nav-text">账号设置</span></a-tooltip>
      </a-menu-item>
      <a-menu-item key="diagnosisHistory" class="nav-item">
        <template #icon><HistoryOutlined /></template>
        <a-tooltip title="诊断历史" placement="right"><span class="nav-text">诊断历史</span></a-tooltip>
      </a-menu-item>
      <a-menu-item key="notification" class="nav-item">
        <template #icon><BellOutlined /></template>
        <a-tooltip title="通知中心" placement="right"><span class="nav-text">通知中心</span></a-tooltip>
      </a-menu-item>
    </a-menu>

  </a-layout-sider>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  UserOutlined,
  SettingOutlined,
  HistoryOutlined,
  BellOutlined,
  SafetyCertificateOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons-vue'

interface Props {
  loginUser: API.LoginUserVO
  selectedKeys: string[]
  unreadCount: number
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:selectedKeys', keys: string[]): void
  (e: 'notificationClick'): void
  (e: 'avatarClick'): void
  (e: 'collapse', collapsed: boolean): void
}>()

const router = useRouter()

// 折叠状态，持久化到 localStorage
const collapsed = ref(localStorage.getItem('sidebar-collapsed') === 'true')

watch(collapsed, (val) => {
  localStorage.setItem('sidebar-collapsed', String(val))
  emit('collapse', val)
})

const toggleCollapse = () => {
  collapsed.value = !collapsed.value
}

const handleMenuClick = ({ key }: { key: string }) => {
  router.push(`/user/userCenter/${key}`)
}
</script>

<style scoped>
/* === 侧边栏 === */
.sider {
  background: linear-gradient(180deg, var(--claude-bg-card) 0%, var(--claude-bg-elevated) 100%);
  border-right: 1px solid var(--claude-border-cream);
  padding: var(--claude-space-6) 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

/* === 折叠切换按钮 === */
.collapse-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 var(--claude-space-6) var(--claude-space-4);
  padding: var(--claude-space-3);
  border-radius: var(--claude-radius-md);
  background: transparent;
  border: 1px solid var(--claude-border-cream);
  cursor: pointer;
  color: var(--claude-text-secondary);
  transition: all var(--claude-transition-base);
}

.collapse-toggle:hover {
  background: var(--claude-bg-hover);
  border-color: var(--claude-brand);
  color: var(--claude-brand);
}

.collapse-icon {
  font-size: 16px;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.desktop-sider.collapsed .collapse-toggle {
  margin: 0 var(--claude-space-2) var(--claude-space-4);
}

.desktop-sider.collapsed .collapse-toggle .collapse-icon {
  transform: rotate(180deg);
}


/* === 通知铃铛 === */
.notification-bell {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin: 0 var(--claude-space-6) var(--claude-space-5);
  padding: var(--claude-space-3) var(--claude-space-4);
  border-radius: var(--claude-radius-lg);
  background: var(--claude-bg-elevated);
  cursor: pointer;
  transition: all var(--claude-transition-base);
  border: 1px solid var(--claude-border-cream);
}

.notification-bell:hover {
  background: var(--claude-bg-hover);
  border-color: var(--claude-border-warm);
  transform: scale(1.02);
}

.notification-bell:hover .bell-ring {
  animation: ring 0.5s ease-in-out;
}

.bell-icon {
  font-size: 22px;
  color: var(--claude-text-primary);
  transition: color var(--claude-transition-fast);
}

.notification-bell:hover .bell-icon {
  color: var(--claude-brand);
}

.badge {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--claude-error);
  border-radius: 9px;
  padding: 0 5px;
  box-shadow: 0 2px 4px rgba(181, 51, 51, 0.3);
}

.bell-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 30px;
  height: 30px;
  border: 2px solid var(--claude-brand);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
}

@keyframes ring {
  0% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.3); opacity: 0; }
  100% { transform: scale(1); opacity: 0; }
}

/* === 用户卡片 === */
.user-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--claude-space-5) var(--claude-space-6) var(--claude-space-6);
  margin: 0 var(--claude-space-4) var(--claude-space-5);
  border-radius: var(--claude-radius-lg);
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  position: relative;
  overflow: hidden;
}

.user-card-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50px;
  background: linear-gradient(135deg, var(--claude-brand) 0%, var(--claude-brand-light) 100%);
  opacity: 0.1;
}

.user-avatar {
  cursor: pointer;
  transition: all var(--claude-transition-base);
  border: 3px solid var(--claude-bg-elevated);
  box-shadow: 0 4px 12px rgba(20, 20, 19, 0.15);
  position: relative;
  z-index: 1;
}

.user-avatar:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(201, 100, 66, 0.25);
}

.user-name {
  font-family: var(--claude-font-serif);
  font-size: 18px;
  font-weight: 600;
  margin: var(--claude-space-3) 0 var(--claude-space-2);
  color: var(--claude-text-primary);
  text-align: center;
}

.user-role {
  margin-bottom: 0;
}

.role-tag {
  border-radius: 20px;
  font-size: 12px;
}

/* === 导航菜单 === */
.nav-menu {
  flex: 1;
  border-right: 0 !important;
  background: transparent;
  padding: 0 var(--claude-space-3);
}

.nav-item {
  margin: var(--claude-space-2) 0;
  border-radius: var(--claude-radius-md) !important;
  height: 48px;
  line-height: 48px;
  transition: all var(--claude-transition-base);
  position: relative;
  overflow: hidden;
}

.nav-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 24px;
  background: var(--claude-brand);
  border-radius: 0 2px 2px 0;
  transition: transform var(--claude-transition-base);
}

.nav-item:hover {
  background: var(--claude-bg-hover) !important;
}

.nav-item:hover::before {
  transform: translateY(-50%) scaleY(1);
}

.nav-item-selected {
  background: rgba(201, 100, 66, 0.1) !important;
}

.nav-item-selected::before {
  transform: translateY(-50%) scaleY(1);
}

.nav-item-selected .anticon {
  color: var(--claude-brand) !important;
}

.nav-item-selected .nav-text {
  color: var(--claude-brand);
  font-weight: 500;
}

.nav-text {
  font-size: 15px;
  margin-left: var(--claude-space-2);
}

/* === 响应式：中等屏幕侧边栏收缩 === */
@media (max-width: 991px) and (min-width: 768px) {
  .desktop-sider {
    width: 72px !important;
  }

  .desktop-sider .user-card {
    padding: var(--claude-space-3);
    margin: 0 var(--claude-space-2) var(--claude-space-4);
  }

  .desktop-sider .user-card .user-avatar {
    width: 44px !important;
    height: 44px !important;
  }

  .desktop-sider .user-name,
  .desktop-sider .user-role,
  .desktop-sider .nav-text {
    display: none;
  }

  .desktop-sider .nav-item {
    justify-content: center;
    padding: 0 !important;
  }

  .desktop-sider .notification-bell {
    margin: 0 var(--claude-space-2) var(--claude-space-4);
  }
}
</style>
