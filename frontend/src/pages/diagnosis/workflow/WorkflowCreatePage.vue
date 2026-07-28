<script setup lang="ts">
/**
 * 诊断创建页 /diagnosis/create
 * 上传眼底图片（可选）→ 填写主诉 → 创建诊断 Workflow。
 * 创建成功后展示 Workflow ID 与后端返回的初始状态。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { createWorkflow, type WorkflowCreateResult } from '@/api/workflow'
import { uploadAgentImage } from '@/api/agentController'
import WorkflowStatusBadge from '@/components/workflow/WorkflowStatusBadge.vue'

const router = useRouter()

const imageFile = ref<File | null>(null)
const imagePreview = ref<string | null>(null)
const question = ref('')
const suddenVisionLoss = ref(false)
const severeEyePain = ref(false)
const flashingLights = ref(false)

const submitting = ref(false)
const created = ref<WorkflowCreateResult | null>(null)

const onFileChange = (e: Event) => {
  const files = (e.target as HTMLInputElement).files
  if (!files || files.length === 0) return
  const file = files[0]
  if (!file.type.startsWith('image/')) {
    message.warning('请选择图片文件')
    return
  }
  imageFile.value = file
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imagePreview.value = URL.createObjectURL(file)
}

const removeImage = () => {
  imageFile.value = null
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imagePreview.value = null
}

const submit = async () => {
  if (submitting.value) return
  submitting.value = true
  try {
    let imageId: string | null = null
    if (imageFile.value) {
      imageId = await uploadAgentImage(imageFile.value)
    }
    const res = await createWorkflow({
      imageId,
      question: question.value.trim() || null,
      symptoms: {
        suddenVisionLoss: suddenVisionLoss.value,
        severeEyePain: severeEyePain.value,
        flashingLights: flashingLights.value,
      },
    })
    if (res.data.code === 0 && res.data.data) {
      created.value = res.data.data
      message.success('诊断工作流创建成功')
    } else {
      message.error(res.data.msg || '创建失败')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

const goDetail = () => {
  if (created.value) {
    router.push(`/diagnosis/${created.value.workflowId}`)
  }
}
</script>

<template>
  <div class="wf-create">
    <div class="wf-create__card">
      <h2 class="wf-create__title">发起智能诊断</h2>
      <p class="wf-create__subtitle">
        上传眼底照片并描述症状，AI 将进行多阶段分析；必要时结果会转交医生复核。
      </p>

      <!-- 创建成功回执 -->
      <div v-if="created" class="wf-create__success" data-testid="create-success">
        <div class="wf-create__success-icon" aria-hidden="true">✓</div>
        <h3>创建成功</h3>
        <dl class="wf-create__receipt">
          <dt>Workflow ID</dt>
          <dd data-testid="created-workflow-id">{{ created.workflowId }}</dd>
          <dt>当前状态</dt>
          <dd><WorkflowStatusBadge :status="created.status" /></dd>
        </dl>
        <button type="button" class="wf-btn wf-btn--primary" data-testid="go-detail" @click="goDetail">
          查看实时进度
        </button>
      </div>

      <!-- 创建表单 -->
      <form v-else class="wf-create__form" @submit.prevent="submit">
        <div class="wf-form-item">
          <label class="wf-form-label">眼底照片（可选）</label>
          <div v-if="imagePreview" class="wf-create__preview">
            <img :src="imagePreview" alt="眼底照片预览" />
            <button type="button" class="wf-btn wf-btn--ghost" @click="removeImage">移除</button>
          </div>
          <label v-else class="wf-create__upload">
            <input type="file" accept="image/*" data-testid="image-input" @change="onFileChange" />
            <span>点击选择眼底照片</span>
          </label>
        </div>

        <div class="wf-form-item">
          <label class="wf-form-label" for="wf-question">症状描述（可选）</label>
          <textarea
            id="wf-question"
            v-model="question"
            rows="3"
            class="wf-create__question"
            placeholder="例如：右眼近一周视物模糊，伴轻微胀痛…"
            data-testid="question-input"
          ></textarea>
        </div>

        <fieldset class="wf-form-item wf-create__symptoms">
          <legend class="wf-form-label">是否存在以下情况？</legend>
          <label><input v-model="suddenVisionLoss" type="checkbox" data-testid="symptom-vision-loss" /> 突发视力下降</label>
          <label><input v-model="severeEyePain" type="checkbox" data-testid="symptom-eye-pain" /> 剧烈眼痛</label>
          <label><input v-model="flashingLights" type="checkbox" data-testid="symptom-flashing" /> 眼前闪光感</label>
        </fieldset>

        <button
          type="submit"
          class="wf-btn wf-btn--primary wf-create__submit"
          data-testid="create-submit"
          :disabled="submitting"
        >
          {{ submitting ? '正在创建…' : '开始智能诊断' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.wf-create {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}
.wf-create__card {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 16px;
  padding: 32px;
}
.wf-create__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 24px;
  color: #141413;
  margin: 0 0 6px;
}
.wf-create__subtitle {
  font-size: 14px;
  color: #6b6a66;
  margin: 0 0 24px;
}
.wf-form-item {
  margin-bottom: 20px;
}
.wf-form-label {
  display: block;
  font-size: 14px;
  color: #33322f;
  font-weight: 600;
  margin-bottom: 8px;
}
.wf-create__upload {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #ded9cb;
  border-radius: 12px;
  padding: 32px;
  cursor: pointer;
  color: #8f8d86;
  font-size: 14px;
  transition: border-color 0.15s ease;
}
.wf-create__upload:hover {
  border-color: #c96442;
  color: #c96442;
}
.wf-create__upload input {
  display: none;
}
.wf-create__preview {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.wf-create__preview img {
  max-width: 240px;
  border-radius: 12px;
  border: 1px solid #e8e6dc;
}
.wf-create__question {
  width: 100%;
  border: 1px solid #ded9cb;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
  box-sizing: border-box;
  resize: vertical;
}
.wf-create__question:focus {
  outline: none;
  border-color: #c96442;
}
.wf-create__symptoms {
  border: none;
  padding: 0;
  margin-left: 0;
  margin-right: 0;
}
.wf-create__symptoms label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #33322f;
  margin-bottom: 8px;
  cursor: pointer;
}
.wf-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 24px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.wf-btn--primary {
  background: #c96442;
  color: #fff;
}
.wf-btn--primary:hover:not(:disabled) {
  background: #b5502f;
}
.wf-btn--primary:disabled {
  background: #d9d7cd;
  cursor: not-allowed;
}
.wf-btn--ghost {
  background: transparent;
  border: 1px solid #ded9cb;
  color: #6b6a66;
}
.wf-create__submit {
  width: 100%;
  padding: 12px;
  font-size: 15px;
}
.wf-create__success {
  text-align: center;
  padding: 16px 0;
}
.wf-create__success-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(63, 145, 96, 0.12);
  color: #2f7d4f;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
}
.wf-create__success h3 {
  font-family: Georgia, serif;
  color: #141413;
  margin: 0 0 16px;
}
.wf-create__receipt {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: center;
  gap: 8px 16px;
  margin: 0 0 24px;
}
.wf-create__receipt dt {
  color: #6b6a66;
  font-size: 14px;
}
.wf-create__receipt dd {
  margin: 0;
  font-size: 14px;
  color: #141413;
  font-family: ui-monospace, monospace;
}
</style>
