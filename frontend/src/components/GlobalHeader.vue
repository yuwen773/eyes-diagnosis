<script lang="ts" setup>
import { computed, h, ref, type Component } from 'vue'
import {
  HomeOutlined,
  SettingOutlined,
  MedicineBoxOutlined,
  RobotOutlined,
  ReadOutlined,
} from '@ant-design/icons-vue'
import { type MenuProps, message } from 'ant-design-vue'
import { useLoginUserStore } from '@/stores/user'
import { useRouter } from "vue-router"
import checkAccess from '@/utils/access/checkAccess'
import { userLogout } from '@/api/userController'
import AvatarDropdown from '@/components/user/AvatarDropdown.vue'

const loginUserStore = useLoginUserStore()
const current = ref<string[]>([])
const router = useRouter()

const doMenuClick = ({key}: {key: string}) => {
  router.push({ path: key })
}

router.afterEach((to) => {
  current.value = [to.path]
})

const doLogout = async () => {
  const res = await userLogout()
  if(res.data.code === 0) {
    loginUserStore.setLoginUser({ userName: '未登录' })
    message.success('退出登录成功')
    await router.push('/user/login')
  } else {
    message.error('退出登录失败'+res.data.msg)
  }
}

const iconMap: Record<string, Component> = {
  HomeOutlined,
  SettingOutlined,
  MedicineBoxOutlined,
  RobotOutlined,
  ReadOutlined,
}

const menuToRouteItem = (item: any) => {
  const iconName = item.meta?.icon as string
  return {
    key: item.path,
    label: item.name,
    title: item.name,
    icon: iconName ? h(iconMap[iconName] ?? iconName) : undefined,
  }
}

const originItems = computed(() => {
  return router.getRoutes()
    .filter((item) => {
      if(item.meta?.hideInMenu) return false
      if(!item.meta?.icon) return false
      return checkAccess(loginUserStore.loginUser, item.meta?.access as string)
    })
    .map(menuToRouteItem)
})

const items = ref<MenuProps['items']>(originItems.value)

const isAdmin = computed(() => loginUserStore.loginUser.userRole === 'admin')
</script>

<template>
  <header id="globalHeader" class="header-container">
    <!-- Warm ambient glow -->
    <div class="header-atmosphere" aria-hidden="true"></div>

    <div class="header-inner">
      <RouterLink to="/" class="header-brand">
        <div class="brand-icon">
          <img class="logo" src="../assets/eyesight-logo.svg" alt="EyeSight" />
          <div class="brand-icon-glow"></div>
        </div>
        <div class="brand-text">
          <span class="brand-name">EyeSight</span>
          <span class="brand-tagline">智能眼科诊断</span>
        </div>
      </RouterLink>

      <nav class="header-nav">
        <a-menu
          v-model:selectedKeys="current"
          mode="horizontal"
          :items="items"
          @click="doMenuClick"
          class="header-menu"
        />
      </nav>

      <div class="header-actions">
        <div v-if="loginUserStore.loginUser.id" class="user-logged-in">
          <AvatarDropdown @logout="doLogout" />
          <span class="user-name">{{ loginUserStore.loginUser.userName ?? '无名' }}</span>
        </div>
        <RouterLink v-else to="/user/login" class="login-link">
          登录
        </RouterLink>
      </div>
    </div>

    <!-- Terracotta accent — the signature moment -->
    <div class="header-accent" aria-hidden="true"></div>
  </header>
</template>

<style scoped>
/* ─── Container ─── */
.header-container {
  position: relative;
  background:
    linear-gradient(180deg, oklch(0.22 0.012 55) 0%, oklch(0.18 0.015 50) 100%);
  box-shadow:
    0 4px 24px oklch(0.12 0.02 40 / 0.25),
    0 1px 0 oklch(0.14 0.015 50);
  z-index: var(--claude-z-sticky, 200);
  animation: header-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes header-enter {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}

/* ─── Ambient atmosphere ─── */
.header-atmosphere {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 60% 100% at 15% 50%,
      oklch(0.55 0.08 30 / 0.07) 0%,
      transparent 70%
    );
  pointer-events: none;
}

/* ─── Inner layout ─── */
.header-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 32px;
  height: 80px;
  display: flex;
  align-items: center;
  gap: 24px;
  position: relative;
  z-index: 1;
}

/* ─── Brand ─── */
.header-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  flex-shrink: 0;
}

.brand-icon {
  position: relative;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo {
  height: 38px;
  width: auto;
  position: relative;
  z-index: 1;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.brand-icon-glow {
  position: absolute;
  inset: -6px;
  background: radial-gradient(
    circle at center,
    oklch(0.6 0.12 30 / 0.2) 0%,
    transparent 70%
  );
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.header-brand:hover .brand-icon-glow {
  opacity: 1;
}

.header-brand:hover .logo {
  transform: scale(1.06);
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.brand-name {
  font-family: var(--claude-font-serif);
  font-size: 24px;
  font-weight: 700;
  color: oklch(0.97 0.005 80);
  letter-spacing: 3px;
  line-height: 1.15;
}

.brand-tagline {
  font-family: var(--claude-font-sans);
  font-size: 11px;
  font-weight: 400;
  color: oklch(0.65 0.015 60);
  letter-spacing: 4px;
}

/* ─── Navigation ─── */
.header-nav {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

:deep(.ant-menu-horizontal) {
  line-height: 80px !important;
  border-bottom: none !important;
  background: transparent !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item),
:deep(.ant-menu-horizontal > .ant-menu-submenu) {
  font-size: 16px !important;
  font-weight: 500 !important;
  height: 80px !important;
  line-height: 80px !important;
  padding: 0 18px !important;
  margin: 0 4px !important;
  color: oklch(0.72 0.01 70) !important;
  transition: color 0.25s ease !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item:hover),
:deep(.ant-menu-horizontal > .ant-menu-submenu:hover) {
  color: oklch(0.95 0.005 80) !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item-selected) {
  color: oklch(0.95 0.005 80) !important;
  font-weight: 600 !important;
}

/* Terracotta underline indicator */
:deep(.ant-menu-horizontal > .ant-menu-item::after),
:deep(.ant-menu-horizontal > .ant-menu-submenu::after) {
  height: 2px !important;
  bottom: 0 !important;
  border-color: oklch(0.6 0.1 30) !important;
  transition: border-color 0.25s ease !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item-selected::after) {
  border-color: oklch(0.6 0.1 30) !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item:hover::after),
:deep(.ant-menu-horizontal > .ant-menu-submenu:hover::after) {
  border-color: oklch(0.6 0.12 35) !important;
}

/* ─── Actions ─── */
.header-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 100%;
}

.user-logged-in {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-name {
  color: oklch(0.82 0.008 70);
  font-size: 15px;
  font-weight: 500;
}

.login-link {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 28px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1px;
  color: oklch(0.55 0.08 30);
  background: oklch(0.96 0.005 80);
  border-radius: 100px;
  text-decoration: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px oklch(0.12 0.01 40 / 0.15);
}

.login-link:hover {
  background: oklch(0.6 0.1 30);
  color: oklch(0.98 0.005 80);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px oklch(0.45 0.08 30 / 0.3);
}

/* ─── Terracotta accent line — hero moment ─── */
.header-accent {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(0.6 0.12 30 / 0.4) 15%,
    oklch(0.6 0.12 30) 50%,
    oklch(0.6 0.12 30 / 0.4) 85%,
    transparent 100%
  );
  animation: accent-glow 3s ease-in-out infinite alternate;
}

@keyframes accent-glow {
  from { opacity: 0.7; }
  to { opacity: 1; }
}

/* ─── Responsive ─── */
@media (max-width: 768px) {
  .header-inner {
    padding: 0 16px;
    gap: 12px;
  }

  .brand-name {
    font-size: 18px;
    letter-spacing: 2px;
  }

  .brand-tagline {
    display: none;
  }

  :deep(.ant-menu-horizontal > .ant-menu-item),
  :deep(.ant-menu-horizontal > .ant-menu-submenu) {
    font-size: 14px !important;
    padding: 0 10px !important;
    margin: 0 2px !important;
  }

  .user-name {
    display: none;
  }

  .login-link {
    padding: 0 20px;
    font-size: 14px;
  }
}
</style>
