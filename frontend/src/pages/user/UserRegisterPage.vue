<script lang="ts" setup>
import { reactive, ref } from 'vue'
import { UserOutlined, LockOutlined } from '@ant-design/icons-vue'
import { userRegister } from '@/api/userController'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import type { Rule } from 'ant-design-vue/es/form'

const router = useRouter()
const loading = ref(false)

const formState = reactive({
  userAccount: '',
  userPassword: '',
  checkPassword: '',
})

// 自定义密码匹配验证
const validatePasswordMatch = async (_rule: Rule, value: string) => {
  if (value !== formState.userPassword) {
    return Promise.reject('两次输入的密码不一致')
  }
  return Promise.resolve()
}

const handleSubmit = async (values: any) => {
  loading.value = true
  try {
    const res = await userRegister(values)
    if(res.data.code === 0 && res.data.data) {
      message.success('注册成功')
      router.push({
        path: '/user/login',
        replace: true,
      })
    } else {
      message.error('注册失败: ' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-container">
    <!-- 背景层 -->
    <div class="background-layer"></div>

    <!-- 注册表单卡片 -->
    <div class="register-card">
      <div class="logo-container">
        <img src="@/assets/logo.png" alt="眼科诊断系统" class="logo">
        <h1 class="system-name">明眸智诊，视界无忧</h1>
        <p class="page-title">用户注册</p>
      </div>

      <a-form
        :model="formState"
        name="basic"
        autocomplete="off"
        @finish="handleSubmit"
        class="register-form"
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

        <a-form-item
          name="checkPassword"
          :rules="[
            {required:true,message:'请确认密码'},
            {min:8,message:'密码不能小于8位'},
            {validator: validatePasswordMatch}
          ]"
        >
          <a-input-password
            v-model:value="formState.checkPassword"
            placeholder="请确认密码"
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
            class="register-button"
          >
            注册
          </a-button>
        </a-form-item>

        <div class="login-tip">
          已有账号? <RouterLink to="/user/login" class="login-link">立即登录</RouterLink>
        </div>
      </a-form>
    </div>
  </div>
</template>

<style scoped>
.register-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 90vh;
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
/*  background: inherit;*/
  filter: blur(8px);
  z-index: 0;
}

.register-card {
  width: 420px;
  padding: 40px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  z-index: 1;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.register-card::before {
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
  margin-bottom: 20px;
}

.logo {
  width: 80px;
  height: 80px;
  margin-bottom: 10px;
}

.system-name {
  font-size: 22px;
  color: var(--claude-brand);
  margin-bottom: 5px;
  font-weight: 600;
}

.page-title {
  font-size: 16px;
  color: var(--claude-text-secondary);
  margin-bottom: 0;
}

.register-form {
  margin-top: 20px;
}

.register-form :deep(.ant-input-affix-wrapper) {
  padding: 10px 15px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.7);
}

.register-form :deep(.ant-input) {
  font-size: 15px;
  background: transparent;
}

.register-button {
  width: 100%;
  height: 45px;
  font-size: 16px;
  font-weight: 500;
  border-radius: 6px;
  margin-top: 10px;
}

.login-tip {
  text-align: center;
  margin-top: 20px;
  color: var(--claude-text-secondary);
  font-size: 14px;
}

.login-link {
  color: var(--claude-brand);
  font-weight: 500;
  margin-left: 5px;
}

/* 响应式设计 */
@media (max-width: 480px) {
  .register-card {
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
