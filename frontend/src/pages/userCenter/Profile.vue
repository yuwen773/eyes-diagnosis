<template>
  <div class="profile-container">
    <a-page-header title="个人资料" class="page-header">
      <template #extra>
        <a-button type="primary" class="edit-btn" @click="goToEdit">
          <template #icon><EditOutlined /></template>
          编辑资料
        </a-button>
      </template>
    </a-page-header>

    <!-- 统计卡片区域 -->
    <div class="stats-grid">
      <a-card class="stat-card stat-card-1" :bordered="false">
        <div class="stat-icon">
          <FileSearchOutlined />
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.totalDiagnoses }}</div>
          <div class="stat-label">总诊断数</div>
        </div>
        <div class="stat-decoration"></div>
      </a-card>
      <a-card class="stat-card stat-card-2" :bordered="false">
        <div class="stat-icon">
          <ClockCircleOutlined />
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.pendingReexamine }}</div>
          <div class="stat-label">待复诊</div>
        </div>
        <div class="stat-decoration"></div>
      </a-card>
      <a-card class="stat-card stat-card-3" :bordered="false">
        <div class="stat-icon">
          <CheckCircleOutlined />
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.completed }}</div>
          <div class="stat-label">已完成</div>
        </div>
        <div class="stat-decoration"></div>
      </a-card>
      <a-card class="stat-card stat-card-4" :bordered="false">
        <div class="stat-icon">
          <RiseOutlined />
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.reexamineRate }}<span class="stat-suffix">%</span></div>
          <div class="stat-label">复诊率</div>
        </div>
        <div class="stat-decoration"></div>
      </a-card>
    </div>

    <!-- 用户信息卡片 -->
    <a-card class="info-card" :bordered="false">
      <div class="info-header">
        <UserOutlined class="header-icon" />
        <span class="header-title">基本信息</span>
      </div>
      <a-descriptions :column="2" class="profile-info" :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }">
        <a-descriptions-item label="姓名">
          <span class="info-value">{{ loginUser.userName }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="性别">
          <span class="info-value">{{ renderGender }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="手机号">
          <span class="info-value">{{ loginUser?.phone || '未填写' }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="邮箱">
          <span class="info-value">{{ loginUser?.email || '未填写' }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="注册时间">
          <span class="info-value">{{ dayjs(Number(loginUser.createTime)).format('YYYY-MM-DD') }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="角色">
          <a-tag :color="loginUser.userRole === 'admin' ? '#1b7f6b' : '#52c41a'" class="role-tag">
            <template #icon>
              <SafetyCertificateOutlined v-if="loginUser.userRole === 'admin'" />
              <UserOutlined v-else />
            </template>
            {{ loginUser.userRole === 'admin' ? '管理员' : '用户' }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- 用户简介卡片 -->
    <a-card class="bio-card" :bordered="false">
      <div class="bio-header">
        <BookOutlined class="header-icon" />
        <span class="header-title">个人简介</span>
      </div>
      <div class="bio-content">
        <p v-if="loginUser?.userProfile" class="bio-text">{{ loginUser.userProfile }}</p>
        <p v-else class="bio-empty">
          <EditOutlined class="empty-icon" />
          这位用户很懒，什么都没有留下
        </p>
      </div>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLoginUserStore } from '@/stores/user'
import dayjs from 'dayjs'
import {
  EditOutlined,
  FileSearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  RiseOutlined,
  UserOutlined,
  BookOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons-vue'

const router = useRouter()

const goToEdit = () => {
  router.push('/user/userCenter/accountSettings')
}

interface DiagnosisStats {
  totalDiagnoses: number
  pendingReexamine: number
  completed: number
  reexamineRate: number
}

const stats = ref<DiagnosisStats>({
  totalDiagnoses: 156,
  pendingReexamine: 12,
  completed: 144,
  reexamineRate: 92.3
})

const loginUserStore = useLoginUserStore()
const loginUser = loginUserStore.loginUser

const renderGender = computed(() => {
  if (loginUser?.gender === 1) {
    return '男'
  } else if (loginUser?.gender === 0) {
    return '女'
  }
  return '未填写'
})
</script>

<style scoped>
.profile-container {
  flex: 1;
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* === 页面标题 === */
.page-header {
  margin-bottom: var(--claude-space-6);
  padding: 0;
  background: transparent;
}

.page-header :deep(.ant-page-header-content) {
  padding: 0;
}

.edit-btn {
  background: var(--claude-brand);
  border-color: var(--claude-brand);
  color: #fff;
  height: 38px;
  padding: 0 20px;
  border-radius: var(--claude-radius-md);
  font-size: 14px;
  transition: all var(--claude-transition-base);
}

.edit-btn:hover {
  background: var(--claude-brand-dark) !important;
  border-color: var(--claude-brand-dark) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(201, 100, 66, 0.3);
}

/* === 统计卡片网格 === */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--claude-space-4);
  margin-bottom: var(--claude-space-6);
}

.stat-card {
  position: relative;
  overflow: hidden;
  border-radius: var(--claude-radius-lg);
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  transition: all var(--claude-transition-base);
  padding: var(--claude-space-5);
  display: flex;
  align-items: center;
  gap: var(--claude-space-4);
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(20, 20, 19, 0.1);
  border-color: var(--claude-border-warm);
}

.stat-decoration {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  opacity: 0.08;
  transform: translate(20px, 20px);
}

.stat-card-1 .stat-icon {
  color: var(--claude-brand);
  background: rgba(201, 100, 66, 0.1);
}
.stat-card-1 .stat-decoration {
  background: var(--claude-brand);
}

.stat-card-2 .stat-icon {
  color: #faad14;
  background: rgba(250, 173, 20, 0.1);
}
.stat-card-2 .stat-decoration {
  background: #faad14;
}

.stat-card-3 .stat-icon {
  color: #52c41a;
  background: rgba(82, 196, 26, 0.1);
}
.stat-card-3 .stat-decoration {
  background: #52c41a;
}

.stat-card-4 .stat-icon {
  color: #3898ec;
  background: rgba(56, 152, 236, 0.1);
}
.stat-card-4 .stat-decoration {
  background: #3898ec;
}

.stat-icon {
  font-size: 28px;
  padding: var(--claude-space-3);
  border-radius: var(--claude-radius-md);
  flex-shrink: 0;
}

.stat-content {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-family: var(--claude-font-serif);
  font-size: 28px;
  font-weight: 600;
  color: var(--claude-text-primary);
  line-height: 1.2;
}

.stat-suffix {
  font-size: 16px;
  font-weight: 500;
}

.stat-label {
  font-size: 13px;
  color: var(--claude-text-tertiary);
  margin-top: 2px;
}

/* === 信息卡片 === */
.info-card,
.bio-card {
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-lg);
  margin-bottom: var(--claude-space-4);
  overflow: hidden;
}

.info-header,
.bio-header {
  display: flex;
  align-items: center;
  gap: var(--claude-space-3);
  padding: var(--claude-space-4) var(--claude-space-5);
  border-bottom: 1px solid var(--claude-border-cream);
  background: linear-gradient(180deg, var(--claude-bg-elevated) 0%, transparent 100%);
}

.header-icon {
  font-size: 18px;
  color: var(--claude-brand);
}

.header-title {
  font-family: var(--claude-font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--claude-text-primary);
}

.profile-info {
  padding: var(--claude-space-5);
}

.profile-info :deep(.ant-descriptions-item) {
  padding-bottom: var(--claude-space-4);
}

.profile-info :deep(.ant-descriptions-item-label) {
  color: var(--claude-text-tertiary);
  font-size: 14px;
}

.profile-info :deep(.ant-descriptions-item-content) {
  color: var(--claude-text-primary);
  font-size: 14px;
}

.info-value {
  font-weight: 500;
}

.role-tag {
  border-radius: 20px;
  font-size: 12px;
}

/* === 简介卡片 === */
.bio-content {
  padding: var(--claude-space-5);
}

.bio-text {
  font-size: 14px;
  line-height: 1.8;
  color: var(--claude-text-secondary);
  margin: 0;
}

.bio-empty {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
  font-size: 14px;
  color: var(--claude-text-tertiary);
  font-style: italic;
  margin: 0;
}

.empty-icon {
  color: var(--claude-text-disabled);
}

/* === 响应式 === */
@media (max-width: 1200px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--claude-space-3);
  }

  .stat-card {
    padding: var(--claude-space-4);
    flex-direction: column;
    text-align: center;
    gap: var(--claude-space-3);
  }

  .stat-icon {
    font-size: 24px;
    padding: var(--claude-space-2);
  }

  .stat-value {
    font-size: 24px;
  }

  .profile-info {
    padding: var(--claude-space-4);
  }

  .profile-info :deep(.ant-descriptions-item) {
    padding-bottom: var(--claude-space-3);
  }

  .info-card,
  .bio-card {
    margin-bottom: var(--claude-space-3);
  }
}

@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .stat-card {
    flex-direction: row;
    text-align: left;
  }
}
</style>
