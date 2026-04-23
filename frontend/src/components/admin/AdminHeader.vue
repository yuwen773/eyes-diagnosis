<template>
  <a-layout-header class="admin-header">
    <div class="header-left">
      <span class="trigger" @click="$emit('toggle')">
        <MenuUnfoldOutlined v-if="collapsed" />
        <MenuFoldOutlined v-else />
      </span>
      <a-breadcrumb class="breadcrumb">
        <a-breadcrumb-item>管理后台</a-breadcrumb-item>
        <a-breadcrumb-item>{{ pageTitle }}</a-breadcrumb-item>
      </a-breadcrumb>
    </div>
    <div class="header-right">
      <a-dropdown>
        <div class="user-info">
          <a-avatar :src="loginUser.userAvatar" :size="32">
            {{ loginUser.userName?.charAt(0) }}
          </a-avatar>
          <span class="username">{{ loginUser.userName }}</span>
        </div>
        <template #overlay>
          <a-menu>
            <a-menu-item key="profile" @click="goProfile">
              <UserOutlined />
              <span style="margin-left: 8px">个人中心</span>
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item key="logout" @click="handleLogout">
              <LogoutOutlined />
              <span style="margin-left: 8px">退出登录</span>
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>
  </a-layout-header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons-vue'
import { useLoginUserStore } from '@/stores/user'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
}>()

const route = useRoute()
const router = useRouter()
const loginUserStore = useLoginUserStore()
const loginUser = computed(() => loginUserStore.loginUser)

const pageTitles: Record<string, string> = {
  '/admin/dashboard': '仪表盘',
  '/admin/users': '用户管理',
  '/admin/news': '新闻管理',
  '/admin/diagnosis': '诊断管理',
  '/admin/knowledge': '知识库',
  '/admin/data-analysis': '数据分析',
}

const pageTitle = computed(() => {
  return pageTitles[route.path] || '管理页面'
})

const goProfile = () => {
  router.push('/user/userCenter/profile')
}

const handleLogout = () => {
  router.push('/user/login')
}
</script>

<style scoped>
.admin-header {
  background: #fff;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  height: 64px;
  line-height: 64px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.trigger {
  font-size: 18px;
  cursor: pointer;
  transition: color 0.3s;
}

.trigger:hover {
  color: #1890ff;
}

.breadcrumb {
  line-height: 64px;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
}
</style>
