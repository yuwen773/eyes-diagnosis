<template>
  <div class="user-center-wrapper">
    <!-- 背景层 -->
    <div class="background-layer"></div>

    <!-- 用户中心内容 -->
    <a-layout class="user-center-container">
      <!-- 左侧导航 -->
      <a-layout-sider width="220" class="sider">
        <!-- 通知铃铛 -->
        <div class="notification-bell" @click="handleNotificationClick">
          <BellOutlined class="bell-icon" />
          <span v-if="unreadCount > 0" class="badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
        </div>

        <!--用户昵称和用户头像-->
        <div class="user-info">
          <a-avatar
            :size="64"
            :src="loginUser.userAvatar"
            @click="avatarModalVisible = true"
            style="cursor: pointer"
          />
          <div class="user-name">{{ loginUser.userName }}</div>
          <!--用户身份-->
          <div class="user-role">
            <a-tag :color="loginUser.userRole === 'admin' ? 'blue' : 'green'">
              {{ loginUser.userRole === 'admin' ? '管理员' : '用户' }}
            </a-tag>
          </div>
        </div>
        <!--导航项 》》 个人资料、账户设置、诊断历史-->
        <a-menu
          v-model:selectedKeys="selectedKeys"
          mode="inline"
          theme="light"
          @click="handleMenuClick"
        >
          <!--导航项 》》 个人资料-->
          <a-menu-item key="profile">
            <template #icon><user-outlined /></template>
            个人资料
          </a-menu-item>
          <!--导航项 》》 账户设置-->
          <a-menu-item key="accountSettings">
            <template #icon><setting-outlined /></template>
            账号设置
          </a-menu-item>
          <!--导航项 》》 诊断历史-->
          <a-menu-item key="diagnosisHistory">
            <template #icon><history-outlined /></template>
            诊断历史
          </a-menu-item>
          <!--导航项 》》 通知中心-->
          <a-menu-item key="notification">
            <template #icon><bell-outlined /></template>
            通知中心
          </a-menu-item>
        </a-menu>
      </a-layout-sider>

      <!-- 右侧内容区 -->
      <a-layout class="content-layout">
        <router-view />
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

    <!-- 新增头像预览与修改模态框 -->
    <a-modal
      v-model:open="avatarModalVisible"
      title="头像预览"
      :footer="null"
      :destroyOnClose="true"
    >
      <div style="text-align: center">
        <img
          :src="loginUser.userAvatar"
          alt="头像预览"
          style="width: 120px; height: 120px; border-radius: 50%; margin-bottom: 16px"
        />
        <br />
        <a-upload
          :showUploadList="false"
          :beforeUpload="beforeAvatarUpload"
          :custom-request="handleUpload"
        >
          <a-button type="primary">修改头像</a-button>
        </a-upload>
      </div>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
// 原有script部分保持不变
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import DiagnosisReportDetail from '@/components/user/DiagnosisReportDetail.vue'
import { UserOutlined, SettingOutlined, HistoryOutlined, BellOutlined } from '@ant-design/icons-vue'
import { useLoginUserStore } from '@/stores/user'
import { useDiagnosisStore } from '@/stores/diagnosis'
import { message } from 'ant-design-vue'
import { uploadAvatarPicture } from '@/api/userController'

const router = useRouter()
const route = useRoute()
const diagnosisStore = useDiagnosisStore()
const loginUserStore = useLoginUserStore()
const loginUser = loginUserStore.loginUser

const selectedKeys = ref<string[]>()//['profile']
const reportModalVisible = ref(false)
const currentReport = ref<any>(null)
const avatarModalVisible = ref(false)
const unreadCount = ref(0)

const handleNotificationClick = () => {
  router.push('/user/userCenter/notification')
}

watch(
  () => route.path,
  (newPath) => {
    const key = newPath.split('/').pop()
    if (key && ['profile', 'accountSettings', 'diagnosisHistory', 'notification'].includes(key)) {
      selectedKeys.value = [key]
    }
  },
  { immediate: true },
)

const handleMenuClick = ({ key }: { key: string }) => {
  router.push(`/user/userCenter/${key}`)
}
const current = ref<string[]>([])
router.afterEach((to) => {
  current.value = [to.path]
})
const handleExport = (type: 'pdf' | 'csv') => {
  console.log(`导出报告为${type}格式`, diagnosisStore.currentReport)
}

const beforeAvatarUpload = (file: File) => {
  const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png'
  if (!isJpgOrPng) {
    message.error('只能上传 JPG/PNG 格式的图片!')
    return false
  }
  const isLt2M = file.size / 1024 / 1024 < 2
  if (!isLt2M) {
    message.error('图片大小不能超过 2MB!')
    return false
  }
  return true
}

const handleUpload = async ({ file }: any) => {
  try {
    //设置参数
    const params = loginUser;
    const res = await uploadAvatarPicture(params, {}, file)

    if (res.data.code === 0 && res.data.data) {
      await loginUserStore.fetchLoginUser()
      avatarModalVisible.value = false
      message.success('图片上传成功')
    } else {
      message.error('图片上传失败,' + res.data.msg)
    }
  } catch (error) {
    message.error('图片上传失败')
  }
}
onMounted(() => {
  router.push('/user/userCenter/profile')
})
</script>

<style scoped>
.user-center-wrapper {
  min-height: 86vh;
  background: var(--color-bg);
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--space-6);
}

.background-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: inherit;
  filter: blur(8px);
  z-index: 0;
}

.user-center-container {
  position: relative;
  z-index: 1;
  width: 1200px;
  height: 600px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-whisper);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.sider {
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: 24px 0;
}

.notification-bell {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 12px 16px;
  margin: 0 12px 16px;
  border-radius: 8px;
  background: #f5f4f0;
  cursor: pointer;
  transition: all 0.3s;
}

.notification-bell:hover {
  background: var(--color-primary-light);
}

.bell-icon {
  font-size: 20px;
  color: var(--color-text);
}

.badge {
  position: absolute;
  top: 8px;
  right: 10px;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  color: #fff;
  background: #e54d39;
  border-radius: 9px;
  padding: 0 5px;
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px 24px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 16px;
}

.user-name {
  font-size: 16px;
  font-weight: 500;
  margin: 12px 0 8px;
  color: var(--color-text);
}

.user-role {
  margin-bottom: 8px;
}

.content-layout {
  padding: 24px;
  background: var(--color-surface);
}

.ant-menu {
  border-right: 0;
  background: transparent;
}

.ant-menu-item {
  margin: 8px 0;
  border-radius: 4px;
  transition: all 0.3s;
  position: relative;
}

.ant-menu-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 0;
  background: #c96442;
  border-radius: 1px;
  transition: height 0.3s;
}

.ant-menu-item:hover {
  background: #e8e6dc;
}

.ant-menu-item-selected::before {
  height: 24px;
}

.ant-menu-item-selected {
  background: rgba(201, 100, 66, 0.15);
  color: #c96442;
}

.report-modal :deep(.ant-modal-content) {
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-surface);
  backdrop-filter: blur(10px);
}

.report-modal :deep(.ant-modal-header) {
  background: transparent;
  border-bottom: 1px solid var(--color-border);
}

@media (max-width: 2000px) {
  .user-center-container {
    width: calc(100% - 200px);
    margin: 0 100px;
    height: 600px;
  }
}

@media (max-width: 1200px) {
  .user-center-container {
    width: calc(100% - 80px);
    margin: 0 40px;
    height: auto;
    min-height: 600px;
  }
}

@media (max-width: 768px) {
  .user-center-container {
    width: calc(100% - 40px);
    margin: 0 20px;
    flex-direction: column;
    height: auto;
  }

  .sider {
    width: 100% !important;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }

  .content-layout {
    padding: 16px;
  }
}
</style>
