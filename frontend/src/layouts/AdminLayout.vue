<template>
  <a-layout class="admin-layout">
    <AdminSidebar :collapsed="collapsed" />
    <a-layout>
      <AdminHeader :collapsed="collapsed" @toggle="toggleCollapsed" />
      <a-layout-content class="admin-content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AdminSidebar from '@/components/admin/AdminSidebar.vue'
import AdminHeader from '@/components/admin/AdminHeader.vue'

const collapsed = ref(false)

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value
}
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
}

.admin-content {
  margin: 24px;
  padding: 24px;
  background: #fff;
  min-height: calc(100vh - 64px - 48px);
}
</style>
