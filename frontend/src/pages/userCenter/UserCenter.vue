<template>
  <div class="user-center-wrapper">
    <!-- 背景装饰层 -->
    <div class="bg-decoration">
      <div class="bg-circle bg-circle-1"></div>
      <div class="bg-circle bg-circle-2"></div>
      <div class="bg-circle bg-circle-3"></div>
    </div>

    <!-- 用户中心内容 -->
    <a-layout class="user-center-container">
      <!-- 左侧导航 - 桌面端 -->
      <UserSider
        :loginUser="loginUser"
        :selectedKeys="selectedKeys"
        :unreadCount="unreadCount"
        @update:selectedKeys="selectedKeys = $event"
        @notificationClick="handleNotificationClick"
        @avatarClick="avatarModalVisible = true"
      />

      <!-- 移动端顶部导航标签 -->
      <UserMobileTabs
        :loginUser="loginUser"
        :activeTab="activeMobileTab"
        :unreadCount="unreadCount"
        @update:activeTab="activeMobileTab = $event"
        @notificationClick="handleNotificationClick"
        @avatarClick="avatarModalVisible = true"
      />

      <!-- 右侧内容区 -->
      <a-layout class="content-layout">
        <router-view v-slot="{ Component }" class="router-view-wrapper">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </a-layout>
    </a-layout>

    <!-- 诊断报告详情模态框 -->
    <a-modal
      v-model:open="diagnosisStore.reportModalVisible"
      title="诊断报告详情"
      width="80%"
      :footer="null"
      :destroyOnClose="true"
      class="report-modal"
    >
      <DiagnosisReportDetail
        v-if="diagnosisStore.reportModalVisible"
        :report="diagnosisStore.currentReport"
        @export="handleExport"
      />
    </a-modal>

    <!-- 头像预览与修改模态框 -->
    <AvatarUploadModal
      :open="avatarModalVisible"
      @update:open="avatarModalVisible = $event"
      :avatarUrl="loginUser.userAvatar ?? ''"
      @uploadSuccess="handleUploadSuccess"
    />
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import UserSider from '@/components/user/UserSider.vue'
import UserMobileTabs from '@/components/user/UserMobileTabs.vue'
import AvatarUploadModal from '@/components/user/AvatarUploadModal.vue'
import DiagnosisReportDetail from '@/components/user/DiagnosisReportDetail.vue'
import { useLoginUserStore } from '@/stores/user'
import { useDiagnosisStore } from '@/stores/diagnosis'

const router = useRouter()
const route = useRoute()
const diagnosisStore = useDiagnosisStore()
const loginUserStore = useLoginUserStore()
const loginUser = loginUserStore.loginUser

const selectedKeys = ref<string[]>([])
const avatarModalVisible = ref(false)
const unreadCount = ref(0)
const activeMobileTab = ref('profile')

const handleNotificationClick = () => {
  router.push('/user/userCenter/notification')
}

watch(
  () => route.path,
  (newPath) => {
    const key = newPath.split('/').pop()
    if (key && ['profile', 'accountSettings', 'diagnosisHistory', 'notification'].includes(key)) {
      selectedKeys.value = [key]
      activeMobileTab.value = key
    }
  },
  { immediate: true },
)

const handleExport = (type: 'pdf' | 'csv') => {
  console.log(`导出报告为${type}格式`, diagnosisStore.currentReport)
}

const handleUploadSuccess = () => {
  // Placeholder for any post-upload logic in the parent
}

onMounted(() => {
  router.push('/user/userCenter/profile')
})
</script>

<style scoped>
/* === 背景装饰 === */
.bg-decoration {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.bg-circle {
  position: absolute;
  border-radius: 50%;
  opacity: 0.15;
  filter: blur(80px);
}

.bg-circle-1 {
  width: 500px;
  height: 500px;
  background: var(--claude-brand);
  top: -200px;
  right: -100px;
  animation: float 20s ease-in-out infinite;
}

.bg-circle-2 {
  width: 400px;
  height: 400px;
  background: var(--claude-brand-light);
  bottom: -150px;
  left: -100px;
  animation: float 25s ease-in-out infinite reverse;
}

.bg-circle-3 {
  width: 300px;
  height: 300px;
  background: var(--claude-brand-dark);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation: pulse 15s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(30px, -30px); }
}

@keyframes pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.15; }
  50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.2; }
}

/* === 主容器 === */
.user-center-wrapper {
  min-height: 86vh;
  background: var(--claude-bg-page);
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: center;
  padding: var(--claude-space-6);
}

.user-center-container {
  position: relative;
  z-index: 1;
  width: 1200px;
  min-height: 640px;
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-xl);
  box-shadow:
    0 4px 6px rgba(20, 20, 19, 0.04),
    0 10px 20px rgba(20, 20, 19, 0.06),
    0 0 0 1px var(--claude-border-cream);
  overflow: hidden;
  display: flex;
  align-items: stretch;
}

/* === 内容区 === */
.content-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--claude-space-6);
  background: var(--claude-bg-card);
  overflow-y: auto;
  min-width: 0; /* 防止flex子项溢出 */
}

.router-view-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 页面切换动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* === 响应式 === */
@media (max-width: 2000px) {
  .user-center-container {
    width: calc(100% - 200px);
    margin: 0 100px;
    min-height: 640px;
  }
}

@media (max-width: 1200px) {
  .user-center-container {
    width: calc(100% - 80px);
    margin: 0 40px;
    min-height: 600px;
  }
}

@media (max-width: 767px) {
  .user-center-wrapper {
    padding: 0;
    align-items: flex-start;
  }

  .user-center-container {
    width: 100%;
    margin: 0;
    min-height: calc(100vh - 160px);
    border-radius: 0;
    box-shadow: none;
  }

  .content-layout {
    padding: var(--claude-space-4);
  }
}
</style>
