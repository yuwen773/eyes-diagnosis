<template>
  <div>
    <a-layout>
      <!-- 左侧侧导航栏 -->
      <a-layout-sider>
        <a-menu mode="inline" default-selected-keys="userManagement" >
          <a-menu-item key="userManagement">
            <router-link to="/systemManage/admin/userManage">用户管理</router-link>
          </a-menu-item>
          <a-menu-item key="newsManagement">
            <router-link to="/systemManage/admin/newsManage">新闻管理</router-link>
          </a-menu-item>
          <a-menu-item key="diagnosisManage">
            <router-link to="/systemManage/admin/diagnosisManage">疾病诊断管理</router-link>
          </a-menu-item>
          <a-menu-item key="dataAnalysis">
            <router-link to="/systemManage/admin/dataAnalysis">病情分析</router-link>
          </a-menu-item>
        </a-menu>
      </a-layout-sider>
      <!-- 右侧管理页面 -->
      <a-layout-content>
        <router-view></router-view>
      </a-layout-content>
    </a-layout>
  </div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
const router = useRouter()
onMounted(()=>{
  router.push('/systemManage/admin/userManage')
})
</script>

<style scoped>

</style>
