<script lang="ts" setup>
import { h, onMounted, onUnmounted, ref } from 'vue'
import {
  ScanOutlined,
  RobotOutlined,
  ReadOutlined,
  ToolOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  FundProjectionScreenOutlined,
  FileSearchOutlined,
  CommentOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue'
import { RouterLink } from 'vue-router'

import banner1 from '@/assets/banner1.png'
import GridDistortion from '@/components/GridDistortion.vue'

const diseases = ref([
  { id: 'normal', label: '正常眼底', tag: 'normal' },
  { id: 'amd', label: '年龄相关性黄斑变性', tag: 'AMD' },
  { id: 'cataract', label: '白内障', tag: '白内障' },
  { id: 'diabetes', label: '糖尿病视网膜病变', tag: '糖尿病' },
  { id: 'glaucoma', label: '青光眼', tag: '青光眼' },
  { id: 'hypertension', label: '高血压视网膜病变', tag: '高血压' },
  { id: 'myopia', label: '病理性近视', tag: '近视' },
  { id: 'other', label: '其他疾病', tag: '其他' },
])

const features = ref([
  {
    id: 'feature-diagnosis',
    icon: ScanOutlined,
    title: '智能图像诊断',
    description:
      '基于 EfficientNet-B4 深度学习模型，对 380×380 眼底图像进行精准分类，支持混合精度训练与余弦退火优化',
    stat: '8',
    statLabel: '种疾病识别',
  },
  {
    id: 'feature-agent',
    icon: RobotOutlined,
    title: 'AI 问诊助手',
    description:
      '基于 Spring AI ReactAgent 的流式对话引擎，支持图像分析、文档检索等工具调用，提供持续追问与深度解读',
  },
  {
    id: 'feature-rag',
    icon: ReadOutlined,
    title: '知识库 RAG',
    description:
      '上传医学文档（PDF/MD/DOCX），自动解析分块并向量嵌入，通过 ChromaDB 实现精准语义检索',
  },
  {
    id: 'feature-mcp',
    icon: ToolOutlined,
    title: 'MCP 工具扩展',
    description:
      '支持用户配置外部 MCP 工具服务器（STDIO/SSE/HTTP），动态扩展 Agent 能力，工具列表 Redis 缓存',
  },
  {
    id: 'feature-vision',
    icon: EyeOutlined,
    title: '多模态视觉分析',
    description:
      '调用 Qwen-VL-Plus 视觉大模型，结构化输出眼底图像异常描述、紧急程度评估与诊疗建议',
  },
  {
    id: 'feature-grpc',
    icon: ThunderboltOutlined,
    title: 'gRPC 实时推理',
    description:
      'Java 后端通过 Protobuf + gRPC 高效调用 Python 算法服务，返回诊断标签、置信度与可靠性评分',
    stat: '10s',
    statLabel: '内完成诊断',
  },
])

const steps = ref([
  {
    id: 'step-upload',
    icon: UploadOutlined,
    title: '上传眼底图像',
    desc: '支持常见图片格式，一键上传眼底照片',
  },
  {
    id: 'step-analyze',
    icon: FundProjectionScreenOutlined,
    title: 'AI 模型推理',
    desc: 'EfficientNet-B4 模型自动分析，输出 Top-3 预测',
  },
  {
    id: 'step-report',
    icon: FileSearchOutlined,
    title: '获取诊断报告',
    desc: '诊断标签、概率、可靠性评分及中文描述',
  },
  {
    id: 'step-chat',
    icon: CommentOutlined,
    title: 'AI 深度问诊',
    desc: '基于视觉分析结果，AI 助手进一步解读与建议',
  },
])

const solutions = ref([
  {
    id: 'solution-resource',
    title: '基层医疗资源不足',
    description:
      'AI 辅助诊断帮助基层医疗机构提升眼科诊疗能力，缓解专业眼科医生短缺，降低误诊漏诊风险',
  },
  {
    id: 'solution-standard',
    title: '诊断标准不统一',
    description:
      '基于标准化模型推理流程与可靠性评分机制，确保不同场景下诊断结果一致、可追溯',
  },
  {
    id: 'solution-convenience',
    title: '患者就诊不便',
    description:
      '支持远程眼底图像上传与 AI 在线问诊，减少患者往返医院次数，特别适合偏远地区与行动不便人群',
  },
  {
    id: 'solution-screening',
    title: '疾病早期筛查难',
    description:
      'EfficientNet-B4 经过丰富数据增强训练，能够识别早期微小病变，实现青光眼、糖尿病视网膜病变等疾病的早筛',
  },
])

let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement
          el.dataset.revealed = 'true'
        }
      })
    },
    { threshold: 0.12, rootMargin: '0px 0px -50px 0px' },
  )
  document.querySelectorAll('.reveal-section').forEach((el) => {
    observer?.observe(el)
  })
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="home-page">
    <!-- ═══ Hero ═══ -->
    <section class="hero">
      <GridDistortion
        :imageSrc="banner1"
        :grid="12"
        :mouse="0.15"
        :strength="0.2"
        :relaxation="0.88"
        className="hero-grid"
      />
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <span class="hero-eyebrow">EyeSight · 基于 EfficientNet-B4 与检索增强生成的多模态眼科诊断系统</span>
        <h1 class="hero-title">
          AI 驱动的<br />
          <span class="hero-title-accent">眼底精准诊断</span>
        </h1>
        <p class="hero-subtitle">
          基于 EfficientNet-B4 深度学习模型，自动识别 8 种常见眼科疾病，融合大语言模型智能问诊与知识库检索
        </p>
        <RouterLink to="/diagnosis" class="hero-cta">
          开始诊断
          <ArrowRightOutlined />
        </RouterLink>
      </div>
      <div class="hero-scroll-hint" aria-hidden="true">
        <div class="scroll-line"></div>
      </div>
    </section>

    <!-- ═══ Disease Coverage ═══ -->
    <section class="diseases reveal-section">
      <div class="diseases-container">
        <header class="section-header">
          <span class="section-eyebrow">疾病覆盖</span>
          <h2 class="section-heading">支持 8 种常见眼科疾病识别</h2>
          <p class="section-intro">
            覆盖主要眼底疾病类型，从正常眼底筛查到多类疾病诊断
          </p>
        </header>
        <div class="diseases-grid">
          <div
            v-for="(disease, index) in diseases"
            :key="disease.id"
            class="disease-item"
            :style="{ '--delay': `${index * 60}ms` }"
          >
            <span class="disease-tag">{{ disease.tag }}</span>
            <span class="disease-label">{{ disease.label }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ Features ═══ -->
    <section class="features reveal-section">
      <div class="features-container">
        <header class="section-header">
          <span class="section-eyebrow">核心能力</span>
          <h2 class="section-heading">六大技术能力</h2>
          <p class="section-intro">
            从图像诊断到智能问诊，构建完整的眼科 AI 诊断技术体系
          </p>
        </header>
        <div class="features-grid">
          <div
            v-for="(feature, index) in features"
            :key="feature.id"
            class="feature-card"
            :style="{ '--delay': `${index * 70}ms` }"
          >
            <div class="feature-icon-wrap">
              <component :is="feature.icon" />
            </div>
            <div class="feature-body">
              <h3 class="feature-title">{{ feature.title }}</h3>
              <p class="feature-desc">{{ feature.description }}</p>
            </div>
            <div v-if="feature.stat" class="feature-stat">
              <span class="stat-value">{{ feature.stat }}</span>
              <span class="stat-label">{{ feature.statLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ How it works ═══ -->
    <section class="steps reveal-section">
      <div class="steps-container">
        <header class="section-header">
          <span class="section-eyebrow">使用流程</span>
          <h2 class="section-heading">四步完成智能诊断</h2>
        </header>
        <div class="steps-flow">
          <div
            v-for="(step, index) in steps"
            :key="step.id"
            class="step-item"
            :style="{ '--delay': `${index * 100}ms` }"
          >
            <div class="step-number">{{ index + 1 }}</div>
            <div class="step-icon-wrap">
              <component :is="step.icon" />
            </div>
            <h3 class="step-title">{{ step.title }}</h3>
            <p class="step-desc">{{ step.desc }}</p>
            <div v-if="index < steps.length - 1" class="step-connector" aria-hidden="true">
              <ArrowRightOutlined />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ Solutions ═══ -->
    <section class="solutions reveal-section">
      <div class="solutions-container">
        <header class="section-header">
          <span class="section-eyebrow">解决方案</span>
          <h2 class="section-heading">应对行业挑战</h2>
        </header>
        <div class="solutions-grid">
          <div
            v-for="(solution, index) in solutions"
            :key="solution.id"
            class="solution-card"
            :style="{ '--delay': `${index * 90}ms` }"
          >
            <div class="solution-number">
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
            </div>
            <div class="solution-body">
              <h3 class="solution-title">{{ solution.title }}</h3>
              <p class="solution-desc">{{ solution.description }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ Final CTA ═══ -->
    <section class="cta-banner reveal-section">
      <div class="cta-inner">
        <h2 class="cta-heading">开启智能诊断之旅</h2>
        <p class="cta-text">
          上传眼底图像，EfficientNet-B4 模型即刻完成分析并返回诊断结果
        </p>
        <RouterLink to="/diagnosis" class="cta-button">
          立即体验
          <ArrowRightOutlined />
        </RouterLink>
      </div>
    </section>

  </div>
</template>

<style scoped>
/* ══════════════════════════════════════
   Page base
   ══════════════════════════════════════ */
.home-page {
  background: var(--claude-bg-page);
}

/* ══════════════════════════════════════
   Hero
   ══════════════════════════════════════ */
.hero {
  position: relative;
  height: 92vh;
  min-height: 560px;
  max-height: 800px;
  overflow: hidden;
}

.hero-grid {
  position: absolute;
  inset: 0;
  z-index: 0;

  :deep(canvas) {
    width: 100% !important;
    height: 100% !important;
    display: block;
    object-fit: cover;
  }
}

.hero-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    160deg,
    oklch(0.14 0.02 40 / 0.85) 0%,
    oklch(0.14 0.02 40 / 0.6) 40%,
    oklch(0.14 0.02 40 / 0.3) 70%,
    oklch(0.14 0.02 40 / 0.15) 100%
  );
}

.hero-content {
  position: relative;
  z-index: 2;
  height: 100%;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 48px;
  animation: hero-enter 1s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes hero-enter {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
}

.hero-eyebrow {
  font-family: var(--claude-font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: oklch(0.75 0.06 35);
  margin-bottom: 20px;
}

.hero-title {
  font-family: var(--claude-font-serif);
  font-size: clamp(42px, 6vw, 72px);
  font-weight: 700;
  color: oklch(0.97 0.005 80);
  line-height: 1.15;
  margin: 0 0 20px 0;
  letter-spacing: 2px;
}

.hero-title-accent {
  color: oklch(0.65 0.1 30);
}

.hero-subtitle {
  font-size: 18px;
  color: oklch(0.78 0.01 70);
  max-width: 520px;
  line-height: 1.7;
  margin: 0 0 40px 0;
}

.hero-cta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 54px;
  padding: 0 36px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 1px;
  color: oklch(0.97 0.005 80);
  background: oklch(0.55 0.1 30);
  border-radius: 100px;
  text-decoration: none;
  width: fit-content;
  pointer-events: auto;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 20px oklch(0.45 0.08 30 / 0.35);
}

.hero-cta:hover {
  background: oklch(0.6 0.12 30);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px oklch(0.45 0.08 30 / 0.45);
}

.hero-cta :deep(.anticon) {
  transition: transform 0.3s ease;
}

.hero-cta:hover :deep(.anticon) {
  transform: translateX(4px);
}

.hero-scroll-hint {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  pointer-events: none;
}

.scroll-line {
  width: 1px;
  height: 48px;
  background: linear-gradient(to bottom, oklch(0.7 0.01 70 / 0.6), transparent);
  animation: scroll-pulse 2s ease-in-out infinite;
}

@keyframes scroll-pulse {
  0%, 100% { opacity: 0.4; transform: scaleY(1); }
  50% { opacity: 1; transform: scaleY(1.2); transform-origin: top; }
}

/* ══════════════════════════════════════
   Shared section styles
   ══════════════════════════════════════ */
.section-header {
  text-align: center;
  margin-bottom: 56px;
}

.section-eyebrow {
  display: block;
  font-family: var(--claude-font-sans);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: oklch(0.55 0.08 30);
  margin-bottom: 12px;
}

.section-heading {
  font-family: var(--claude-font-serif);
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  color: oklch(0.18 0.02 55);
  margin: 0 0 12px 0;
  letter-spacing: 1px;
}

.section-intro {
  font-size: 16px;
  color: oklch(0.5 0.015 55);
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.7;
}

/* ══════════════════════════════════════
   Reveal animation
   ══════════════════════════════════════ */
.reveal-section {
  opacity: 0;
  transform: translateY(32px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}

.reveal-section[data-revealed='true'] {
  opacity: 1;
  transform: translateY(0);
}

/* ══════════════════════════════════════
   Disease Coverage
   ══════════════════════════════════════ */
.diseases {
  padding: 80px 0;
  background: var(--claude-bg-card);
}

.diseases-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px;
}

.diseases-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
}

.disease-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  background: var(--claude-bg-elevated);
  border-radius: 100px;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.3s ease;
  animation: card-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.reveal-section[data-revealed='true'] .disease-item {
  animation: card-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.disease-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px oklch(0.2 0.02 40 / 0.08);
}

.disease-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  color: oklch(0.97 0.005 80);
  background: oklch(0.55 0.1 30);
  border-radius: 100px;
  letter-spacing: 0.5px;
}

.disease-label {
  font-size: 15px;
  font-weight: 500;
  color: oklch(0.22 0.02 55);
  white-space: nowrap;
}

/* ══════════════════════════════════════
   Features
   ══════════════════════════════════════ */
.features {
  padding: 96px 0;
  background: oklch(0.97 0.008 80);
}

.features-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.feature-card {
  background: var(--claude-bg-elevated);
  border-radius: 16px;
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.4s ease;
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.reveal-section[data-revealed='true'] .feature-card {
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
}

.feature-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, oklch(0.55 0.1 30), oklch(0.55 0.1 30 / 0.2));
  opacity: 0;
  transition: opacity 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px oklch(0.2 0.02 40 / 0.08);
}

.feature-card:hover::before {
  opacity: 1;
}

.feature-icon-wrap {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: oklch(0.95 0.025 60);
  font-size: 24px;
  color: oklch(0.55 0.1 30);
  transition: background 0.3s ease, transform 0.3s ease;
}

.feature-card:hover .feature-icon-wrap {
  background: oklch(0.55 0.1 30);
  color: oklch(0.97 0.005 80);
  transform: scale(1.05);
}

.feature-body {
  flex: 1;
}

.feature-title {
  font-size: 18px;
  font-weight: 700;
  color: oklch(0.18 0.02 55);
  margin: 0 0 8px 0;
}

.feature-desc {
  font-size: 14px;
  color: oklch(0.5 0.015 55);
  line-height: 1.7;
  margin: 0;
}

.feature-stat {
  display: flex;
  flex-direction: column;
  padding-top: 12px;
  border-top: 1px solid oklch(0.9 0.01 80);
}

.stat-value {
  font-family: var(--claude-font-serif);
  font-size: 28px;
  font-weight: 700;
  color: oklch(0.55 0.1 30);
  line-height: 1;
}

.stat-label {
  font-size: 12px;
  color: oklch(0.5 0.015 55);
  margin-top: 4px;
}

/* ══════════════════════════════════════
   How it works (Steps)
   ══════════════════════════════════════ */
.steps {
  padding: 96px 0;
  background: var(--claude-bg-card);
}

.steps-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px;
}

.steps-flow {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  position: relative;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 20px;
  position: relative;
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.reveal-section[data-revealed='true'] .step-item {
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.step-number {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: oklch(0.55 0.1 30);
  color: oklch(0.97 0.005 80);
  font-family: var(--claude-font-serif);
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 20px;
}

.step-icon-wrap {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: oklch(0.94 0.025 60);
  font-size: 28px;
  color: oklch(0.55 0.1 30);
  margin-bottom: 20px;
  transition: transform 0.3s ease;
}

.step-item:hover .step-icon-wrap {
  transform: scale(1.08);
}

.step-title {
  font-size: 17px;
  font-weight: 700;
  color: oklch(0.18 0.02 55);
  margin: 0 0 8px 0;
}

.step-desc {
  font-size: 14px;
  color: oklch(0.5 0.015 55);
  line-height: 1.65;
  margin: 0;
  max-width: 200px;
}

.step-connector {
  position: absolute;
  right: -12px;
  top: 72px;
  font-size: 16px;
  color: oklch(0.55 0.1 30 / 0.4);
  z-index: 1;
}

/* ══════════════════════════════════════
   Solutions
   ══════════════════════════════════════ */
.solutions {
  padding: 96px 0;
  background: oklch(0.97 0.008 80);
}

.solutions-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 40px;
}

.solutions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
}

.solution-card {
  display: flex;
  gap: 28px;
  padding: 36px;
  background: var(--claude-bg-elevated);
  border-radius: 16px;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.reveal-section[data-revealed='true'] .solution-card {
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--delay);
}

.solution-card:hover {
  transform: translateY(-3px);
}

.solution-number {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: oklch(0.94 0.02 60);
  transition: background 0.3s ease;
}

.solution-number span {
  font-family: var(--claude-font-serif);
  font-size: 22px;
  font-weight: 700;
  color: oklch(0.55 0.1 30);
}

.solution-card:hover .solution-number {
  background: oklch(0.55 0.1 30);
}

.solution-card:hover .solution-number span {
  color: oklch(0.97 0.005 80);
}

.solution-body {
  flex: 1;
}

.solution-title {
  font-size: 20px;
  font-weight: 700;
  color: oklch(0.18 0.02 55);
  margin: 0 0 10px 0;
}

.solution-desc {
  font-size: 15px;
  color: oklch(0.5 0.015 55);
  line-height: 1.75;
  margin: 0;
}

/* ══════════════════════════════════════
   CTA Banner
   ══════════════════════════════════════ */
.cta-banner {
  background: linear-gradient(160deg, oklch(0.16 0.02 45), oklch(0.12 0.02 40));
  position: relative;
  overflow: hidden;
}

.cta-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 50% 80% at 70% 50%,
    oklch(0.55 0.08 30 / 0.1),
    transparent
  );
  pointer-events: none;
}

.cta-inner {
  max-width: 800px;
  margin: 0 auto;
  padding: 80px 40px;
  text-align: center;
  position: relative;
  z-index: 1;
}

.cta-heading {
  font-family: var(--claude-font-serif);
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 700;
  color: oklch(0.97 0.005 80);
  margin: 0 0 16px 0;
  letter-spacing: 1px;
}

.cta-text {
  font-size: 17px;
  color: oklch(0.7 0.015 65);
  margin: 0 0 36px 0;
  line-height: 1.6;
}

.cta-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 36px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
  color: oklch(0.97 0.005 80);
  background: oklch(0.55 0.1 30);
  border-radius: 100px;
  text-decoration: none;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 20px oklch(0.45 0.08 30 / 0.35);
}

.cta-button:hover {
  background: oklch(0.6 0.12 30);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px oklch(0.45 0.08 30 / 0.45);
}

.cta-button :deep(.anticon) {
  transition: transform 0.3s ease;
}

.cta-button:hover :deep(.anticon) {
  transform: translateX(4px);
}

/* ══════════════════════════════════════
   Responsive
   ══════════════════════════════════════ */
@media (max-width: 1024px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .steps-flow {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }

  .step-connector {
    display: none;
  }
}

@media (max-width: 768px) {
  .hero {
    height: 80vh;
    min-height: 480px;
  }

  .hero-content {
    padding: 0 24px;
  }

  .hero-subtitle {
    font-size: 16px;
  }

  .diseases,
  .features,
  .steps,
  .solutions {
    padding: 64px 0;
  }

  .diseases-container,
  .features-container,
  .steps-container,
  .solutions-container {
    padding: 0 20px;
  }

  .diseases-grid {
    gap: 10px;
  }

  .disease-item {
    padding: 10px 16px;
  }

  .disease-label {
    font-size: 13px;
  }

  .features-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .steps-flow {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .step-item {
    padding: 20px;
    flex-direction: row;
    text-align: left;
    gap: 16px;
  }

  .step-number {
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .step-icon-wrap {
    width: 48px;
    height: 48px;
    font-size: 22px;
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .step-desc {
    max-width: none;
  }

  .solutions-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .cta-inner {
    padding: 56px 20px;
  }
}

@media (max-width: 480px) {
  .hero-title {
    font-size: 32px;
  }

  .disease-item {
    width: 100%;
  }

  .solution-card {
    flex-direction: column;
    gap: 16px;
    padding: 24px;
  }
}
</style>
