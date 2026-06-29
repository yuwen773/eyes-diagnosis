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
      :disabled="loading || diagnoseStage !== 'idle'"
      class="upload-dragger"
      :class="{ 'has-image': picture?.url || uploadedImageUrl }"
    >
      <!-- 诊断进度状态 -->
      <div v-if="diagnoseStage !== 'idle' && diagnoseStage !== 'success'" class="diagnosis-progress">
        <div class="progress-stage-label">{{ stageLabels[diagnoseStage] }}</div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" :style="{ width: diagnoseProgress + '%' }" />
        </div>
        <div v-if="diagnoseStage !== 'error'" class="progress-percentage">{{ diagnoseProgress }}%</div>
        <div v-if="diagnoseStage === 'error'" class="progress-error-actions">
          <a-button type="primary" size="small" @click.stop="retryDiagnosis">
            重新诊断
          </a-button>
        </div>
      </div>

      <!-- 已上传图片预览 -->
      <div v-else-if="uploadedImageUrl" class="image-preview-container">
        <img
          :src="uploadedImageUrl"
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
        <p class="upload-quality-hint">
          请确保照片清晰、光照均匀，一次只拍摄一只眼睛
        </p>
      </div>
    </a-upload-dragger>

    <!-- 诊断按钮 -->
    <a-button
      type="primary"
      :disabled="!uploadedImageUrl || diagnoseStage !== 'idle'"
      @click="startDiagnosis"
      block
      class="diagnose-btn"
      :loading="diagnoseStage !== 'idle' && diagnoseStage !== 'success' && diagnoseStage !== 'error'"
    >
      <template #icon>
        <PlayCircleOutlined aria-hidden="true" />
      </template>
      {{
        diagnoseStage === 'submitting' ? '发送中...' :
        diagnoseStage === 'analyzing' ? '分析中...' :
        diagnoseStage === 'reporting' ? '生成报告中...' :
        diagnoseStage === 'retrying' ? '重试中...' :
        diagnoseStage === 'success' ? '诊断完成' :
        diagnoseStage === 'error' ? '重新诊断' :
        '开始诊断'
      }}
    </a-button>
  </a-card>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
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
const { setDiagnosisResult } = diagnosisStore;

// 文件列表
const fileList = ref([]);

// 上传状态
const uploadedImageUrl = ref<string | null>(null);
const uploadedFile = ref<File | null>(null);

// 诊断进度状态
const diagnoseStage = ref<'idle' | 'submitting' | 'analyzing' | 'reporting' | 'retrying' | 'error' | 'success'>('idle')

const stageLabels: Record<string, string> = {
  submitting: '正在发送诊断请求',
  analyzing: '正在分析眼底图像',
  reporting: '正在生成诊断报告',
  retrying: '网络波动，正在重试',
  error: '分析失败，请检查网络后重试',
  success: '诊断完成'
}

const stageProgressMax: Record<string, number> = {
  submitting: 30,
  analyzing: 70,
  reporting: 95,
  retrying: 15,
}

const diagnoseProgress = ref(0)
let progressTimer: ReturnType<typeof setInterval> | null = null

const clearProgressTimer = () => {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

const resetDiagnosisState = () => {
  diagnoseStage.value = 'idle'
  diagnoseProgress.value = 0
  clearProgressTimer()
}

const startProgressSimulation = (startStage: 'submitting' | 'analyzing' | 'reporting') => {
  clearProgressTimer()
  diagnoseProgress.value = 0

  const targetMax = stageProgressMax[startStage]
  const duration = startStage === 'submitting' ? 600 : startStage === 'analyzing' ? 2000 : 1200
  const steps = 30
  const increment = targetMax / steps
  const intervalTime = duration / steps

  let step = 0
  progressTimer = setInterval(() => {
    step++
    diagnoseProgress.value = Math.min(Math.round(increment * step), targetMax - 1)
    if (step >= steps) {
      clearProgressTimer()
      diagnoseProgress.value = targetMax
    }
  }, intervalTime)
}

const advanceToStage = (nextStage: 'analyzing' | 'reporting', onComplete: () => void) => {
  clearProgressTimer()
  diagnoseStage.value = nextStage
  diagnoseProgress.value = 0
  startProgressSimulation(nextStage)

  const duration = nextStage === 'analyzing' ? 2000 : 1200
  setTimeout(() => {
    clearProgressTimer()
    diagnoseProgress.value = 100
    setTimeout(onComplete, 300)
  }, duration)
}

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

  // 启动分阶段进度动画
  diagnoseStage.value = 'submitting'
  startProgressSimulation('submitting')

  // 模拟上传完成，进入分析阶段
  setTimeout(() => {
    advanceToStage('analyzing', async () => {
      diagnoseStage.value = 'reporting'

      // 最终诊断请求
      diagnosisStore.openResultModal()
      try {
        const res = await doDiagnosis(uploadedFile.value!)

        if (res.data.code === 0 && res.data.data) {
          diagnoseStage.value = 'success'
          setDiagnosisResult(res.data.data)
          // openResultModal() 已调用，loading 为 true，Modal 保持打开
        } else {
          diagnoseStage.value = 'error'
          diagnosisStore.closeResultModal()
        }
      } catch (error) {
        console.error('诊断失败:', error)
        diagnoseStage.value = 'error'
        diagnosisStore.closeResultModal()
      }
    })
  }, 800)
}

const retryDiagnosis = () => {
  diagnoseStage.value = 'idle'
  diagnoseProgress.value = 0
  // 延迟一点让用户看到重置，然后重新开始
  setTimeout(() => {
    startDiagnosis()
  }, 100)
}

// 监听 modal 关闭，重置成功状态
watch(() => diagnosisStore.resultModalVisible, (isOpen) => {
  if (!isOpen && diagnoseStage.value === 'success') {
    resetDiagnosisState()
  }
})
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

/* ── 诊断进度状态 ── */

.diagnosis-progress {
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
  animation: progress-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes progress-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.progress-stage-label {
  font-size: 0.9375rem;
  color: var(--claude-text-primary);
  font-weight: 500;
  text-align: center;
}

.progress-bar-container {
  width: 100%;
  max-width: 280px;
  height: 6px;
  background: oklch(0.75 0.04 30 / 0.15);
  border-radius: 100px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--claude-brand), oklch(0.75 0.08 30));
  border-radius: 100px;
  transition: width 0.15s ease-out;
}

.progress-percentage {
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
  font-family: 'IBM Plex Mono', monospace;
}

.progress-error-actions {
  margin-top: 0.25rem;
}

.upload-quality-hint {
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: oklch(0.75 0.04 30 / 0.06);
  border-radius: var(--claude-radius-sm);
}

/* ── 图片预览 ── */

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

  .progress-bar-container {
    max-width: 220px;
  }
}
</style>
