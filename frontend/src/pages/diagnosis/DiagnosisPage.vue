<template>

  <div class="diagnosis-container">
<!--诊断标题    -->
    <div class="header">
      <h1>眼科智能诊断系统</h1>
      <p>基于人工智能技术的高精度眼科疾病诊断与分析</p>
    </div>
<!--上传图像-->
    <a-row justify="center" :gutter="[24, 24]" class="uploader-section">
      <a-col :span="24" :lg="{ span: 12 }">
        <ImageUploader :picture="diagnosisPicture" :onSuccess="onSuccess" />
      </a-col>
    </a-row>
<!--系统特点-->
    <a-row justify="center" class="features-section">
      <div class="desc">系统特点</div>
      <a-list
        :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 6, xxl: 6 }"
        :data-source="features"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-card :hoverable="true" class="feature-card">
              <template #cover>
<!--特点的icon-->
                <div class="feature-icon">
                  <component :is="item.icon" style="font-size: 24px; color: var(--claude-brand);" />
                </div>
              </template>
              <a-card-meta>
<!--特点标题                -->
                <template #title>
                  <h3>{{ item.title }}</h3>
                </template>
                <template #description>
<!--特点描述                  -->
                  <p>{{ item.description }}</p>
                </template>
              </a-card-meta>
            </a-card>
          </a-list-item>
        </template>
      </a-list>
    </a-row>
<!--诊断结果的模态框   v-model:open="diagnosisStore.loading"-->
    <a-modal
      v-model:open="diagnosisStore.loading"
      title="诊断结果"
      width="80%"
      :footer="null"
      :afterClose="closeModal"
    >
      <DiagnosisResult />

<!--      <DiagnosisResults />-->
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { EyeOutlined, HeartOutlined, RocketOutlined, BellOutlined, DatabaseOutlined, StarOutlined } from '@ant-design/icons-vue';
import ImageUploader from '@/components/diagnosis/ImageUploader.vue';
import DiagnosisResult from '@/components/diagnosis/DiagnosisResult.vue';

import { useDiagnosisStore } from '@/stores/diagnosis'
const diagnosisStore = useDiagnosisStore();
const { setLoading } = diagnosisStore;

// 系统特点数据
const features = [
  {
    title: '精准诊断',
    description: '基于深度学习算法和大量医学数据，提供高精度的眼科疾病诊断',
    icon: EyeOutlined
  },
  {
    title: '快速分析',
    description: '秒级响应，快速分析眼部图像，及时提供诊断结果',
    icon: RocketOutlined
  },
  {
    title: '全面评估',
    description: '对多种眼科疾病进行全面评估，包括近视、远视、白内障等',
    icon: HeartOutlined
  },
  {
    title: '智能提示',
    description: '智能提示潜在眼健康问题，帮助用户及时预防和治疗',
    icon: BellOutlined
  },
  {
    title: '数据安全',
    description: '严格保护用户数据隐私，确保所有医疗信息安全存储',
    icon: DatabaseOutlined
  },
  {
    title: '专业建议',
    description: '提供专业的眼科健康建议和治疗方案参考',
    icon: StarOutlined
  }
];

//TODO
const diagnosisPicture = ref<API.DiagnosisVO>()
//上传成功
const onSuccess = (newDiagnosisPicture: API.DiagnosisVO) => {
  diagnosisPicture.value = newDiagnosisPicture
  console.log(diagnosisPicture.value)
}

const closeModal = () =>{
  setLoading(false)
  console.log("@@@@@@@@@@@@")
}

</script>

<style scoped>
.diagnosis-container {
  min-height: 100vh;
  background-image: url('@/assets/img.png');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  position: relative;
}

.diagnosis-container::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.85);
  z-index: 0;
}

.header {
  text-align: center;
  margin-bottom: 32px;
  position: relative;
  z-index: 1;
  padding-top: 15px;
}

.header h1 {
  color: var(--claude-text-primary);
  margin-bottom: 8px;
  font-size: 28px;
  font-family: var(--claude-font-serif);
}

.header p {
  color: var(--claude-text-secondary);
  font-size: 16px;
}

.uploader-section {
  margin-bottom: 48px;
  position: relative;
  z-index: 2;
}

.feature-card {
  text-align: center;
  border-radius: 8px;
  transition: all 0.3s ease;
  height: 100%;
  box-shadow: 0 4px 12px rgba(20, 20, 19, 0.1);
  background-color: var(--claude-bg-elevated);
}

.feature-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 16px rgba(20, 20, 19, 0.15);
}

.feature-icon {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--claude-bg-card);
  border-radius: 8px 8px 0 0;
  padding: 12px;
}

.desc {
  text-align: center;
  color: var(--claude-text-tertiary);
  font-size: 22px;
  margin-bottom: 24px;
  font-weight: 500;
  position: relative;
  z-index: 1;
}

:deep(.ant-card-meta-title) {
  font-size: 16px;
  margin-bottom: 8px;
  color: var(--claude-text-primary);
}

:deep(.ant-card-meta-description) {
  color: var(--claude-text-secondary);
  font-size: 14px;
  line-height: 1.5;
}

.features-section {
  margin-top: 48px;
  position: relative;
  z-index: 1;
}
</style>
