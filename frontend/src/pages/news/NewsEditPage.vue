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





// 表单数据 -- 类型接口
interface FormState {
  title: string
  articleType: 'original' | 'reprint' | 'translation'
  content: string
  coverImage?: string
}
//表单响应式数据
const formState = reactive<FormState>({
  title: '',
  articleType: 'original',
  content: '',
})
const news = ref<API.NewsVO | null>(null)
// 编辑器相关
const activeTab = ref<'edit' | 'preview'>('edit')//tab类型
const theme = ref<'light' | 'dark'>('light')//主题
const previewHtml = computed(() => marked(formState.content))//自动html化

// 图片上传相关
const fileList = ref<any[]>([])//图片url数组
const previewVisible = ref(false)//是否预览
const previewImage = ref('')

// 加载状态
const saving = ref(false)
const publishing = ref(false)







//之前的

const pageTitle = computed(()=>{
  return route.params.id ? '编辑新闻' : '发布新闻'
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

const handleUpload = async ({file}: {file: File})=> {
  const id = Number(route.params.id)
  const res = await uploadCoverImage({ newsUploadDTO: { id } },{},file)
  if (res.data.data && res.data.code === 0) {
    message.success("封面图片上传成功")
    previewImage.value = res.data.data
  }else{
    message.error("封面图片上传失败")
  }
  saving.value = false
}


  const handlePreview = () => {
    previewVisible.value = true
  }
//

const handleCancel = () => {
  //TODO
  previewVisible.value = false
}
//文中的 图片上传逻辑
// 图片上传到服务器 (需根据实际API修改)
const handleUploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  const urls: string[] = []
  // 这里应该是上传到服务器的逻辑
  for (const file of files) {
    console.log(file)
    const res = await uploadAttachment({},file)
    if(res.data.data && res.data.code === 0 ){
      // urls.push(URL.createObjectURL(file))
      urls.push(res.data.data)
    }

    // 模拟上传
    // await new Promise((resolve) => setTimeout(resolve, 1000))
    // urls.push(URL.createObjectURL(file))
  }
  callback(urls)
}

// 操作处理
const handleSave = async () => {
  saving.value = true
  try {
    // 这里调用保存API
     const res =await updateNews({
      id: Number(route.params.id),
      title: formState.title,
      content: formState.content,
      coverImage:formState.coverImage,
       status: 0,
    })
    if(res.data.code ===0 && res.data.data){
      message.success('保存成功')
    }
  } catch (error) {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

const handlePublish = async () => {
  publishing.value = true
  try {
    // 这里调用发布API
    const res =await updateNews({
      id: Number(route.params.id),
      title: formState.title,
      content: formState.content,
      coverImage:formState.coverImage,
      status: 1,//状态
    })
    if(res.data.code ===0 && res.data.data){
      message.success('发布成功')
      router.push({
        path:`/news/${Number(route.params.id)}`,
      })
    }
  } catch (error) {
    message.error('发布失败')
  } finally {
    publishing.value = false
  }
}


//如果是编辑页面，则获取数据

const fetchNews = async () => {
  if (!route.params.id) {
    return
  }
  const res = await getNewsVo({
    id: Number(route.params.id),
  })
  if (res.data.code === 0 && res.data.data) {
    news.value = res.data.data
    console.log(res.data.data)
    //复制
    Object.assign(formState, news.value);
    console.log()
    previewImage.value = news.value.coverImage ?? '';
  } else {
    if (route.params.id===null) {
      message.error('获取新闻详情失败: ' + res.data.msg)
    }
  }
}

onMounted(()=>{
  if (!route.params.id) {
    return
  }
  fetchNews()
})
</script>

<template>
  <!--新闻编辑  -->
  <div class="news-edit-container">
    <a-card :title="pageTitle" :bordered="false">
      <!-- 标题和类型 -->
      <div class="title-section">
        <a-input
          v-model:value="formState.title"
          placeholder="请输入新闻标题"
          class="title-input"
          size="large"
        />
        <a-select
          v-model:value="formState.articleType"
          style="width: 120px; margin-left: 16px"
          size="large"
        >
          <a-select-option value="original">原创</a-select-option>
          <a-select-option value="reprint">转载</a-select-option>
          <a-select-option value="translation">翻译</a-select-option>
        </a-select>
      </div>

      <!-- MD编辑器 容器 -->
      <div class="editor-section">
        <a-tabs v-model:activeKey="activeTab">
          <a-tab-pane key="edit" tab="编辑">
            <MdEditor v-model="formState.content" :theme="theme" @onUploadImg="handleUploadImg" />
          </a-tab-pane>
          <a-tab-pane key="preview" tab="预览">
            <div class="markdown-preview" v-html="previewHtml"></div>
          </a-tab-pane>
        </a-tabs>
      </div>

      <!-- 封面图上传 -->
      <div class="cover-section">
        <h3 class="section-title">封面图</h3>
        <!--        <a-upload
          v-model:file-list="fileList"
          list-type="picture-card"
          :before-upload="beforeUpload"
          @preview="handlePreview"
          @change="handleChange"
          :max-count="1"
          accept="image/*"
        >
          <div v-if="fileList.length < 1">
            <plus-outlined />
            <div style="margin-top: 8px">上传封面</div>
          </div>
        </a-upload>
        <a-modal :visible="previewVisible" :footer="null" @cancel="previewVisible = false">
          <img alt="预览" style="width: 100%" :src="previewImage" />
        </a-modal>-->
        <div class="image-upload-container">
          <a-upload
            v-model:file-list="fileList"
            list-type="picture-card"
            :before-upload="beforeUpload"
            :custom-request="handleUpload"
            accept="image/jpeg,image/png"
            :max-count="1"
            class="image-uploader"
          >
            <!-- 上传状态 -->
            <div v-if="!previewImage" class="uploader-inner">
              <plus-outlined />
              <div class="upload-text">上传图片</div>
              <div class="upload-hint">支持 JPG/PNG 格式</div>
            </div>
            <!-- 预览状态 -->
            <div v-else class="small-preview">
              <a-image
                :src="previewImage"
                :preview="false"
                width="100px"
                height="100px"
                class="preview-thumbnail"
              />
            </div>
          </a-upload>

          <!-- 操作按钮 -->
          <div v-if="previewImage" class="image-actions">
            <a-button type="link" @click="handlePreview" class="action-btn">
              <eye-outlined /> 预览原图
            </a-button>
            <a-button type="link" @click="clearImage" danger class="action-btn">
              <delete-outlined /> 移除
            </a-button>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <a-popconfirm title="Are you sure？">
          <template #icon><question-circle-outlined style="color: red" /></template>
          <a-button @click="handleCancel">取消</a-button>
        </a-popconfirm>
        <!--        <a-button @click="handleCancel">取消</a-button>-->
        <a-button @click="handleSave" :loading="saving">保存草稿</a-button>
        <a-button type="primary" @click="handlePublish" :loading="publishing"> 发布 </a-button>
      </div>
    </a-card>
    <!-- 图片预览模态框 -->
    <a-modal :open="previewVisible" :footer="null" @cancel="previewVisible = false">
      <img :src="previewImage" alt="新闻封面" style="width: 100%" />
    </a-modal>
  </div>
</template>

<style scoped>
.news-edit-container {
  padding: 24px;
  background: var(--claude-bg-card);
  border-radius: 8px;
}

.title-section {
  display: flex;
  margin-bottom: 24px;
}

.title-input {
  flex: 1;
}

.editor-section {
  margin-bottom: 24px;
}

.markdown-preview {
  padding: 16px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  min-height: 500px;
}

.cover-section {
  margin-bottom: 24px;
}

.section-title {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 500;
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
.image-upload-container {
  width: 300px; /* 固定容器宽度 */
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 上传容器样式 */
.image-uploader {
  width: 300px !important; /* 强制宽度 */
  height: 150px;
  border: 1px dashed #d9d9d9;
  border-radius: 4px;
  background: #fafafa;
  padding: 16px;
  text-align: center;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  transition: border-color 0.3s;
}

.image-uploader:hover {
  border-color: #40a9ff;
}

/* 小预览图样式 */
.small-preview {
  width: 100px;
  height: 100px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid #f0f0f0;
  background: #fff;
}

.preview-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 上传区域文字样式 */
.uploader-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.upload-text {
  margin-top: 8px;
  color: #595959;
  font-weight: 500;
}

.upload-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #8c8c8c;
}

/* 操作按钮样式 */
.image-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 8px;
}

.action-btn {
  padding: 0;
  height: auto;
}
</style>
