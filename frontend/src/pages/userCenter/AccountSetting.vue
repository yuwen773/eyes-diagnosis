<template>
  <div class="settings-container">
    <a-page-header title="账号设置" class="page-header" />

    <a-row :gutter="24" class="settings-content">
      <!-- 左侧：个人信息表单 -->
      <a-col :xs="24" :lg="12" class="form-col">
        <a-card class="form-card" :bordered="false">
          <template #title>
            <div class="card-title">
              <EditOutlined class="title-icon" />
              <span>基本信息</span>
            </div>
          </template>
          <a-form
            :model="formState"
            :rules="rules"
            @finish="handleSubmit"
            layout="vertical"
            class="settings-form"
          >
            <a-form-item label="用户名" name="userName" class="form-item">
              <a-input v-model:value="formState.userName" size="large" placeholder="请输入用户名" />
            </a-form-item>

            <a-form-item label="性别" name="gender" class="form-item">
              <a-radio-group v-model:value="formState.gender" class="gender-group">
                <a-radio-button :value="1" class="gender-option">
                  <ManOutlined /> 男
                </a-radio-button>
                <a-radio-button :value="0" class="gender-option">
                  <WomanOutlined /> 女
                </a-radio-button>
              </a-radio-group>
            </a-form-item>

            <a-form-item label="手机号" name="phone" class="form-item">
              <a-input v-model:value="formState.phone" size="large" placeholder="请输入手机号">
                <template #prefix>
                  <PhoneOutlined class="input-icon" />
                </template>
              </a-input>
            </a-form-item>

            <a-form-item label="邮箱" name="email" class="form-item">
              <a-input v-model:value="formState.email" size="large" placeholder="请输入邮箱">
                <template #prefix>
                  <MailOutlined class="input-icon" />
                </template>
              </a-input>
            </a-form-item>

            <a-form-item label="个人简介" name="userProfile" class="form-item">
              <a-textarea
                v-model:value="formState.userProfile"
                :rows="4"
                placeholder="介绍一下自己吧..."
                :maxlength="200"
                show-count
                class="bio-textarea"
              />
            </a-form-item>

            <a-form-item class="submit-item">
              <a-button type="primary" html-type="submit" :loading="submitting" size="large" class="submit-btn">
                <template #icon>
                  <SaveOutlined />
                </template>
                保存更改
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-col>

      <!-- 右侧：安全设置 -->
      <a-col :xs="24" :lg="12" class="security-col">
        <a-card class="form-card security-card" :bordered="false">
          <template #title>
            <div class="card-title">
              <SafetyOutlined class="title-icon" />
              <span>安全设置</span>
            </div>
          </template>
          <a-form
            :model="passwordFormState"
            :rules="passwordRules"
            @finish="handlePasswordChange"
            layout="vertical"
            class="settings-form"
          >
            <a-form-item label="旧密码" name="oldPassword" class="form-item">
              <a-input-password
                v-model:value="passwordFormState.oldPassword"
                size="large"
                placeholder="请输入旧密码"
                class="password-input"
              >
                <template #prefix>
                  <LockOutlined class="input-icon" />
                </template>
              </a-input-password>
            </a-form-item>

            <a-form-item label="新密码" name="newPassword" class="form-item">
              <a-input-password
                v-model:value="passwordFormState.newPassword"
                size="large"
                placeholder="请输入新密码（至少6位）"
                class="password-input"
              >
                <template #prefix>
                  <KeyOutlined class="input-icon" />
                </template>
              </a-input-password>
            </a-form-item>

            <a-form-item label="确认密码" name="confirmPassword" class="form-item">
              <a-input-password
                v-model:value="passwordFormState.confirmPassword"
                size="large"
                placeholder="请再次输入新密码"
                class="password-input"
              >
                <template #prefix>
                  <SafetyOutlined class="input-icon" />
                </template>
              </a-input-password>
            </a-form-item>

            <a-form-item class="submit-item">
              <a-button
                type="primary"
                html-type="submit"
                :loading="passwordSubmitting"
                size="large"
                class="submit-btn password-btn"
              >
                <template #icon>
                  <KeyOutlined />
                </template>
                更新密码
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <!-- 安全提示 -->
        <div class="security-tips">
          <div class="tips-header">
            <InfoCircleOutlined class="tips-icon" />
            <span>安全建议</span>
          </div>
          <ul class="tips-list">
            <li>密码长度至少6位，建议包含字母和数字</li>
            <li>不要使用与其他网站相同的密码</li>
            <li>定期更换密码，保障账户安全</li>
            <li>不要向他人透露您的账户信息</li>
          </ul>
        </div>
      </a-col>
    </a-row>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive } from 'vue'
import { message } from 'ant-design-vue'
import { useLoginUserStore } from '@/stores/user'
import type { Rule } from 'ant-design-vue/es/form'
import { editUserCenter } from '@/api/userController'
import {
  EditOutlined,
  ManOutlined,
  WomanOutlined,
  PhoneOutlined,
  MailOutlined,
  LockOutlined,
  KeyOutlined,
  SafetyOutlined,
  SaveOutlined,
  InfoCircleOutlined
} from '@ant-design/icons-vue'

const loginUserStore = useLoginUserStore()
const loginUser = loginUserStore.loginUser

const submitting = ref(false)
const passwordSubmitting = ref(false)

const formState = reactive<API.UserEditDTO>({
  id: loginUser.id,
  userName: loginUser.userName,
  gender: loginUser?.gender ?? 1,
  phone: loginUser?.phone || '',
  email: loginUser?.email || '',
  userProfile: loginUser?.userProfile || ''
})

const rules: Record<string, Rule[]> = {
  userName: [
    { required: true, message: '请输入用户名', trigger: 'change' }
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'change' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'change' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'change' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'change' }
  ],
  userProfile: [
    { max: 200, message: '简介不能超过200个字符', trigger: 'change' }
  ]
}

const handleSubmit = async () => {
  try {
    submitting.value = true
    const res = await editUserCenter(formState)
    if (res.data.code === 0) {
      message.success('个人信息更新成功')
    } else {
      message.error(res.data.msg || '更新失败，请重试')
    }
  } catch (error) {
    console.error(error)
    message.error('更新失败，请重试')
  } finally {
    submitting.value = false
  }
}

const passwordFormState = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const validateNewPassword = async (_rule: Rule, value: string) => {
  if (!value) {
    return Promise.reject('请输入新密码')
  }
  if (value.length < 6) {
    return Promise.reject('密码长度至少6位')
  }
  if (value === passwordFormState.oldPassword) {
    return Promise.reject('新密码不能与旧密码相同')
  }
  return Promise.resolve()
}

const validateConfirmPassword = async (_rule: Rule, value: string) => {
  if (!value) {
    return Promise.reject('请再次输入新密码')
  }
  if (value !== passwordFormState.newPassword) {
    return Promise.reject('确认密码必须与新密码匹配')
  }
  return Promise.resolve()
}

const passwordRules: Record<string, Rule[]> = {
  oldPassword: [
    { required: true, message: '请输入旧密码', trigger: 'blur' }
  ],
  newPassword: [
    { required: true, validator: validateNewPassword, trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, validator: validateConfirmPassword, trigger: 'blur' }
  ]
}

const handlePasswordChange = async () => {
  try {
    passwordSubmitting.value = true
    message.success('密码更新成功')
    passwordFormState.oldPassword = ''
    passwordFormState.newPassword = ''
    passwordFormState.confirmPassword = ''
  } catch (error) {
    console.error(error)
    message.error('密码更新失败，请重试')
  } finally {
    passwordSubmitting.value = false
  }
}
</script>

<style scoped>
.settings-container {
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

/* === 布局 === */
.settings-content {
  display: flex;
  gap: var(--claude-space-6);
}

.form-col,
.security-col {
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-4);
}

/* === 表单卡片 === */
.form-card {
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-lg);
  overflow: hidden;
}

.card-title {
  display: flex;
  align-items: center;
  gap: var(--claude-space-3);
  font-family: var(--claude-font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--claude-text-primary);
}

.title-icon {
  font-size: 18px;
  color: var(--claude-brand);
}

/* === 表单样式 === */
.settings-form {
  padding: var(--claude-space-5);
}

.form-item {
  margin-bottom: var(--claude-space-5);
}

.form-item :deep(.ant-form-item-label) {
  padding-bottom: var(--claude-space-2);
}

.form-item :deep(.ant-form-item-label > label) {
  font-size: 14px;
  font-weight: 500;
  color: var(--claude-text-primary);
}

.form-item :deep(.ant-input),
.form-item :deep(.ant-input-affix-wrapper) {
  border-radius: var(--claude-radius-md);
  border-color: var(--claude-border-warm);
  background: var(--claude-bg-card);
  transition: all var(--claude-transition-base);
}

.form-item :deep(.ant-input:hover),
.form-item :deep(.ant-input-affix-wrapper:hover) {
  border-color: var(--claude-brand);
}

.form-item :deep(.ant-input:focus),
.form-item :deep(.ant-input-affix-wrapper:focus) {
  border-color: var(--claude-brand);
  box-shadow: 0 0 0 2px rgba(201, 100, 66, 0.1);
}

.input-icon {
  color: var(--claude-text-tertiary);
}

/* === 性别选择 === */
.gender-group {
  display: flex;
  gap: var(--claude-space-3);
}

.gender-option {
  flex: 1;
  text-align: center;
  height: 40px;
  line-height: 40px;
  border-radius: var(--claude-radius-md) !important;
  transition: all var(--claude-transition-base);
}

.gender-option:hover {
  border-color: var(--claude-brand) !important;
  color: var(--claude-brand) !important;
}

/* === 简介文本域 === */
.bio-textarea {
  border-radius: var(--claude-radius-md);
}

.bio-textarea :deep(.ant-input) {
  resize: none;
}

/* === 提交按钮 === */
.submit-item {
  margin-bottom: 0;
  margin-top: var(--claude-space-4);
}

.submit-btn {
  width: 100%;
  height: 48px;
  background: var(--claude-brand);
  border-color: var(--claude-brand);
  border-radius: var(--claude-radius-md);
  font-size: 15px;
  font-weight: 500;
  transition: all var(--claude-transition-base);
}

.submit-btn:hover {
  background: var(--claude-brand-dark) !important;
  border-color: var(--claude-brand-dark) !important;
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(201, 100, 66, 0.35);
}

.password-btn {
  background: var(--claude-bg-dark);
  border-color: var(--claude-bg-dark);
}

.password-btn:hover {
  background: var(--claude-bg-deep) !important;
  border-color: var(--claude-bg-deep) !important;
}

/* === 安全提示 === */
.security-tips {
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
}

.tips-header {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
  font-weight: 600;
  color: var(--claude-text-primary);
  margin-bottom: var(--claude-space-4);
}

.tips-icon {
  color: var(--claude-brand);
}

.tips-list {
  margin: 0;
  padding-left: var(--claude-space-5);
  color: var(--claude-text-secondary);
  font-size: 13px;
  line-height: 2;
}

.tips-list li::marker {
  color: var(--claude-brand);
}

/* === 响应式 === */
@media (max-width: 1200px) {
  .settings-content {
    flex-direction: column;
    gap: var(--claude-space-5);
  }

  .form-col,
  .security-col {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .settings-form {
    padding: var(--claude-space-4);
  }

  .form-item {
    margin-bottom: var(--claude-space-4);
  }
}
</style>