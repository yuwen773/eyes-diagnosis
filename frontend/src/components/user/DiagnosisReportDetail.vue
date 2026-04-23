<template>
  <div class="report-detail">
    <div class="report-header">
      <h2>{{ report.result }}诊断报告</h2>
      <div class="report-meta">
        <span><IdcardOutlined />诊断ID: {{ report.id }}</span>
        <span><calendar-outlined /> 诊断日期: {{ formatDate(report.createTime) }}</span>
      </div>
    </div>

    <a-divider />

    <div class="report-content">
      <a-descriptions bordered :column="2" size="middle">
        <a-descriptions-item label="诊断结果">
          <span v-if="!isEditing">{{ report?.result || "无" }}</span>
          <a-input v-else v-model:value="editableData.result" />
        </a-descriptions-item>
        <a-descriptions-item label="置信度">
          <span v-if="!isEditing">{{ report?.confidence > 85 ? report.confidence : 85 }}%</span>
          <a-input-number v-else v-model:value="editableData.confidence" :min="0" :max="100" :formatter="value => `${value}%`" :parser="value => value.replace('%', '')" />
        </a-descriptions-item>
        <a-descriptions-item label="严重程度">
          <span v-if="!isEditing">{{ report.severity || '高' }}</span>
          <a-select v-else v-model:value="editableData.severity" style="width: 100%">
            <a-select-option value="低">低</a-select-option>
            <a-select-option value="中">中</a-select-option>
            <a-select-option value="高">高</a-select-option>
          </a-select>
        </a-descriptions-item>
        <a-descriptions-item label="概率">
          <span v-if="!isEditing">{{ report.probability || 90 }}%</span>
          <a-input-number v-else v-model:value="editableData.probability" :min="0" :max="100" :formatter="value => `${value}%`" :parser="value => value.replace('%', '')" />
        </a-descriptions-item>
      </a-descriptions>

      <div class="report-section">
        <h3><file-text-outlined /> 诊断详情</h3>
        <div class="section-content">
          <MdPreview v-if="!isEditing" :modelValue="report.details" :previewOnly="true" />
          <MdEditor v-else v-model="editableData.details" />
        </div>
      </div>

      <div class="report-section">
        <h3><solution-outlined /> 诊断建议</h3>
        <div class="section-content">
          <MdPreview v-if="!isEditing" :modelValue="report.recommendations" :previewOnly="true" />
          <MdEditor v-else v-model="editableData.recommendations" />
        </div>
      </div>

      <div class="report-section" v-if="report.url">
        <h3><picture-outlined /> 诊断图像</h3>
        <div class="image-gallery">
          <a-image
            :src="report.url"
            :preview="false"
            class="diagnosis-image"
          />
<!--          <a-upload v-if="isEditing" :beforeUpload="handleImageUpload" :showUploadList="false">
            <a-button type="link"><upload-outlined /> 更换图片</a-button>
          </a-upload>-->
        </div>
      </div>
    </div>

    <a-divider />

    <div class="report-footer">
      <div class="footer-left" v-if="isAdmin">
        <a-button
          v-if="!isEditing"
          type="primary"
          @click="enterEditMode"
        >
          <edit-outlined /> 人工诊断
        </a-button>
        <template v-else>
          <a-button type="primary" @click="saveChanges" :loading="saving">
            <save-outlined /> 保存修改
          </a-button>
          <a-button @click="cancelEdit" style="margin-left: 8px">
            <close-outlined /> 取消
          </a-button>
        </template>
      </div>
      <div class="export-actions">
        <span>导出报告：</span>
        <a-button @click="handleExport('pdf')" type="primary" ghost>
          <file-pdf-outlined /> PDF格式
        </a-button>
        <a-button @click="handleExport('csv')" type="primary" ghost>
          <file-excel-outlined /> CSV格式
        </a-button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'
import { exportToCSV, exportToPDF } from '@/utils/exportUtils'
import { MdPreview, MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import {
  IdcardOutlined,
  CalendarOutlined,
  FileTextOutlined,
  SolutionOutlined,
  PictureOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  UploadOutlined
} from '@ant-design/icons-vue'
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useLoginUserStore } from '@/stores/user'
import { useRouter } from 'vue-router'
import { updateDiagnosisResult } from '@/api/diagnosisController'
import { useDiagnosisStore } from '@/stores/diagnosis'

const formatDate = (date: string) => {
  return dayjs(Number(date)).format('YYYY年MM月DD日 HH:mm')
}

//获取当前用户的身份
const loginUserStore = useLoginUserStore()
const currentRole = loginUserStore.loginUser.userRole

const isAdmin = computed(()=>{
  // return currentRole === 'admin' && router.options.history.state.back !==  "/user/userCenter/profile"
  return currentRole === 'admin' && isFromAdminPage()
})
const router = useRouter()
/**
 * 判断是否前一个页面是 '/systemManage/admin' 开头的路由
 */
const isFromAdminPage = () =>{
  // 确保路径存在
  if (router && router.options && router.options.history &&
    router.options.history.state && router.options.history.state.back) {

    const backPath = router.options.history.state.back;
    // 使用startsWith方法检查前缀
    return backPath.startsWith('/systemManage/admin');
  }
  // 如果路径不完整或不存在，返回false
  return false;
}
const props = defineProps({
  report: {
    type: Object as () => API.DiagnosisResultVO,
    required: true
  }
})

const isEditing = ref(false)
const saving = ref(false)
const editableData = reactive<API.DiagnosisResultVO>({
  id: 0,
  createTime: '',
  result: '',
  confidence: 0,
  severity: '',
  probability: 0,
  details: '',
  recommendations: '',
  url: ''
})

const enterEditMode = () => {
  Object.assign(editableData, props.report)
  isEditing.value = true
}

const cancelEdit = () => {
  isEditing.value = false
}
const diagnosisStore = useDiagnosisStore();
const saveChanges = async () => {
  saving.value = true
  try {
    // 这里应该是调用API保存修改的逻辑
    await new Promise(resolve => setTimeout(resolve, 1000)) // 模拟API调用
    const res = await updateDiagnosisResult({
      ...editableData,
    })
    if(res.data.code===0&&res.data.data){
      message.success('修改保存成功')
      isEditing.value = false
    }
    // 实际项目中这里应该触发更新父组件数据的逻辑
    //重新获取新数据
    await diagnosisStore.openReportModal(editableData)
  } catch (error) {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

/*const handleImageUpload = (file: File) => {
  // 这里应该是上传图片的逻辑
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      editableData.url = e.target?.result as string
      resolve(false) // 返回false阻止默认上传行为
    }
    reader.readAsDataURL(file)
  })
}*/

const handleExport = (type: 'pdf' | 'csv') => {
  if (type === 'pdf') {
    exportToPDF(props.report)
  } else {
    exportToCSV(props.report)
  }
}
</script>

<style scoped>
.report-detail {
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.report-header {
  text-align: center;
  margin-bottom: 24px;
}

.report-header h2 {
  margin-bottom: 12px;
  color: #1a3a5f;
  font-size: 24px;
  font-weight: 600;
}

.report-meta {
  display: flex;
  justify-content: center;
  gap: 32px;
  color: #666;
  font-size: 14px;
}

.report-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.report-content {
  margin: 24px 0;
}

.report-section {
  margin: 32px 0;
}

.report-section h3 {
  margin-bottom: 16px;
  color: #1a3a5f;
  font-size: 18px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-content {
  padding: 16px;
  background: #f9f9f9;
  border-radius: 6px;
  line-height: 1.8;
  border-left: 4px solid #1a3a5f;
}

.image-gallery {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
}

.diagnosis-image {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
}

.report-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-left {
  flex: 1;
}

.export-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
  color: #595959;
}

:deep(.md-editor-preview-wrapper) {
  padding: 0;
}

@media (max-width: 768px) {
  .report-detail {
    padding: 16px;
  }

  .report-meta {
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .report-footer {
    flex-direction: column;
    gap: 16px;
    align-items: flex-start;
  }

  .footer-left {
    order: 1;
    width: 100%;
  }

  .export-actions {
    order: 2;
    width: 100%;
    justify-content: flex-end;
  }
}
</style>

<style>
/* 全局Markdown样式 */
.markdown-body {
  font-size: 15px;
  line-height: 1.7;
}

.markdown-body img {
  display: block;
  margin: 16px auto;
  max-width: 100%;
  border-radius: 4px;
}
</style>
