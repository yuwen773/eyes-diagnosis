<template>
  <div class="user-center-wrapper">
    <!-- 背景层 -->
    <div class="background-layer"></div>

    <!-- 用户中心内容 -->
    <a-layout class="user-center-container">
      <!-- 左侧导航 -->
      <a-layout-sider width="220" class="sider">
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
import { UserOutlined, SettingOutlined, HistoryOutlined } from '@ant-design/icons-vue'
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

watch(
  () => route.path,
  (newPath) => {
    const key = newPath.split('/').pop()
    if (key && ['profile', 'accountSettings', 'diagnosisHistory'].includes(key)) {
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
  background: url('@/assets/login.png') no-repeat center center fixed;
  background-size: cover;
  position: relative;
  overflow: hidden;
  display: flex; /* 添加flex布局 */
  justify-content: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
  padding: 20px;
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
  width: 1200px; /* 固定宽度 */
  height: 600px; /* 固定高度 */
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  /* 移除margin设置，改用父容器flex布局控制居中 */
}

.sider {
  background: rgba(255, 255, 255, 0.7);
  border-right: 1px solid rgba(0, 0, 0, 0.1);
  padding: 24px 0;
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  margin-bottom: 16px;
}

.user-name {
  font-size: 16px;
  font-weight: 500;
  margin: 12px 0 8px;
  color: #1a3a5f;
}

.user-role {
  margin-bottom: 8px;
}

.content-layout {
  padding: 24px;
  background: rgba(255, 255, 255, 0.7);
}

.ant-menu {
  border-right: 0;
  background: transparent;
}

.ant-menu-item {
  margin: 8px 0;
  border-radius: 4px;
  transition: all 0.3s;
}

.ant-menu-item:hover {
  background: rgba(24, 144, 255, 0.1);
}

.ant-menu-item-selected {
  background: rgba(24, 144, 255, 0.1);
  color: #1890ff;
}

.report-modal :deep(.ant-modal-content) {
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
}

.report-modal :deep(.ant-modal-header) {
  background: transparent;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}
/* 响应式设计调整 */
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
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  }

  .content-layout {
    padding: 16px;
  }
}
</style>
