<template>
  <a-modal
    :open="open"
    @update:open="emit('update:open', $event)"
    title="头像预览"
    :footer="null"
    :destroyOnClose="true"
    class="avatar-modal"
  >
    <div class="avatar-modal-content">
      <div class="avatar-preview-wrapper">
        <img
          :src="avatarUrl"
          alt="头像预览"
          class="avatar-preview"
        />
        <div class="avatar-overlay" @click="emit('update:open', false)">
          <CameraOutlined class="camera-icon" />
        </div>
      </div>
      <a-upload
        :showUploadList="false"
        :beforeUpload="beforeAvatarUpload"
        :customRequest="handleUpload"
        class="avatar-upload"
      >
        <a-button type="primary" size="large" class="upload-btn">
          <UploadOutlined /> 更换头像
        </a-button>
      </a-upload>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { CameraOutlined, UploadOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { uploadAvatarPicture } from '@/api/userController'
import { useLoginUserStore } from '@/stores/user'

interface Props {
  open: boolean
  avatarUrl: string
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'uploadSuccess'): void
}>()

const loginUserStore = useLoginUserStore()

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

const handleUpload = async (options: { file: File }) => {
  const { file } = options
  try {
    const params = { userEditDTO: { id: loginUserStore.loginUser.id } }
    const res = await uploadAvatarPicture(params, {}, file)

    if (res.data.code === 0 && res.data.data) {
      await loginUserStore.fetchLoginUser()
      emit('update:open', false)
      emit('uploadSuccess')
      message.success('头像更新成功')
    } else {
      message.error('头像上传失败,' + res.data.msg)
    }
  } catch {
    message.error('头像上传失败')
  }
}
</script>

<style scoped>
/* === 头像模态框样式 === */
.avatar-modal-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--claude-space-6) 0;
}

.avatar-preview-wrapper {
  position: relative;
  width: 140px;
  height: 140px;
  margin-bottom: var(--claude-space-6);
}

.avatar-preview {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 4px solid var(--claude-bg-elevated);
  box-shadow: 0 8px 24px rgba(20, 20, 19, 0.15);
}

.avatar-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--claude-transition-base);
}

.avatar-preview-wrapper:hover .avatar-overlay {
  opacity: 1;
}

.camera-icon {
  font-size: 32px;
  color: #fff;
}

.upload-btn {
  background: var(--claude-brand);
  border-color: var(--claude-brand);
  height: 44px;
  padding: 0 32px;
  border-radius: var(--claude-radius-lg);
  font-size: 15px;
  transition: all var(--claude-transition-base);
}

.upload-btn:hover {
  background: var(--claude-brand-dark) !important;
  border-color: var(--claude-brand-dark) !important;
}
</style>
