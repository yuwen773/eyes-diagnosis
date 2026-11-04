<script lang="ts" setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { marked } from 'marked'
import { QuestionCircleOutlined } from '@ant-design/icons-vue';
import {
  getNewsVo,
  updateNews,
  uploadAttachment,
  uploadCoverImage
} from '@/api/newsController'
import { useRoute } from 'vue-router'
import router from '@/router'
const route = useRoute()

interface FormState {
  title: string
  articleType: 'original' | 'reprint' | 'translation'
  content: string
  coverImage?: string
}

const formState = reactive<FormState>({
  title: '',
  articleType: 'original',
  content: '',
})
const news = ref<API.NewsVO | null>(null)
const activeTab = ref<'edit' | 'preview'>('edit')
const theme = ref<'light' | 'dark'>('light')
const previewHtml = computed(() => marked(formState.content))

const fileList = ref<any[]>([])
const previewVisible = ref(false)
const previewImage = ref('')

const saving = ref(false)
const publishing = ref(false)

const pageTitle = computed(() => {
  return route.params.id ? '编辑新闻' : '发布新闻'
})

const pageSubtitle = computed(() => {
  return route.params.id ? '修改已发布的内容' : '撰写新的眼科资讯'
})

const clearImage = () => {
  previewImage.value = ''
  fileList.value = []
  formState.coverImage = undefined
}

const beforeUpload = (file: File) => {
  const isImage = file.type === 'image/jpeg' || file.type === 'image/png'
  if (!isImage) {
    message.error('只能上传 JPG/PNG 格式的图片!')
    return false
  }
  const isLt5M = file.size / 1024 / 1024 < 5
  if (!isLt5M) {
    message.error('图片大小不能超过5MB!')
    return false
  }
  return true
}

const handleUpload = async ({ file }: { file: File }) => {
  const id = Number(route.params.id)
  const res = await uploadCoverImage({ newsUploadDTO: { id } }, {}, file)
  if (res.data.data && res.data.code === 0) {
    message.success('封面图片上传成功')
    previewImage.value = res.data.data
  } else {
    message.error('封面图片上传失败')
  }
  saving.value = false
}

const handlePreview = () => {
  previewVisible.value = true
}

const handleCancel = () => {
  previewVisible.value = false
}

const handleUploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  const urls: string[] = []
  for (const file of files) {
    const res = await uploadAttachment({}, file)
    if (res.data.data && res.data.code === 0) {
      urls.push(res.data.data)
    }
  }
  callback(urls)
}

const handleSave = async () => {
  saving.value = true
  try {
    const res = await updateNews({
      id: Number(route.params.id),
      title: formState.title,
      content: formState.content,
      coverImage: formState.coverImage,
      status: 0,
    })
    if (res.data.code === 0 && res.data.data) {
      message.success('保存成功')
    }
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

const handlePublish = async () => {
  publishing.value = true
  try {
    const res = await updateNews({
      id: Number(route.params.id),
      title: formState.title,
      content: formState.content,
      coverImage: formState.coverImage,
      status: 1,
    })
    if (res.data.code === 0 && res.data.data) {
      message.success('发布成功')
      router.push({
        path: `/news/${Number(route.params.id)}`,
      })
    }
  } catch {
    message.error('发布失败')
  } finally {
    publishing.value = false
  }
}

const fetchNews = async () => {
  if (!route.params.id) {
    return
  }
  const res = await getNewsVo({
    id: Number(route.params.id),
  })
  if (res.data.code === 0 && res.data.data) {
    news.value = res.data.data
    Object.assign(formState, news.value);
    previewImage.value = news.value.coverImage ?? '';
  } else {
    if (route.params.id === null) {
      message.error('获取新闻详情失败: ' + res.data.msg)
    }
  }
}

onMounted(() => {
  if (!route.params.id) {
    return
  }
  fetchNews()
})
</script>

<template>
  <div class="editor-page">
    <!-- Editor Header -->
    <header class="editor-header">
      <div class="editor-header-inner">
        <h1 class="editor-title">{{ pageTitle }}</h1>
        <p class="editor-subtitle">{{ pageSubtitle }}</p>
      </div>
    </header>

    <!-- Editor Body -->
    <div class="editor-body">
      <!-- Title Input -->
      <div class="title-block">
        <input
          v-model="formState.title"
          placeholder="输入文章标题…"
          class="title-input"
        />
        <div class="title-meta-row">
          <a-select
            v-model:value="formState.articleType"
            class="type-select"
            size="small"
          >
            <a-select-option value="original">原创</a-select-option>
            <a-select-option value="reprint">转载</a-select-option>
            <a-select-option value="translation">翻译</a-select-option>
          </a-select>
          <span class="char-count">{{ formState.title.length }} 字</span>
        </div>
      </div>

      <!-- Cover Upload -->
      <div class="cover-block">
        <label class="cover-label">封面图片</label>
        <div class="cover-upload-area">
          <a-upload
            v-model:file-list="fileList"
            list-type="picture-card"
            :before-upload="beforeUpload"
            :custom-request="handleUpload"
            accept="image/jpeg,image/png"
            :max-count="1"
            class="cover-uploader"
          >
            <div v-if="!previewImage" class="upload-placeholder">
              <plus-outlined class="upload-icon" />
              <span class="upload-text">上传封面</span>
              <span class="upload-hint">JPG / PNG，5MB 以内</span>
            </div>
            <div v-else class="cover-preview">
              <a-image
                :src="previewImage"
                :preview="false"
                class="cover-thumb"
              />
            </div>
          </a-upload>
          <div v-if="previewImage" class="cover-actions">
            <button class="cover-action-btn" @click="handlePreview">
              <eye-outlined /> 预览
            </button>
            <button class="cover-action-btn danger" @click="clearImage">
              <delete-outlined /> 移除
            </button>
          </div>
        </div>
      </div>

      <!-- Editor Tabs -->
      <div class="editor-block">
        <a-tabs v-model:activeKey="activeTab" class="editor-tabs">
          <a-tab-pane key="edit" tab="撰写">
            <MdEditor
              v-model="formState.content"
              :theme="theme"
              @onUploadImg="handleUploadImg"
            />
          </a-tab-pane>
          <a-tab-pane key="preview" tab="预览">
            <div class="markdown-preview" v-html="previewHtml"></div>
          </a-tab-pane>
        </a-tabs>
      </div>

      <!-- Action Bar -->
      <div class="action-bar">
        <a-popconfirm title="确定取消？未保存的内容将丢失">
          <template #icon><question-circle-outlined style="color: var(--claude-error)" /></template>
          <button class="btn btn-ghost" @click="handleCancel">取消</button>
        </a-popconfirm>
        <div class="action-bar-right">
          <button class="btn btn-secondary" @click="handleSave" :disabled="saving">
            {{ saving ? '保存中…' : '保存草稿' }}
          </button>
          <button class="btn btn-primary" @click="handlePublish" :disabled="publishing">
            {{ publishing ? '发布中…' : '发布' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Image Preview Modal -->
    <a-modal :open="previewVisible" :footer="null" @cancel="previewVisible = false">
      <img :src="previewImage" alt="新闻封面" style="width: 100%; border-radius: 8px" />
    </a-modal>
  </div>
</template>

<style scoped>
.editor-page {
  min-height: 100vh;
  background: var(--claude-bg-page);
}

/* ─── Header ─── */
.editor-header {
  background: var(--claude-bg-card);
  border-bottom: 1px solid var(--claude-border-cream);
  padding: 2rem 1.5rem;
}

.editor-header-inner {
  max-width: 960px;
  margin: 0 auto;
}

.editor-title {
  font-family: var(--claude-font-serif);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--claude-text-primary);
  margin: 0 0 0.25rem;
}

.editor-subtitle {
  font-size: 0.9rem;
  color: var(--claude-text-tertiary);
  margin: 0;
}

/* ─── Body ─── */
.editor-body {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

/* ─── Title Block ─── */
.title-block {
  margin-bottom: 1.5rem;
}

.title-input {
  width: 100%;
  font-family: var(--claude-font-serif);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  background: var(--claude-bg-card);
  border: none;
  border-bottom: 2px solid var(--claude-border-cream);
  padding: 0.75rem 0;
  outline: none;
  transition: border-color var(--claude-transition-fast);
}

.title-input::placeholder {
  color: var(--claude-text-tertiary);
  font-weight: 400;
}

.title-input:focus {
  border-bottom-color: var(--claude-brand);
}

.title-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.75rem;
}

.type-select {
  width: 100px;
}

.char-count {
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
}

/* ─── Cover Block ─── */
.cover-block {
  margin-bottom: 2rem;
}

.cover-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--claude-text-tertiary);
  margin-bottom: 0.75rem;
}

.cover-upload-area {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.cover-uploader {
  width: 220px !important;
  height: 140px !important;
}

.cover-uploader :deep(.ant-upload) {
  width: 220px !important;
  height: 140px !important;
  border: 2px dashed var(--claude-border-warm) !important;
  border-radius: var(--claude-radius-lg) !important;
  background: var(--claude-bg-card) !important;
  transition: border-color var(--claude-transition-fast);
}

.cover-uploader:hover :deep(.ant-upload) {
  border-color: var(--claude-brand) !important;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.upload-icon {
  font-size: 1.25rem;
  color: var(--claude-text-tertiary);
}

.upload-text {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--claude-text-secondary);
}

.upload-hint {
  font-size: 0.7rem;
  color: var(--claude-text-tertiary);
}

.cover-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cover-thumb {
  max-width: 100%;
  max-height: 130px;
  object-fit: cover;
  border-radius: var(--claude-radius-md);
}

.cover-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.5rem;
}

.cover-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  font-size: 0.8rem;
  color: var(--claude-text-secondary);
  cursor: pointer;
  padding: 0.25rem 0;
  transition: color var(--claude-transition-fast);
}

.cover-action-btn:hover {
  color: var(--claude-brand);
}

.cover-action-btn.danger:hover {
  color: var(--claude-error);
}

/* ─── Editor Block ─── */
.editor-block {
  margin-bottom: 2rem;
}

.editor-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 0;
}

.markdown-preview {
  padding: 1.5rem;
  background: var(--claude-bg-card);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-md);
  min-height: 500px;
  line-height: 1.8;
}

/* ─── Action Bar ─── */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1.5rem;
  border-top: 1px solid var(--claude-border-cream);
}

.action-bar-right {
  display: flex;
  gap: 0.75rem;
}

/* Custom Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1.25rem;
  border-radius: var(--claude-radius-md);
  cursor: pointer;
  transition:
    background var(--claude-transition-fast),
    color var(--claude-transition-fast),
    box-shadow var(--claude-transition-fast);
  border: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-ghost {
  background: transparent;
  color: var(--claude-text-secondary);
  border: 1px solid var(--claude-border-warm);
}

.btn-ghost:hover:not(:disabled) {
  color: var(--claude-text-primary);
  border-color: var(--claude-ring-deep);
}

.btn-secondary {
  background: var(--claude-bg-card);
  color: var(--claude-text-primary);
  border: 1px solid var(--claude-border-warm);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-hover);
  box-shadow: var(--claude-shadow-sm);
}

.btn-primary {
  background: var(--claude-brand);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--claude-brand-dark);
  box-shadow: var(--claude-shadow-md);
}

/* ─── Responsive ─── */
@media (max-width: 768px) {
  .editor-body {
    padding: 1.25rem 1rem 3rem;
  }

  .title-input {
    font-size: 1.25rem;
  }

  .cover-upload-area {
    flex-direction: column;
  }

  .cover-actions {
    flex-direction: row;
  }

  .action-bar {
    flex-direction: column;
    gap: 1rem;
  }

  .action-bar-right {
    width: 100%;
    justify-content: stretch;
  }

  .action-bar-right .btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
