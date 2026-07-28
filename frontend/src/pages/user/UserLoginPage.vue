<script lang="ts" setup>
import { reactive, ref } from 'vue'
import { UserOutlined, LockOutlined } from '@ant-design/icons-vue'
import { userLogin } from '@/api/userController'
import { useRouter } from 'vue-router'
import { useLoginUserStore } from '@/stores/user'
import { message } from 'ant-design-vue'

const router = useRouter()
const userLoginStore = useLoginUserStore()
const loading = ref(false)
const rememberMe = ref(false)
void rememberMe

const formState = reactive<API.UserLoginDTO>({
  userAccount: '',
  userPassword: '',
})

const handleSubmit = async (values: any) => {
  loading.value = true
  try {
    const res = await userLogin(values)
    if(res.data.code === 0 && res.data.data) {
      if (import.meta.env.DEV) {
        console.log('[Login] Response:', res.data.data)
      }
      await userLoginStore.fetchLoginUser()
      message.success('登录成功')
      const loginUser = userLoginStore.loginUser
      if (loginUser?.userRole === 'admin') {
        router.push({ path: '/admin/dashboard', replace: true })
      } else {
        router.push({ path: '/', replace: true })
      }
    } else {
      message.error('登录失败: ' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <!-- 背景层 -->
    <div class="background-layer"></div>

    <!-- 登录表单卡片 -->
    <div class="login-card">
      <div class="logo-container">
        <img src="@/assets/eyesight-logo.svg" alt="眼科诊断系统" class="logo">
        <h1 class="system-name">EyeSight</h1>
      </div>

      <a-form
        :model="formState"
        name="basic"
        autocomplete="off"
        @finish="handleSubmit"
        class="login-form"
      >
        <a-form-item
          name="userAccount"
          :rules="[{required:true,message:'请输入账号'}]"
        >
          <a-input
            v-model:value="formState.userAccount"
            placeholder="请输入账号"
            size="large"
          >
            <template #prefix>
              <UserOutlined style="color: rgba(0, 0, 0, 0.25)" />
            </template>
          </a-input>
        </a-form-item>

        <a-form-item
          name="userPassword"
          :rules="[
            {required:true,message:'请输入密码'},
            {min:8,message:'密码不能小于8位'}
          ]"
        >
          <a-input-password
            v-model:value="formState.userPassword"
            placeholder="请输入密码"
            size="large"
          >
            <template #prefix>
              <LockOutlined style="color: rgba(0, 0, 0, 0.25)" />
            </template>
          </a-input-password>
        </a-form-item>

        <a-form-item>
          <a-button
            type="primary"
            html-type="submit"
            size="large"
            :loading="loading"
            class="login-button"
          >
            登录
          </a-button>
        </a-form-item>

        <div class="register-tip">
          还没有账号? <RouterLink to="/user/register" class="register-link">立即注册</RouterLink>
        </div>
      </a-form>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: url('@/assets/login.png') no-repeat center center fixed;
  background-size: cover;
  position: relative;
  overflow: hidden;
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

.login-card {
  width: 420px;
  padding: 40px;
  background: var(--claude-bg-elevated);
  border-radius: 12px;
  box-shadow:
    0 1px 2px rgba(201, 100, 66, 0.06),
    0 4px 8px rgba(201, 100, 66, 0.08),
    0 12px 24px rgba(201, 100, 66, 0.10);
  z-index: 1;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--claude-border-cream);
}

.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
  background: linear-gradient(90deg, var(--claude-brand) 0%, var(--claude-brand-light) 100%);
}

.logo-container {
  text-align: center;
  margin-bottom: 30px;
}

.logo {
  width: 96px;
  height: auto;
  margin: 0 auto 15px;
  display: block;
}

.system-name {
  font-size: 22px;
  color: var(--claude-brand);
  margin-bottom: 0;
  font-weight: 600;
}

.login-form {
  margin-top: 20px;
}

.login-form :deep(.ant-input-affix-wrapper) {
  padding: 10px 15px;
  border-radius: 6px;
  background: var(--claude-bg-elevated);
}

.login-form :deep(.ant-input) {
  font-size: 15px;
  background: transparent;
}

.login-button {
  width: 100%;
  height: 45px;
  font-size: 16px;
  font-weight: 500;
  border-radius: 6px;
  margin-top: 10px;
}

.register-tip {
  text-align: center;
  margin-top: 20px;
  color: var(--claude-text-secondary);
  font-size: 14px;
}

.register-link {
  color: var(--claude-brand);
  font-weight: 500;
  margin-left: 5px;
}

/* 响应式设计 */
@media (max-width: 480px) {
  .login-card {
    width: 90%;
    padding: 30px 20px;
  }

  .logo {
    width: 60px;
    height: 60px;
  }

  .system-name {
    font-size: 20px;
  }
}
</style>
