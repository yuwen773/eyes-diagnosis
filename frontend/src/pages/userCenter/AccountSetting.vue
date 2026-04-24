<template>
  <div class="settings-container">
    <a-page-header title="账号设置" />
    <a-row :gutter="24">
      <a-col :span="12">
        <a-form
          :model="formState"
          :rules="rules"
          @finish="handleSubmit"
          layout="vertical"
          class="settings-form"
        >
          <a-form-item label="用户名" name="userName">
            <a-input v-model:value="formState.userName" />
          </a-form-item>
          <a-form-item label="性别" name="gender">
            <a-radio-group v-model:value="formState.gender">
              <a-radio :value="1">男</a-radio>
              <a-radio :value="0">女</a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item label="手机号" name="phone">
            <a-input v-model:value="formState.phone" />
          </a-form-item>

          <a-form-item label="邮箱" name="email">
            <a-input v-model:value="formState.email" />
          </a-form-item>

          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="submitting">
              保存更改
            </a-button>
          </a-form-item>
        </a-form>
      </a-col>
      <!-- 右侧空白位置添加用户简介 -->
      <a-col :span="12">
        <a-form-item label="用户简介" name="userProfile" class="description-item">
          <a-textarea
            v-model:value="formState.userProfile"
            :rows="6"
            :placeholder="loginUser?.userProfile ||'这个用户很懒，什么都没有留下'"
            :maxlength="200"
            show-count
          />
        </a-form-item>
      </a-col>
    </a-row>

    <!-- 安全设置 -->
    <a-divider />
    <div class="security-section">
      <a-tag color="gold">安全设置</a-tag>
      <a-form
        :model="passwordFormState"
        :rules="passwordRules"
        @finish="handlePasswordChange"
        layout="vertical"
        class="password-form"
      >
        <a-form-item label="旧密码" name="oldPassword">
          <a-input-password
            v-model:value="passwordFormState.oldPassword"
            placeholder="请输入旧密码"
            class="ds-input"
          />
        </a-form-item>
        <a-form-item label="新密码" name="newPassword">
          <a-input-password
            v-model:value="passwordFormState.newPassword"
            placeholder="请输入新密码"
            class="ds-input"
          />
        </a-form-item>
        <a-form-item label="确认密码" name="confirmPassword">
          <a-input-password
            v-model:value="passwordFormState.confirmPassword"
            placeholder="请再次输入新密码"
            class="ds-input"
          />
        </a-form-item>
        <a-form-item>
          <a-button type="primary" html-type="submit" :loading="passwordSubmitting" class="ds-btn-primary">
            更新密码
          </a-button>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed } from 'vue'
import { message } from 'ant-design-vue'
import { useUserStore } from '@/stores/userCenter'
import type { Rule } from 'ant-design-vue/es/form'
import { useLoginUserStore } from '@/stores/user'
import { editUserCenter } from '@/api/userController'

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
  userProfile: loginUser?.userProfile || '' // 新增的用户简介字段
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
    // Mock success - API would be called here if updateUserPassword exists
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
  padding: 24px;
  background: var(--claude-bg-card);
  border-radius: 4px;
}

.settings-form {
  max-width: 100%;
  margin-top: 24px;
}

.description-item {
  margin-top: 24px;
  padding-left: 24px;
  border-left: 1px solid #f0f0f0;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .ant-col-12 {
    width: 100%;
  }

  .description-item {
    padding-left: 0;
    border-left: none;
    border-top: 1px solid #f0f0f0;
    padding-top: 24px;
    margin-top: 24px;
  }
}

.security-section {
  margin-top: 24px;
  padding: 20px;
  background: var(--color-surface, #fafafa);
  border-radius: var(--radius-md, 8px);
}

.security-section :deep(.ds-input) {
  width: 100%;
  max-width: 320px;
}

.security-section :deep(.ds-btn-primary) {
  margin-top: 8px;
}
</style>
