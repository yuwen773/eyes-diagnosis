<template>
  <a-layout-sider
    :collapsed="collapsed"
    :trigger="null"
    collapsible
    :width="240"
    class="admin-sider"
  >
    <!-- 顶部装饰条 -->
    <div class="sider-accent"></div>

    <!-- Logo 区域 -->
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2"/>
          <circle cx="16" cy="16" r="8" stroke="currentColor" stroke-width="2"/>
          <circle cx="16" cy="16" r="3" fill="currentColor"/>
        </svg>
      </div>
      <transition name="fade">
        <h1 v-if="!collapsed" class="logo-title">眼疾诊断系统</h1>
      </transition>
    </div>

    <!-- 菜单区域 -->
    <nav class="menu-nav">
      <div class="menu-label" v-if="!collapsed">主导航</div>
      <a-menu
        v-model:selectedKeys="selectedKeys"
        mode="inline"
        class="sidebar-menu"
        @click="onMenuClick"
      >
        <a-menu-item key="/admin/dashboard">
          <template #icon>
            <DashboardOutlined />
          </template>
          <span>仪表盘</span>
        </a-menu-item>
        <a-menu-item key="/admin/users">
          <template #icon>
            <UserOutlined />
          </template>
          <span>用户管理</span>
        </a-menu-item>
        <a-menu-item key="/admin/news">
          <template #icon>
            <ReadOutlined />
          </template>
          <span>新闻管理</span>
        </a-menu-item>
        <a-menu-item key="/admin/diagnosis">
          <template #icon>
            <MedicineBoxOutlined />
          </template>
          <span>诊断管理</span>
        </a-menu-item>
        <a-menu-item key="/admin/knowledge">
          <template #icon>
            <FolderOutlined />
          </template>
          <span>知识库</span>
        </a-menu-item>
        <a-menu-item key="/admin/data-analysis">
          <template #icon>
            <BarChartOutlined />
          </template>
          <span>数据分析</span>
        </a-menu-item>
        <a-menu-item key="/admin/draft-test">
          <template #icon>
            <ExperimentOutlined />
          </template>
          <span>四 Agent 试验台</span>
        </a-menu-item>
        <a-menu-item key="/admin/agent-collab">
          <template #icon>
            <TeamOutlined />
          </template>
          <span>四 Agent 协作效果</span>
        </a-menu-item>
        <a-menu-item key="/admin/agent-discussion">
          <template #icon>
            <AuditOutlined />
          </template>
          <span>四角色会诊议事录</span>
        </a-menu-item>
      </a-menu>

      <div class="menu-divider"></div>

      <div class="menu-label" v-if="!collapsed">其他</div>
      <a-menu mode="inline" class="sidebar-menu">
        <a-menu-item key="/" @click="goHome">
          <template #icon>
            <RollbackOutlined />
          </template>
          <span>返回前台</span>
        </a-menu-item>
      </a-menu>
    </nav>

    <!-- 底部信息 -->
    <div class="sider-footer" v-if="!collapsed">
      <div class="footer-brand">
        <span class="footer-dot"></span>
        <span>Iris</span>
      </div>
    </div>
  </a-layout-sider>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  DashboardOutlined,
  UserOutlined,
  ReadOutlined,
  MedicineBoxOutlined,
  FolderOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  TeamOutlined,
  AuditOutlined,
  RollbackOutlined,
} from '@ant-design/icons-vue'

defineProps<{
  collapsed: boolean
}>()

const route = useRoute()
const router = useRouter()

const selectedKeys = ref<string[]>([route.path])

watch(
  () => route.path,
  (newPath) => {
    selectedKeys.value = [newPath]
  }
)

const onMenuClick = ({ key }: { key: string }) => {
  router.push(key)
}

const goHome = () => {
  router.push('/')
}
</script>

<style scoped>
.admin-sider {
  min-height: 100vh;
  background: linear-gradient(180deg, #16140f 0%, #0d0c09 100%);
  border-right: 1px solid rgba(27, 127, 107, 0.18);
  display: flex;
  flex-direction: column;
}

/* 顶部青绿装饰条 */
.sider-accent {
  height: 4px;
  background: linear-gradient(90deg, var(--iris-accent) 0%, var(--iris-accent-strong) 100%);
}

/* Logo 区域 */
.logo {
  padding: 28px 20px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.logo-icon {
  width: 36px;
  height: 36px;
  color: var(--claude-brand);
  flex-shrink: 0;
  transition: transform 0.3s ease;
}

.logo-icon svg {
  width: 100%;
  height: 100%;
}

.logo:hover .logo-icon {
  transform: rotate(15deg);
}

.logo-title {
  font-family: var(--claude-font-serif);
  font-size: 1.1rem;
  font-weight: 600;
  color: #f5f4ed;
  margin: 0;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

/* 菜单导航 */
.menu-nav {
  flex: 1;
  padding: 20px 12px;
  overflow-y: auto;
}

.menu-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.3);
  padding: 0 12px;
  margin-bottom: 8px;
}

.sidebar-menu {
  background: transparent;
  border: none;
}

.sidebar-menu :deep(.ant-menu-item) {
  margin: 4px 0;
  padding-left: 16px !important;
  height: 44px;
  line-height: 44px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.sidebar-menu :deep(.ant-menu-item:hover) {
  color: #f5f4ed;
  background: rgba(27, 127, 107, 0.14);
}

.sidebar-menu :deep(.ant-menu-item-selected) {
  color: #f5f4ed;
  background: rgba(27, 127, 107, 0.22);
  border: 1px solid rgba(27, 127, 107, 0.5);
  font-weight: 500;
}

.sidebar-menu :deep(.ant-menu-item .anticon) {
  font-size: 1.1rem;
  transition: transform 0.2s ease;
}

.sidebar-menu :deep(.ant-menu-item:hover .anticon) {
  transform: scale(1.1);
}

.menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 16px 8px;
}

/* 底部信息 */
.sider-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.35);
}

.footer-dot {
  width: 6px;
  height: 6px;
  background: var(--iris-accent);
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 自定义滚动条 */
.menu-nav::-webkit-scrollbar {
  width: 4px;
}

.menu-nav::-webkit-scrollbar-track {
  background: transparent;
}

.menu-nav::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.menu-nav::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
