<template>
  <div class="report-detail">
    <!-- 诊断结论 Hero -->
    <div class="report-hero" :class="`severity-${severityLevel}`">
      <div class="hero-content">
        <div class="severity-badge">
          <component :is="severityIcon" class="severity-icon" />
          <span>{{ severityLabel }}</span>
        </div>
        <h1 class="hero-conclusion">{{ report.result || '诊断中...' }}</h1>
        <p class="hero-subtitle">{{ severitySubtitle }}</p>
      </div>
    </div>

    <div class="report-body">
      <!-- AI 分析 -->
      <section v-if="report.details" class="report-section ai-analysis">
        <button class="section-header" @click="aiExpanded = !aiExpanded">
          <span class="section-title">
            <FileTextOutlined />
            AI 诊断分析
          </span>
          <component :is="aiExpanded ? CaretUpOutlined : CaretDownOutlined" class="section-toggle" />
        </button>
        <Transition name="expand">
          <div v-if="aiExpanded" class="section-content">
            <MdPreview :modelValue="report.details" :previewOnly="true" />
          </div>
        </Transition>
      </section>

      <!-- 诊断建议 -->
      <section v-if="report.recommendations" class="report-section recommendations">
        <h2 class="section-title">
          <SolutionOutlined />
          诊断建议
        </h2>
        <div class="section-content">
          <MdPreview :modelValue="report.recommendations" :previewOnly="true" />
        </div>
      </section>

      <!-- 详细指标 -->
      <section class="report-section metrics">
        <h2 class="section-title">
          <BarChartOutlined />
          详细指标
        </h2>
        <div class="metrics-grid">
          <div class="metric-card" v-if="report.confidence !== undefined">
            <div class="metric-header">
              <span class="metric-label">置信度</span>
              <a-tooltip title="系统对这个诊断结果的确信程度，越高表示 AI 越肯定">
                <QuestionCircleOutlined class="metric-help" />
              </a-tooltip>
            </div>
            <div class="metric-value confidence-value">
              {{ displayConfidence }}%
            </div>
            <div class="metric-explanation">
              {{ confidenceExplanation }}
            </div>
            <div class="metric-bar">
              <div class="metric-bar-fill" :style="{ transform: `scaleX(${Number(displayConfidence) / 100})` }"></div>
            </div>
          </div>

          <div class="metric-card" v-if="report.probability !== undefined">
            <div class="metric-header">
              <span class="metric-label">疾病概率</span>
              <a-tooltip title="该疾病在眼底影像中出现的可能性">
                <QuestionCircleOutlined class="metric-help" />
              </a-tooltip>
            </div>
            <div class="metric-value">
              {{ report.probability }}%
            </div>
            <div class="metric-explanation">
              系统检测到该疾病的置信水平
            </div>
          </div>

          <div class="metric-card" v-if="report.chunkCount !== undefined">
            <div class="metric-header">
              <span class="metric-label">分析分块数</span>
              <a-tooltip title="眼底影像被分割成小块进行分析的区块数量">
                <QuestionCircleOutlined class="metric-help" />
              </a-tooltip>
            </div>
            <div class="metric-value">
              {{ report.chunkCount }}
            </div>
            <div class="metric-explanation">
              影像分区分析，区块越多分析越细致
            </div>
          </div>
        </div>
      </section>

      <!-- 诊断图像 -->
      <section v-if="report.url" class="report-section diagnosis-image-section">
        <h2 class="section-title">
          <PictureOutlined />
          眼底影像
        </h2>
        <div class="image-wrapper">
          <a-image
            :src="report.url"
            :preview="{ src: report.url }"
            class="diagnosis-image"
          />
        </div>
      </section>
    </div>

    <!-- 页脚 -->
    <div class="report-footer">
      <div class="footer-meta">
        <span><IdcardOutlined /> 诊断ID: {{ report.id }}</span>
        <span><CalendarOutlined /> {{ formatDate(report.createTime) }}</span>
      </div>
      <div class="footer-actions">
        <div class="export-actions">
          <span class="export-label">导出报告：</span>
          <a-button size="small" @click="handleExport('pdf')">
            <FilePdfOutlined /> PDF
          </a-button>
          <a-button size="small" @click="handleExport('csv')">
            <FileExcelOutlined /> CSV
          </a-button>
        </div>
        <div v-if="isAdmin && !isEditing" class="admin-actions">
          <a-button type="primary" @click="enterEditMode">
            <EditOutlined /> 人工诊断
          </a-button>
        </div>
        <template v-else-if="isEditing">
          <a-button type="primary" @click="saveChanges" :loading="saving">
            <SaveOutlined /> 保存修改
          </a-button>
          <a-button @click="cancelEdit">
            <CloseOutlined /> 取消
          </a-button>
        </template>
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
  CaretDownOutlined,
  CaretUpOutlined,
  QuestionCircleOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons-vue'
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useLoginUserStore } from '@/stores/user'
import { useRouter } from 'vue-router'
import { updateDiagnosisResult } from '@/api/diagnosisController'
import { useDiagnosisStore } from '@/stores/diagnosis'

const formatDate = (date?: string) => {
  return dayjs(Number(date)).format('YYYY年MM月DD日 HH:mm')
}

const loginUserStore = useLoginUserStore()
const router = useRouter()
const diagnosisStore = useDiagnosisStore()
const currentRole = loginUserStore.loginUser.userRole

const isAdmin = computed(() => {
  return currentRole === 'admin' && isFromAdminPage()
})

const isFromAdminPage = () => {
  const state = router.options.history.state
  return state?.back ? String(state.back).startsWith('/systemManage/admin') : false
}

const props = defineProps({
  report: {
    type: Object as () => API.DiagnosisResultVO,
    default: undefined
  }
})

const isEditing = ref(false)
const saving = ref(false)
const aiExpanded = ref(true)
const editableData = reactive<API.DiagnosisResultVO>({
  id: 0, createTime: '', result: '', confidence: 0,
  severity: '', probability: 0, details: '', recommendations: '', url: ''
})

// 严重程度：0=低(green), 1=中(brand), 2=高(deep terracotta)
const severityLevel = computed(() => {
  const map: Record<string, string> = { '低': 'low', '中': 'medium', '高': 'high' }
  return map[props.report?.severity ?? ''] ?? 'medium'
})

const severityLabel = computed(() => {
  return props.report?.severity ? `${props.report.severity}风险` : '中等风险'
})

const severitySubtitle = computed(() => {
  const map: Record<string, string> = {
    '低': '您的眼底影像未发现明显异常，建议定期复查。',
    '中': '检测到一定异常，建议关注并咨询眼科医生。',
    '高': '发现需要关注的异常，建议尽快就医进行详细检查。',
  }
  return map[props.report?.severity ?? ''] ?? map['中']
})

const severityIcon = computed(() => {
  const map: Record<string, any> = {
    '低': CheckCircleOutlined,
    '中': ExclamationCircleOutlined,
    '高': WarningOutlined,
  }
  return map[props.report?.severity ?? ''] ?? ExclamationCircleOutlined
})

// 置信度：不要 fake 85%，如实显示 null/undefined
const displayConfidence = computed(() => {
  const c = props.report?.confidence
  return c !== undefined && c !== null ? c : '—'
})

const confidenceExplanation = computed(() => {
  const c = props.report?.confidence
  if (c === undefined || c === null) return '暂无置信度数据'
  if (c >= 90) return '非常肯定，诊断结果高度可靠'
  if (c >= 75) return '比较肯定，诊断结果可信'
  if (c >= 60) return '中等肯定，建议结合临床判断'
  return '确定性较低，建议进一步检查确认'
})

const enterEditMode = () => {
  Object.assign(editableData, props.report)
  isEditing.value = true
}

const cancelEdit = () => {
  isEditing.value = false
}

const saveChanges = async () => {
  saving.value = true
  try {
    const res = await updateDiagnosisResult({ ...editableData })
    if (res.data?.code === 0 && res.data?.data) {
      message.success('修改保存成功')
      isEditing.value = false
      await diagnosisStore.openReportModal(editableData)
    } else {
      message.error(res.data?.msg || '保存失败')
    }
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

const handleExport = (type: 'pdf' | 'csv') => {
  if (!props.report) return
  if (type === 'pdf') exportToPDF(props.report)
  else exportToCSV(props.report)
}
</script>

<style scoped>
.report-detail {
  background: var(--claude-bg-elevated);
  border-radius: var(--claude-radius-lg);
  overflow: hidden;
  box-shadow: var(--claude-shadow-md);
}

/* === Hero Section === */
.report-hero {
  padding: var(--claude-space-7) var(--claude-space-6) var(--claude-space-6);
  text-align: center;
  position: relative;
}

.report-hero::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
}

.severity-low {
  background: linear-gradient(180deg, var(--severity-low-bg) 0%, var(--claude-bg-elevated) 100%);
}
.severity-low::after { background: var(--severity-low-color); }

.severity-medium {
  background: linear-gradient(180deg, var(--severity-medium-bg) 0%, var(--claude-bg-elevated) 100%);
}
.severity-medium::after { background: var(--claude-brand); }

.severity-high {
  background: linear-gradient(180deg, var(--severity-high-bg) 0%, var(--claude-bg-elevated) 100%);
}
.severity-high::after { background: var(--claude-brand-dark); }

.hero-content {
  position: relative;
  z-index: 1;
}

.severity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: var(--claude-space-3);
}

.severity-low .severity-badge { background: var(--severity-low-badge-bg); color: var(--severity-low-badge-color); }
.severity-medium .severity-badge { background: var(--severity-medium-badge-bg); color: var(--severity-medium-badge-color); }
.severity-high .severity-badge { background: var(--severity-high-badge-bg); color: var(--severity-high-badge-color); }

.severity-icon { font-size: 15px; }

.hero-conclusion {
  font-family: var(--claude-font-serif);
  font-size: clamp(1.3rem, 3vw, 1.8rem);
  font-weight: 600;
  color: var(--claude-text-primary);
  margin-bottom: var(--claude-space-2);
  line-height: 1.3;
}

.hero-subtitle {
  font-size: 0.9rem;
  color: var(--claude-text-secondary);
  margin: 0;
  max-width: 480px;
  margin-inline: auto;
  line-height: 1.6;
}

/* === Body === */
.report-body {
  padding: 0 var(--claude-space-6) var(--claude-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-4);
}

/* === Sections === */
.report-section {
  border-radius: var(--claude-radius-md);
  overflow: hidden;
}

.ai-analysis {
  background: var(--claude-bg-page);
  border: 1px solid var(--claude-border-cream);
}

.section-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--claude-space-4) var(--claude-space-5);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--claude-transition-fast);
}

.section-header:hover {
  background: var(--claude-bg-hover);
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0;
}

.section-toggle {
  color: var(--claude-text-tertiary);
  font-size: 12px;
  transition: transform var(--claude-transition-fast);
}

.section-content {
  padding: 0 var(--claude-space-5) var(--claude-space-4);
  border-top: 1px solid var(--claude-border-cream);
}

.recommendations .section-title {
  padding: var(--claude-space-4) var(--claude-space-5);
  background: var(--claude-bg-card);
  border-bottom: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-md) var(--claude-radius-md) 0 0;
}

.recommendations .section-content {
  padding: var(--claude-space-4) var(--claude-space-5);
  background: var(--severity-medium-bg);
  border-radius: 0 0 var(--claude-radius-md) var(--claude-radius-md);
  border: 1px solid var(--claude-border-cream);
  border-top: none;
}

.metrics .section-title {
  margin-bottom: var(--claude-space-3);
  font-size: 0.95rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--claude-space-3);
}

.metric-card {
  background: var(--claude-bg-card);
  border: 1px solid var(--claude-border-cream);
  border-radius: var(--claude-radius-md);
  padding: var(--claude-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-1);
}

.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--claude-text-secondary);
}

.metric-help {
  font-size: 12px;
  color: var(--claude-text-tertiary);
  cursor: help;
}

.metric-value {
  font-family: var(--claude-font-serif);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--claude-text-primary);
  line-height: 1.2;
}

.confidence-value {
  color: var(--claude-brand);
}

.metric-explanation {
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
  line-height: 1.5;
}

.metric-bar {
  height: 4px;
  background: var(--claude-border-cream);
  border-radius: 2px;
  margin-top: var(--claude-space-2);
  overflow: hidden;
}

.metric-bar-fill {
  height: 100%;
  background: var(--claude-brand);
  border-radius: 2px;
  transform-origin: left center;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

/* === Image === */
.diagnosis-image-section .section-title {
  margin-bottom: var(--claude-space-3);
}

.image-wrapper {
  border-radius: var(--claude-radius-md);
  overflow: hidden;
  border: 1px solid var(--claude-border-cream);
}

.diagnosis-image {
  display: block;
  width: 100%;
  max-height: 360px;
  object-fit: contain;
  background: var(--claude-bg-page);
}

/* === Footer === */
.report-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--claude-space-4) var(--claude-space-6);
  border-top: 1px solid var(--claude-border-cream);
  background: var(--claude-bg-card);
  flex-wrap: wrap;
  gap: var(--claude-space-3);
}

.footer-meta {
  display: flex;
  align-items: center;
  gap: var(--claude-space-5);
  font-size: 0.8rem;
  color: var(--claude-text-tertiary);
}

.footer-meta span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--claude-space-3);
}

.export-actions {
  display: flex;
  align-items: center;
  gap: var(--claude-space-2);
}

.export-label {
  font-size: 0.8rem;
  color: var(--claude-text-secondary);
}

/* === Expand Transition === */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* === Markdown === */
:deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.markdown-body {
  font-size: 15px;
  line-height: 1.8;
}

/* === Responsive === */
@media (max-width: 768px) {
  .report-body {
    padding-inline: var(--claude-space-4);
  }

  .metrics-grid {
    grid-template-columns: 1fr 1fr;
  }

  .report-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
