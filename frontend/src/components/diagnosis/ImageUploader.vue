<template>
  <a-card class="image-uploader-card">
    <template #title>
      <span class="card-title">
        <UploadOutlined aria-hidden="true" />
        眼部图像上传
      </span>
    </template>

    <!-- 拖拽上传区域 -->
    <a-upload-dragger
      :file-list="fileList"
      :before-upload="beforeUpload"
      :custom-request="handleUpload"
      :show-upload-list="false"
      :disabled="loading"
      class="upload-dragger"
      :class="{ 'has-image': picture?.url }"
    >
      <!-- 已上传图片预览 -->
      <div v-if="picture?.url" class="image-preview-container">
        <img
          :src="picture.url"
          alt="已上传的眼部图像"
          class="preview-image"
        />
        <div class="preview-overlay">
          <span class="preview-hint">点击重新上传</span>
        </div>
      </div>

      <!-- 上传占位符 -->
      <div v-else class="upload-placeholder">
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽眼部图像到此区域上传</p>
        <p class="ant-upload-hint">
          支持 JPG、PNG 格式，最大 5MB
        </p>
      </div>
    </a-upload-dragger>

    <!-- 诊断按钮 -->
    <a-button
      type="primary"
      :disabled="!uploadedImageUrl || loading"
      @click="startDiagnosis"
      block
      class="diagnose-btn"
      :loading="loading && uploadedImageUrl"
    >
      <template #icon>
        <PlayCircleOutlined aria-hidden="true" />
      </template>
      {{ loading && uploadedImageUrl ? '诊断中...' : '开始诊断' }}
    </a-button>

    <!-- 加载提示 -->
    <div v-if="loading && !uploadedImageUrl" class="loading-container">
      <a-spin tip="正在上传图像..." size="large" />
    </div>
  </a-card>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { message, type UploadProps } from 'ant-design-vue'
import { UploadOutlined, InboxOutlined, PlayCircleOutlined } from '@ant-design/icons-vue';
import { useDiagnosisStore } from '@/stores/diagnosis';
import { doDiagnosis, uploadPicture } from '@/api/diagnosisController'

// 受控组件，由父元素管理
interface Props {
  picture?: API.DiagnosisManageVO
  onSuccess?: (newPicture: API.DiagnosisManageVO) => void
}

const props = defineProps<Props>()

// 加载状态
const loading = ref(false)

// 诊断 store
const diagnosisStore = useDiagnosisStore();
const { setDiagnosisResult, setLoading } = diagnosisStore;

// 文件列表
const fileList = ref([]);

// 上传状态
const uploadedImageUrl = ref<string | null>(null);
const uploadedFile = ref<File | null>(null);

// 图片校验
const beforeUpload: UploadProps['beforeUpload'] = (file) => {
  // 文件类型验证
  const allowedTypes = ['image/jpeg', 'image/png']
  const isJpgOrPng = allowedTypes.includes(file.type)
  if (!isJpgOrPng) {
    message.error('只能上传 JPG 或 PNG 格式的图片')
    return false
  }

  // 文件大小验证（5MB）
  const maxSize = 5 * 1024 * 1024
  const isLt5M = file.size < maxSize
  if (!isLt5M) {
    message.error('图片大小不能超过 5MB')
    return false
  }

  return true
};

// 处理上传
const handleUpload = async ({ file }: { file: File }) => {
  loading.value = true
  try {
    const params = props.picture
      ? { diagnosisUploadDTO: { id: props.picture.id } }
      : { diagnosisUploadDTO: {} }

    const res = await uploadPicture(params, {}, file)

    if (res.data.code === 0 && res.data.data) {
      message.success('图片上传成功')
      uploadedImageUrl.value = res.data.data.url ?? null
      uploadedFile.value = file as File
      props.onSuccess?.(res.data.data)
    } else {
      message.error(res.data.msg || '图片上传失败，请稍后重试')
    }
  } catch (error) {
    console.error('上传失败:', error)
    message.error('网络连接不稳定，上传失败，请检查网络后重试')
  } finally {
    loading.value = false
  }
}

// 开始诊断
const startDiagnosis = async () => {
  if (!uploadedFile.value) {
    message.warning('请先上传图像')
    return
  }

  loading.value = true
  setLoading(true)

  try {
    const res = await doDiagnosis(uploadedFile.value)

    if (res.data.code === 0 && res.data.data) {
      setDiagnosisResult(res.data.data)
    } else {
      message.error(res.data.msg || '诊断失败，请稍后重试')
    }
  } catch (error) {
    console.error('诊断失败:', error)
    message.error('诊断服务暂时不可用，请稍后再试')
  } finally {
    loading.value = false
    setLoading(false)
  }
}
</script>

<style scoped>
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.image-uploader-card {
  border-radius: var(--claude-radius-lg);
}

.upload-dragger {
  border-radius: var(--claude-radius-md);
  transition: all 0.3s ease;
}

.upload-dragger:hover {
  border-color: var(--claude-brand);
}

.upload-placeholder {
  padding: var(--claude-space-4) 0;
}

.image-preview-container {
  position: relative;
  width: 100%;
  max-width: 450px;
  margin: 0 auto;
}

.preview-image {
  width: 100%;
  height: auto;
  max-height: 300px;
  object-fit: contain;
  border-radius: var(--claude-radius-md);
}

.preview-overlay {
  position: absolute;
  inset: 0;
  background: oklch(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--claude-radius-md);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.image-preview-container:hover .preview-overlay {
  opacity: 1;
}

.preview-hint {
  color: var(--claude-text-inverse);
  font-size: 0.875rem;
  font-weight: 500;
}

.diagnose-btn {
  margin-top: 16px;
  height: 44px;
  font-size: 0.9375rem;
}

.loading-container {
  margin-top: 24px;
  text-align: center;
}

:deep(.ant-upload-drag-icon) {
  font-size: 3rem;
  color: var(--claude-brand);
}

:deep(.ant-upload-text),
:deep(.ant-upload-hint) {
  color: var(--claude-text-secondary);
}

@media (max-width: 768px) {
  .preview-image {
    max-height: 200px;
  }

  .diagnose-btn {
    height: 48px;
  }
}
</style>
