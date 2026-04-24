<template>
  <a-layout-sider
    :collapsed="collapsed"
    :trigger="null"
    collapsible
    :width="220"
    theme="dark"
    class="admin-sider"
  >
    <div class="logo">
      <h1 v-if="!collapsed">管理后台</h1>
      <h1 v-else>后台</h1>
    </div>
    <a-menu
      v-model:selectedKeys="selectedKeys"
      theme="dark"
      mode="inline"
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
      <a-menu-divider />
      <a-menu-item key="/">
        <template #icon>
          <RollbackOutlined />
        </template>
        <span>返回前台</span>
      </a-menu-item>
    </a-menu>
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
</script>

<style scoped>
.admin-sider {
  min-height: 100vh;
}

.logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.logo h1 {
  margin: 0;
  font-size: 18px;
  white-space: nowrap;
  overflow: hidden;
}
</style>
