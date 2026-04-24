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
      <AvatarDropdown placement="bottom-end" @logout="handleLogout" />
    </div>
  </a-layout-header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons-vue'
import { useLoginUserStore } from '@/stores/user'
import { userLogout } from '@/api/userController'
import AvatarDropdown from '@/components/user/AvatarDropdown.vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
}>()

const route = useRoute()
const router = useRouter()
const loginUserStore = useLoginUserStore()

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

const handleLogout = async () => {
  try {
    const res = await userLogout()
    if (res.data.code === 0) {
      loginUserStore.setLoginUser({ userName: '未登录' })
      message.success('退出登录成功')
      await router.push('/user/login')
    } else {
      message.error('退出登录失败: ' + res.data.msg)
    }
  } catch (e) {
    console.error('logout failed', e)
  }
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
</style>
