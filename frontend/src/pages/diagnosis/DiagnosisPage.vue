<script lang="ts" setup>
import { ref } from 'vue'
import { EyeOutlined, HeartOutlined, RocketOutlined, BellOutlined, DatabaseOutlined, StarOutlined } from '@ant-design/icons-vue'
import ImageUploader from '@/components/diagnosis/ImageUploader.vue'
import DiagnosisResult from '@/components/diagnosis/DiagnosisResult.vue'
import { useDiagnosisStore } from '@/stores/diagnosis'

const diagnosisStore = useDiagnosisStore()
const { setLoading } = diagnosisStore

const features = [
  { title: '精准诊断', description: '基于深度学习算法和大量医学数据，提供高精度的眼科疾病诊断', icon: EyeOutlined },
  { title: '快速分析', description: '秒级响应，快速分析眼部图像，及时提供诊断结果', icon: RocketOutlined },
  { title: '全面评估', description: '对多种眼科疾病进行全面评估，包括近视、远视、白内障等', icon: HeartOutlined },
  { title: '智能提示', description: '智能提示潜在眼健康问题，帮助用户及时预防和治疗', icon: BellOutlined },
  { title: '数据安全', description: '严格保护用户数据隐私，确保所有医疗信息安全存储', icon: DatabaseOutlined },
  { title: '专业建议', description: '提供专业的眼科健康建议和治疗方案参考', icon: StarOutlined }
]

const diagnosisPicture = ref<API.DiagnosisUploadDTO>()

const onSuccess = (newDiagnosisPicture: API.DiagnosisUploadDTO) => {
  diagnosisPicture.value = newDiagnosisPicture
}

const closeModal = () => {
  setLoading(false)
}
</script>

<template>
  <div class="diagnosis-page">
    <header class="hero-header">
      <span class="hero-badge">AI 驱动</span>
      <h1 class="hero-title">眼科智能诊断</h1>
      <p class="hero-subtitle">上传眼底照片，获取基于深度学习的高精度分析报告</p>
      <p class="hero-note" aria-label="说明">本服务仅供参考，不能替代专业医生诊断</p>
    </header>

    <section class="upload-zone">
      <div class="upload-glow" aria-hidden="true" />
      <div class="upload-inner">
        <ImageUploader :picture="diagnosisPicture" :onSuccess="onSuccess" />
      </div>
    </section>

    <section class="features">
      <h2 class="features-heading">核心优势</h2>
      <div class="features-grid">
        <div
          v-for="(feature, index) in features"
          :key="feature.title"
          class="feature-item"
          :style="{ '--stagger': `${index * 80}ms` }"
        >
          <div class="feature-icon-wrap">
            <component :is="feature.icon" />
          </div>
          <div class="feature-body">
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <a-modal
      v-model:open="diagnosisStore.loading"
      title="诊断结果"
      width="80%"
      :footer="null"
      :afterClose="closeModal"
    >
      <DiagnosisResult />
    </a-modal>
  </div>
</template>

<style scoped>
.diagnosis-page {
  min-height: 100vh;
  position: relative;
  background-image: var(--claude-bg-image, none);
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  overflow-x: hidden;
}

.diagnosis-page::before {
  content: "";
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, oklch(0.75 0.06 30 / 0.06), transparent),
    var(--claude-bg-page);
  opacity: 0.93;
  z-index: 0;
  pointer-events: none;
}

/* ── Hero Header ── */

.hero-header {
  position: relative;
  z-index: 1;
  text-align: center;
  padding: clamp(3rem, 8vh, 5rem) 1.5rem clamp(2rem, 4vh, 3rem);
}

.hero-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--claude-brand);
  background: oklch(0.75 0.06 30 / 0.1);
  border: 1px solid oklch(0.75 0.06 30 / 0.2);
  border-radius: 100px;
  padding: 0.3rem 0.9rem;
  margin-bottom: 1.25rem;
}

.hero-title {
  font-family: var(--claude-font-serif);
  font-size: clamp(2.25rem, 5vw, 3.25rem);
  font-weight: 400;
  color: var(--claude-text-primary);
  line-height: 1.1;
  margin: 0 0 0.75rem;
  letter-spacing: -0.02em;
}

.hero-subtitle {
  font-size: 1.0625rem;
  color: var(--claude-text-secondary);
  max-width: 32ch;
  margin: 0 auto;
  line-height: 1.65;
}

.hero-note {
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
  margin: 1rem auto 0;
  max-width: 40ch;
  line-height: 1.5;
  opacity: 0.8;
}

/* ── Upload Zone — Hero Moment ── */

.upload-zone {
  position: relative;
  z-index: 1;
  max-width: 600px;
  margin: 0 auto clamp(4rem, 8vh, 7rem);
}

.upload-glow {
  position: absolute;
  inset: -1.5rem;
  background: radial-gradient(ellipse at center, oklch(0.75 0.06 30 / 0.1), transparent 70%);
  border-radius: var(--claude-radius-2xl);
  pointer-events: none;
  animation: pulse-glow 5s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.015); }
}

.upload-inner {
  position: relative;
  border-radius: var(--claude-radius-xl);
  background: var(--claude-bg-elevated);
  border: 1px solid oklch(0.75 0.04 30 / 0.15);
  box-shadow:
    0 8px 32px oklch(0.75 0.03 30 / 0.1),
    0 1px 3px rgba(20, 20, 19, 0.04);
  overflow: hidden;
}

/* ── Features ── */

.features {
  position: relative;
  z-index: 1;
  max-width: 1060px;
  margin: 0 auto;
  padding: 0 1.5rem clamp(4rem, 6vh, 6rem);
}

.features-heading {
  font-family: var(--claude-font-serif);
  font-size: 1.375rem;
  font-weight: 400;
  color: var(--claude-text-primary);
  text-align: center;
  margin: 0 0 2.5rem;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem;
}

.feature-item {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.5rem;
  border-radius: var(--claude-radius-lg);
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  transition:
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  animation: feature-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: var(--stagger);
}

.feature-item:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 28px oklch(0.75 0.03 30 / 0.1);
  border-color: oklch(0.75 0.05 30 / 0.2);
}

.feature-icon-wrap {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: var(--claude-radius-md);
  background: oklch(0.75 0.05 30 / 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  color: var(--claude-brand);
  transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.feature-item:hover .feature-icon-wrap {
  background: oklch(0.75 0.06 30 / 0.15);
  transform: scale(1.06);
}

.feature-body h3 {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0 0 0.375rem;
}

.feature-body p {
  font-size: 0.8125rem;
  color: var(--claude-text-tertiary);
  line-height: 1.6;
  margin: 0;
}

@keyframes feature-enter {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}

/* ── Reduced Motion ── */

@media (prefers-reduced-motion: reduce) {
  .feature-item {
    animation: none;
  }

  .upload-glow {
    animation: none;
    opacity: 0.8;
  }

  .feature-item:hover {
    transform: none;
  }

  .feature-item:hover .feature-icon-wrap {
    transform: none;
  }
}

/* ── Mobile Responsive ── */

@media (max-width: 768px) {
  .hero-badge {
    font-size: 0.625rem;
    padding: 0.25rem 0.75rem;
  }

  .hero-title {
    font-size: clamp(1.75rem, 6vw, 2.25rem);
  }

  .hero-subtitle {
    font-size: 0.9375rem;
  }

  .hero-note {
    font-size: 0.6875rem;
    padding: 0 1rem;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .upload-zone {
    margin-left: 1rem;
    margin-right: 1rem;
  }
}
</style>
