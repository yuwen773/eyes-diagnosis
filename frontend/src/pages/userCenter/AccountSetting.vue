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
          <a-form-item label="用户名" name="name">
            <a-input v-model:value="formState.userName"
                     :rules="[{required:true,message:'请输入用户名'}]"
            />
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
        <a-form-item label="用户简介" name="description" class="description-item">
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

const formState = reactive<API.UserEditDTO>({
  id: loginUser.id,
  userName: loginUser.userName,
  gender: loginUser?.gender || '1',
  phone: loginUser?.phone || '******',
  email: loginUser?.email || '******',
  userProfile: loginUser?.userProfile || '' // 新增的用户简介字段
})

const rules: Record<string, Rule[]> = {
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  description: [
    { max: 200, message: '简介不能超过200个字符', trigger: 'blur' }
  ]
}

const handleSubmit = async () => {
  try {
    submitting.value = true
    // 这里调用更新用户信息的API
    const res = await editUserCenter(formState)
    if(res.data.code === 0 && res.data.data !==null) {
      message.success('个人信息更新成功')
    }
  } catch (error) {
    console.log(error)
    message.error('更新失败，请重试')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.settings-container {
  padding: 24px;
  background: #fff;
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
</style>
