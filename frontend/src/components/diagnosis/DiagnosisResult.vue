<template>
  <div class="diagnosis-container">
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
      <!-- 顶部诊断结果 -->
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
                <h2 class="diagnosis-title">{{ diagnosisResult?.result}}</h2>
                <a-tag :color="getSeverityColor(diagnosisResult?.severity||'moderate')" class="severity-tag">
                  {{ formatSeverity(diagnosisResult?.severity||'moderate') }}
                </a-tag>
              </div>

              <div class="probability-section">
                <span class="probability-label">诊断概率: </span>
                <a-progress
                  :percent="diagnosisResult?.confidence"
                  :stroke-color="getProbabilityColor(diagnosisResult?.confidence)"
                  :show-info="false"
                  class="probability-bar"
                />
                <span class="probability-value">{{ diagnosisResult?.confidence }}%</span>
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

      <!-- 中间部分 - 其他诊断结果 -->
      <a-card class="middle-section">
        <a-row :gutter="24">
          <a-col :span="12">
            <div class="other-diagnoses">
              <h3 class="section-title">
                <OrderedListOutlined />
                其他可能诊断
              </h3>
              <div class="vertical-bars">
                <div v-for="(disease, index) in topDiagnoses" :key="index" class="bar-container">
                  <span class="disease-name">{{ disease.name }}</span>
                  <a-progress
                    type="line"
                    :percent="disease.probability"
                    :stroke-color="getProbabilityColor(disease.probability )"
                    :show-info="false"
                    class="vertical-progress"
                  />
                  <span class="probability-value">{{ Math.round(disease.probability) }}%</span>
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
                  <PieChart :data="chartData"  :diagnoses="chartData"/>
            </div>
          </a-col>
        </a-row>
      </a-card>


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

  </div>
</template>
<script lang="ts" setup>
import { ref, computed, reactive } from 'vue'
import {
  CheckCircleOutlined,
  InfoCircleOutlined,
  MedicineBoxOutlined,
  OrderedListOutlined,
  PieChartOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons-vue';
import PieChart from '@/components/tables/DiagnosisPie.vue';
import { useDiagnosisStore } from '@/stores/diagnosis'
import { storeToRefs } from 'pinia'

const diagnosisStore = useDiagnosisStore();
const {diagnosisResult} = storeToRefs(diagnosisStore)
// const diagnosisResult = diagnosisStore.diagnosisResult


const recommendations = computed(()=>{
  return diagnosisResult?.value?.recommendations?.split('\n');
})


// 模拟数据
const result = ref({
  diagnosis: '糖尿病视网膜病变',
  confidence: 85,
  severity: 'moderate',
  details: '糖尿病引起的视网膜微血管损害，可能导致视力下降甚至失明。发现视网膜有多处微血管瘤和出血点。',
  recommendations: [
    '严格控制血糖水平，定期监测HbA1c',
    '每3-6个月进行一次眼底检查',
    '考虑进行视网膜激光治疗',
    '如有黄斑水肿，建议抗VEGF治疗'
  ]
});

const reliability = ref<'极高' | '高' | '低'>('极高');

// 分析点（模拟数据）
const analysisPoints = ref([
  { title: '微血管瘤', location: '图像左侧中央' },
  { title: '出血点', location: '图像右上方' },
  { title: '硬性渗出', location: '黄斑区周围' }
]);

// 格式化诊断时间
const formattedDiagnosisTime = computed(() => {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
});

// 获取前三的诊断结果 (包括主诊断)
const topDiagnoses = computed(() => {
  // return [
  //   {
  //     name: result.value.diagnosis,
  //     probability: result.value.confidence,
  //   },
  //   {
  //     name: '老年性黄斑变性',
  //     probability: 12,
  //   },
  //   {
  //     name: '视网膜静脉阻塞',
  //     probability: 3,
  //   }
  // ].sort((a, b) => b.probability - a.probability);


  //怕 other是undefined
  return diagnosisResult?.value?.otherDisease?.sort((a, b) => b?.probability - a?.probability);
});

// 图表数据
const chartData = computed(() => {
  return topDiagnoses?.value.map(d => ({
    name: d.name,
    value: d.probability
  }));
});

// 根据概率获取颜色
const getProbabilityColor = (probability:number) => {
  if (probability > 70) return '#52c41a'; // 绿色
  if (probability > 30) return '#faad14'; // 橙色
  return '#f5222d'; // 红色
};

// 根据可靠性获取标签颜色
const getReliabilityColor = (level: string) => {
  switch (level) {
    case '极高': return 'green';
    case '高': return 'blue';
    case '低': return 'orange';
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
    default: return '未知';
  }
};
//获取相关诊断可靠性的信息
const getReliabilityMessage = (level: string) => {
  switch (level) {
    case '极高':
      return '诊断结果可靠性非常高，可以较为确定地参考此结果。';
    case '高':
      return '诊断结果参考价值一般，有较大不确定性，必须进行专业检查确认。';
    case '低':
      return '诊断结果可靠性较低，仅供参考，请务必进行专业医学检查。';
    default:
      return '';
  }
};

const getReliabilityMessageStyle = (level: string) => {
  const styles = {
    '极高': {
      backgroundColor: 'rgb(209, 231, 221)',
      borderColor: 'rgb(183, 218, 203)'
    },
    '高': {
      backgroundColor: 'rgb(255, 243, 205)',
      borderColor: 'rgb(255, 230, 156)'
    },
    '低': {
      backgroundColor: 'rgb(246, 213, 216)',
      borderColor: 'rgb(241, 184, 190)'
    }
  };
  return styles[level] || {};
};
</script>

<style scoped>
.diagnosis-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background-color: #f5f7fa;
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
  padding: 16px;
}

.ant-skeleton-content .ant-skeleton-title {
  height: 24px;
  margin-bottom: 16px;
}

.ant-skeleton-content .ant-skeleton-paragraph li {
  height: 16px;
  margin-bottom: 12px;
}


.top-section,
.middle-section,
.bottom-section {
  width: 100%;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09);
}

/* 顶部诊断结果样式 */
.main-diagnosis {
  padding: 16px;
}

.diagnosis-header {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.header-icon {
  font-size: 24px;
  color: #1890ff;
  margin-right: 12px;
}

.diagnosis-title {
  font-size: 22px;
  color: #1a3a5f;
  margin: 0;
  margin-right: 12px;
}

.severity-tag {
  font-size: 14px;
  padding: 0 8px;
  height: 24px;
  line-height: 22px;
}

.probability-section {
  display: flex;
  align-items: center;
  margin: 20px 0;
}

.probability-label {
  font-weight: 500;
  color: #595959;
  margin-right: 12px;
  width: 80px;
}

.probability-bar {
  flex: 1;
  margin-right: 12px;
}

.probability-value {
  font-weight: bold;
  color: #1a3a5f;
  width: 50px;
  text-align: right;
}

.section-title {
  font-size: 18px;
  color: #1a3a5f;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
}

.section-title .anticon {
  margin-right: 8px;
}

.section-content {
  color: #595959;
  line-height: 1.8;
  margin: 0;
}

/* 治疗建议样式 */
.recommendation-list {
  background-color: #f9f9f9;
  border-radius: 6px;
  padding: 16px;
}

.recommendation-item {
  display: flex;
  margin-bottom: 12px;
  align-items: flex-start;
}

.recommendation-number {
  width: 24px;
  height: 24px;
  background-color: #52c41a;
  color: white;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.recommendation-text {
  flex-grow: 1;
  color: #595959;
  line-height: 1.6;
}

/* 中间部分样式 */
.middle-section {
  padding: 16px;
}

.other-diagnoses {
  padding-right: 16px;
}

.vertical-bars {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 16px;
}

.bar-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.disease-name {
  width: 180px;
  color: #595959;
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
  font-size: 18px;
  color: #1a3a5f;
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
  color: #595959;
  margin-right: 12px;
  display: flex;
  align-items: center;
}

.reliability-tag {
  font-size: 16px;
  padding: 0 12px;
  height: 32px;
  line-height: 30px;
}

/* 严重程度颜色 */
.severity-normal {
  color: #52c41a;
}

.severity-mild {
  color: #faad14;
}

.severity-moderate {
  color: #fa8c16;
}

.severity-severe {
  color: #f5222d;
}
/* 图片列样式 */
.image-col {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 8px;
}

.image-container {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.diagnosis-image {
  max-width: 100%;
  max-height: 400px; /* 根据实际需要调整 */
  object-fit: contain;
  border-radius: 4px;
  transition: transform 0.3s;
}

.diagnosis-image:hover {
  transform: scale(1.02);
}

.reliability {
  display: flex;
  flex-wrap: wrap; /* 允许换行 */
  align-items: center;
  padding: 8px 0;
  justify-content: flex-start;
}

.reliability-message {
  width: 100%; /* 占据整行 */
  margin-top: 8px; /* 与上方元素保持间距 */
  margin-left: 0; /* 移除左边距 */
  padding: 12px;
  border-radius: 5px;
}
</style>
