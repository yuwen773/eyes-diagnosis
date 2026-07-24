<template>
  <div class="diagnosis-container" role="region" aria-label="诊断结果">
    <!-- 屏幕阅读器公告 -->
    <div class="sr-only" aria-live="polite" aria-atomic="true">
      {{ screenReaderSummary }}
    </div>

    <!-- 加载状态 -->
    <template v-if="!diagnosisResult">
      <!-- 顶部诊断结果骨架 -->
      <a-card class="top-section">
        <a-row :gutter="24">
          <a-col :span="10" class="image-col">
            <a-skeleton-image class="skeleton-image" active />
          </a-col>
          <a-col :span="14">
            <a-skeleton active :paragraph="{ rows: 6 }" />
          </a-col>
        </a-row>
      </a-card>

      <!-- 中间部分骨架 -->
      <a-card class="middle-section">
        <a-row :gutter="24">
          <a-col :span="12">
            <a-skeleton active :paragraph="{ rows: 5 }" />
          </a-col>
          <a-col :span="12">
            <a-skeleton active :paragraph="{ rows: 5 }" />
          </a-col>
        </a-row>
      </a-card>

      <!-- 底部可靠性骨架 -->
      <a-card class="bottom-section">
        <a-skeleton active :paragraph="{ rows: 1 }" />
      </a-card>
    </template>

    <template v-else>
      <!-- 操作按钮栏 -->
      <div v-if="!isRejected" class="action-bar">
        <a-space>
          <a-button type="primary" ghost @click="handleExportPDF">
            <template #icon><FilePdfOutlined /></template>
            导出 PDF 报告
          </a-button>
          <a-button @click="handleExportCSV">
            <template #icon><FileTextOutlined /></template>
            导出 CSV 数据
          </a-button>
        </a-space>
      </div>

      <!-- 医疗可靠性提示（拒识 / 需复审 / 模型元数据） -->
      <AbstainNotice
        :rejected="isRejected"
        :reason="diagnosisResult?.abstainReason ?? ''"
      />
      <div class="medical-meta">
        <HumanReviewBadge :status="diagnosisResult?.humanReviewStatus ?? 'PENDING_AI'" />
        <ModelProvenance
          :modelVersion="diagnosisResult?.modelVersion"
          :weightSha256="diagnosisResult?.weightSha256"
        />
      </div>

      <a-alert
        v-if="requiresReview && !isRejected"
        type="warning"
        show-icon
        message="AI 初步分析待人工复核"
        description="该结果不能替代专业医生的诊断；请结合临床检查并等待人工复核。"
      />

      <!-- 顶部诊断结果 -->
      <template v-if="!isRejected">
      <a-card class="top-section">
        <a-row :gutter="24">
          <a-col :span="10" class="image-col">
            <div class="image-container">
              <a-image
                class="diagnosis-image"
                :src="diagnosisResult?.url"
                :preview="false"
              />
            </div>
          </a-col>
          <a-col :span="14">
            <div class="main-diagnosis">
              <div class="diagnosis-header">
                <CheckCircleOutlined class="header-icon" />
                <h2 class="diagnosis-title">{{ diagnosisResult?.result }}</h2>
                <a-tag :color="getSeverityColor(diagnosisResult?.severity || 'NOT_ASSESSED')" class="severity-tag">
                  {{ formatSeverity(diagnosisResult?.severity || 'NOT_ASSESSED') }}
                </a-tag>
              </div>

              <div class="confidence-section">
                <span class="confidence-label">置信度</span>
                <a-progress
                  :percent="diagnosisResult?.confidence"
                  :stroke-color="getProbabilityColor(diagnosisResult?.confidence ?? 0)"
                  :format="(percent: number) => `${percent}%`"
                  class="confidence-bar"
                />
              </div>

              <div class="info-section">
                <h3 class="section-title">
                  <InfoCircleOutlined />
                  疾病信息
                </h3>
                <p class="section-content">{{ diagnosisResult?.details }}</p>
              </div>

              <div class="treatment-section">
                <h3 class="section-title">
                  <MedicineBoxOutlined />
                  治疗建议
                </h3>
                <div class="recommendation-list">
                  <div
                    class="recommendation-item"
                    v-for="(rec, index) in recommendations"
                    :key="index"
                  >
                    <div class="recommendation-number">{{ index + 1 }}</div>
                    <div class="recommendation-text">{{ rec }}</div>
                  </div>
                </div>
              </div>
            </div>
          </a-col>
        </a-row>
      </a-card>

      <!-- 中间部分 - 所有诊断结果 -->
      <a-card class="middle-section">
        <a-row :gutter="24">
          <a-col :span="12">
            <div class="other-diagnoses">
              <h3 class="section-title">
                <OrderedListOutlined />
                所有可能诊断
              </h3>
              <div class="vertical-bars">
                <div v-for="(disease, index) in allDiagnoses" :key="index" class="bar-container">
                  <span class="disease-name">
                    {{ disease.name }}
                    <span v-if="disease.isMain" class="main-diagnosis-badge">主诊断</span>
                  </span>
                  <a-progress
                    type="line"
                    :percent="disease.probability"
                    :stroke-color="getProbabilityColor(disease.probability ?? 0)"
                    :show-info="false"
                    class="vertical-progress"
                  />
                  <span class="probability-value">{{ Math.round(disease.probability ?? 0) }}%</span>
                </div>
                <div v-if="allDiagnoses.length === 0" class="no-data-message">
                  暂无其他诊断数据
                </div>
              </div>
            </div>
          </a-col>
          <a-col :span="12">
            <div class="probability-chart">
              <h3 class="section-title">
                <PieChartOutlined />
                概率分布
              </h3>
              <PieChart v-if="chartData.length > 0" :data="chartData" />
              <div v-else class="no-data-message">暂无数据</div>
            </div>
          </a-col>
        </a-row>
      </a-card>

      <!-- 医疗免责声明 -->
      <a-card class="disclaimer-section">
        <div class="disclaimer-content">
          <ExclamationCircleOutlined class="disclaimer-icon" />
          <div class="disclaimer-text">
            <p class="disclaimer-title">医疗免责声明</p>
            <p class="disclaimer-body">本诊断结果由 AI 辅助分析，仅供参考，不能替代专业医生的诊断意见。如有眼部不适，请尽快前往医院眼科就诊，由专业医生进行详细检查和治疗。</p>
          </div>
        </div>
        <div class="doctor-consult">
          <span class="consult-text">如有疑问，建议咨询专业眼科医生</span>
        </div>
      </a-card>

      <!-- 底部可靠性 -->
      <a-card class="bottom-section">
        <div class="reliability">
    <span class="reliability-label">
      <SafetyCertificateOutlined />
      诊断可靠性:
    </span>
          <a-tag :color="getReliabilityColor(reliability)" class="reliability-tag">
            {{ reliability }}
          </a-tag>

          <!-- 可靠性提示文字 -->
          <div class="reliability-message" :style="getReliabilityMessageStyle(reliability)">
            {{ getReliabilityMessage(reliability) }}
          </div>
        </div>
      </a-card>
      </template>

      <a-card v-else class="rejected-result">
        <a-result
          status="warning"
          title="本次图像未形成可展示的 AI 诊断结论"
          :sub-title="rejectionMessage"
        >
          <template #extra>
            <a-button type="primary" @click="diagnosisStore.clearDiagnosisResult">重新上传图片</a-button>
          </template>
        </a-result>
      </a-card>

      <!-- 医疗免责声明：必须在结果页最底部常驻 -->
      <MedicalDisclaimer
        scope="ai"
        :modelVersion="diagnosisResult?.modelVersion"
        :weightSha256="diagnosisResult?.weightSha256"
      />
    </template>

  </div>
</template>
<script lang="ts" setup>
import { computed } from 'vue'
import {
  CheckCircleOutlined,
  InfoCircleOutlined,
  MedicineBoxOutlined,
  OrderedListOutlined,
  PieChartOutlined,
  SafetyCertificateOutlined,
  ExclamationCircleOutlined,
  FilePdfOutlined,
  FileTextOutlined
} from '@ant-design/icons-vue';
import PieChart from '@/components/tables/DiagnosisPie.vue';
import { useDiagnosisStore } from '@/stores/diagnosis'
import { storeToRefs } from 'pinia'
import { exportToPDF, exportToCSV } from '@/utils/exportUtils'
import AbstainNotice from '@/components/medical/AbstainNotice.vue'
import HumanReviewBadge from '@/components/medical/HumanReviewBadge.vue'
import ModelProvenance from '@/components/medical/ModelProvenance.vue'
import MedicalDisclaimer from '@/components/medical/MedicalDisclaimer.vue'

const diagnosisStore = useDiagnosisStore();
const { diagnosisResult } = storeToRefs(diagnosisStore)

const isRejected = computed(() => Boolean(diagnosisResult.value?.aiRejected))
const requiresReview = computed(() => Boolean(diagnosisResult.value?.requiresReview))
const rejectionMessage = computed(() => diagnosisResult.value?.abstainReason
  ? `拒识原因：${diagnosisResult.value.abstainReason}。请重新上传清晰图片或申请人工复核。`
  : '请重新上传清晰图片或申请人工复核。')

const handleExportPDF = () => {
  if (diagnosisResult.value && !isRejected.value) {
    exportToPDF(diagnosisResult.value)
  }
}

const handleExportCSV = () => {
  if (diagnosisResult.value && !isRejected.value) {
    exportToCSV(diagnosisResult.value)
  }
}

const recommendations = computed(() => {
  const recs = diagnosisResult?.value?.recommendations
  if (!recs) return []
  if (typeof recs === 'string') {
    return recs.split('\n').filter(r => r.trim())
  }
  return []
})

// 可靠性由后端经校准后的分数及复核状态决定，前端不再硬编码医疗结论。
const reliability = computed(() => {
  if (isRejected.value) return '拒识'
  if (requiresReview.value) return '待复核'
  const confidence = diagnosisResult.value?.confidence ?? 0
  if (confidence >= 85) return '较高'
  if (confidence >= 70) return '一般'
  return '较低'
})

// 获取所有诊断结果（包含主诊断）
const allDiagnoses = computed(() => {
  const diagnoses = []
  const result = diagnosisResult?.value

  // 添加主诊断
  if (result?.result && result.probability != null) {
    diagnoses.push({
      name: result.result,
      probability: result.probability,
      isMain: true
    })
  }

  // 添加其他诊断
  const other = result?.otherDisease
  if (other && Array.isArray(other) && other.length > 0) {
    other.forEach(d => {
      diagnoses.push({
        name: d.name ?? '未知',
        probability: d.probability ?? 0,
        isMain: false
      })
    })
  }

  return diagnoses.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
});

// 图表数据（包含主诊断用于饼图展示）
const chartData = computed(() => {
  return allDiagnoses.value.map(d => ({
    name: d.name ?? '未知',
    value: d.probability ?? 0
  }))
});

// 根据概率获取颜色（使用设计系统语义色）
const getProbabilityColor = (probability: number) => {
  if (probability > 70) return 'var(--claude-success)';
  if (probability > 30) return 'var(--claude-warning)';
  return 'var(--claude-error)';
};

// 根据可靠性获取标签颜色
const getReliabilityColor = (level: string) => {
  switch (level) {
    case '较高': return 'green';
    case '一般': return 'blue';
    case '较低': return 'orange';
    case '待复核': return 'orange';
    case '拒识': return 'red';
    default: return 'gray';
  }
};

// 根据严重程度获取颜色
const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'normal': return 'green';
    case 'mild': return 'orange';
    case 'moderate': return 'gold';
    case 'severe': return 'red';
    default: return 'gray';
  }
};

// 格式化严重程度显示
const formatSeverity = (severity: string) => {
  switch (severity) {
    case 'normal': return '正常';
    case 'mild': return '轻度';
    case 'moderate': return '中度';
    case 'severe': return '严重';
    case 'NOT_ASSESSED': return '未评估';
    default: return '未知';
  }
};

//获取相关诊断可靠性的信息
const getReliabilityMessage = (level: string) => {
  switch (level) {
    case '较高':
      return '该结果为 AI 辅助分析，仍需结合专业医生意见。';
    case '一般':
    case '较低':
      return '该结果存在不确定性，请进行专业医学检查确认。';
    case '待复核':
      return '该结果已标记为待人工复核，不能作为诊断结论。';
    case '拒识':
      return 'AI 已拒绝形成诊断结论，请重新上传图片或申请人工复核。';
    default:
      return '';
  }
};

const getReliabilityMessageStyle = (level: string) => {
  const styles = {
    '较高': {
      backgroundColor: 'oklch(from var(--claude-success) l c h / 0.15)',
      borderColor: 'oklch(from var(--claude-success) l c h / 0.3)'
    },
    '一般': {
      backgroundColor: 'oklch(from var(--claude-warning) l c h / 0.15)',
      borderColor: 'oklch(from var(--claude-warning) l c h / 0.3)'
    },
    '较低': {
      backgroundColor: 'oklch(from var(--claude-error) l c h / 0.15)',
      borderColor: 'oklch(from var(--claude-error) l c h / 0.3)'
    },
    '待复核': {
      backgroundColor: 'oklch(from var(--claude-warning) l c h / 0.15)',
      borderColor: 'oklch(from var(--claude-warning) l c h / 0.3)'
    },
    '拒识': {
      backgroundColor: 'oklch(from var(--claude-error) l c h / 0.15)',
      borderColor: 'oklch(from var(--claude-error) l c h / 0.3)'
    }
  };
  return styles[level as keyof typeof styles] || {};
};

// 诊断结果描述（用于屏幕阅读器）
const screenReaderSummary = computed(() => {
  if (!diagnosisResult?.value) return ''
  if (isRejected.value) return `本次图像被 AI 拒识：${rejectionMessage.value}`
  return `AI 初步分析：${diagnosisResult.value.result || '未知'}，置信度 ${diagnosisResult.value.confidence || 0}%，严重程度：${formatSeverity(diagnosisResult.value.severity || 'NOT_ASSESSED')}。仅供参考，请咨询专业医生。`
})
</script>

<style scoped>
.diagnosis-container {
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-4);
  padding: var(--claude-space-5);
  background-color: var(--claude-bg-page);
}

.medical-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
  flex-wrap: wrap;
}
.action-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--claude-space-2);
}

/* 骨架屏特定样式 */
.skeleton-image {
  width: 100%;
  height: 300px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 添加动画效果使加载更自然 */
.ant-skeleton {
  padding: var(--claude-space-4);
}

.ant-skeleton-content .ant-skeleton-title {
  height: 24px;
  margin-bottom: var(--claude-space-4);
}

.ant-skeleton-content .ant-skeleton-paragraph li {
  height: 16px;
  margin-bottom: 12px;
}

.top-section,
.middle-section,
.bottom-section {
  width: 100%;
  border-radius: var(--claude-radius-md);
  box-shadow: var(--claude-shadow-sm);
}

/* 顶部诊断结果样式 */
.main-diagnosis {
  padding: var(--claude-space-4);
}

.diagnosis-header {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.header-icon {
  font-size: 1.5rem;
  color: var(--claude-brand);
  margin-right: 12px;
}

.diagnosis-title {
  font-size: 1.375rem;
  color: var(--claude-text-primary);
  margin: 0 12px 0 0;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.severity-tag {
  font-size: 0.875rem;
  padding: 0 8px;
  height: 24px;
  line-height: 22px;
}

.confidence-section {
  display: flex;
  align-items: center;
  margin: 20px 0;
  gap: 12px;
}

.confidence-label {
  font-weight: 500;
  color: var(--claude-text-secondary);
  flex-shrink: 0;
}

.confidence-bar {
  flex: 1;
  min-width: 0;
}

.probability-value {
  font-weight: bold;
  color: var(--claude-text-primary);
  width: 50px;
  text-align: right;
}

.section-title {
  font-size: 1.125rem;
  color: var(--claude-text-primary);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
}

.section-title .anticon {
  margin-right: 8px;
}

.section-content {
  color: var(--claude-text-secondary);
  line-height: 1.8;
  margin: 0;
}

/* 治疗建议样式 */
.recommendation-list {
  background-color: var(--claude-bg-card);
  border-radius: var(--claude-radius-sm);
  padding: var(--claude-space-4);
}

.recommendation-item {
  display: flex;
  margin-bottom: 12px;
  align-items: flex-start;
}

.recommendation-number {
  width: 24px;
  height: 24px;
  background-color: var(--claude-success);
  color: var(--claude-text-inverse);
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.recommendation-text {
  flex-grow: 1;
  min-width: 0;
  color: var(--claude-text-secondary);
  line-height: 1.6;
  overflow-wrap: break-word;
  word-break: break-word;
}

/* 中间部分样式 */
.middle-section {
  padding: var(--claude-space-4);
}

.other-diagnoses {
  padding-right: var(--claude-space-4);
}

.vertical-bars {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: var(--claude-space-4);
}

.bar-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.disease-name {
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--claude-text-secondary);
  font-weight: 500;
}

.vertical-progress {
  flex: 1;
  margin-right: 12px;
}

.probability-chart {
  height: 300px;
}

/* 底部可靠性样式 */
.bottom-section {
  font-size: 1.125rem;
  color: var(--claude-text-primary);
  margin-bottom: 12px;
  display: flex;
  align-items: flex-start;
}

.reliability {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
}

.reliability-label {
  font-weight: 500;
  color: var(--claude-text-secondary);
  margin-right: 12px;
  display: flex;
  align-items: center;
}

.reliability-tag {
  font-size: 1rem;
  padding: 0 12px;
  height: 32px;
  line-height: 30px;
}

/* 严重程度颜色 */
.severity-normal { color: var(--claude-success); }
.severity-mild { color: var(--claude-warning); }
.severity-moderate { color: var(--claude-warning); }
.severity-severe { color: var(--claude-error); }

/* 图片列样式 */
.image-col {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--claude-space-4);
  background-color: var(--claude-bg-card);
  border-radius: var(--claude-radius-md);
}

.image-container {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  border-radius: var(--claude-radius-sm);
  box-shadow: var(--claude-shadow-sm);
}

.diagnosis-image {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
  border-radius: var(--claude-radius-sm);
  transition: transform 0.3s;
}

.diagnosis-image:hover {
  transform: scale(1.02);
}

.reliability {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 8px 0;
  justify-content: flex-start;
}

.reliability-message {
  width: 100%;
  margin-top: 8px;
  margin-left: 0;
  padding: 12px;
  border-radius: var(--claude-radius-sm);
}

/* 医疗免责声明样式 */
.disclaimer-section {
  background: linear-gradient(135deg, oklch(0.92 0.01 60), oklch(0.95 0.02 30));
  border: 1px solid oklch(0.78 0.05 30 / 0.2);
}

.disclaimer-content {
  display: flex;
  align-items: flex-start;
  gap: var(--claude-space-4);
}

.disclaimer-icon {
  font-size: 1.5rem;
  color: var(--claude-brand);
  flex-shrink: 0;
  margin-top: 0.25rem;
}

.disclaimer-text {
  flex: 1;
}

.disclaimer-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0 0 0.375rem;
}

.disclaimer-body {
  font-size: 0.8125rem;
  color: var(--claude-text-secondary);
  line-height: 1.65;
  margin: 0;
}

.doctor-consult {
  margin-top: var(--claude-space-4);
  padding-top: 0.75rem;
  border-top: 1px solid oklch(0.78 0.05 30 / 0.15);
  text-align: center;
}

.consult-text {
  font-size: 0.8125rem;
  color: var(--claude-text-tertiary);
}

/* 屏幕阅读器专用（视觉隐藏但可读） */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .confidence-section {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .confidence-label {
    width: auto;
  }

  .confidence-bar {
    width: 100%;
    margin-right: 0;
  }

  .diagnosis-header {
    flex-wrap: wrap;
    gap: 8px;
  }

  .diagnosis-title {
    flex-basis: 100%;
  }
}
</style>
