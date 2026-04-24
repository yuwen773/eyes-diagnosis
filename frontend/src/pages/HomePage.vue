<script lang="ts" setup>
import { h, onMounted, onUnmounted, ref } from 'vue'
import {
  EyeOutlined,
  RobotOutlined,
  CloudServerOutlined,
  SafetyOutlined,
  TeamOutlined,
  ClockCircleOutlined, UpCircleOutlined
} from '@ant-design/icons-vue'
//是否显示
const showBackToTop = ref(false)

import banner1 from '@/assets/banner1.png';
import banner2 from '@/assets/banner2.png';
import banner3 from '@/assets/banner3.png';

// 轮播图图片 - 使用示例图片URL，实际项目中替换为真实图片
const carouselImages = ref([
  { id: 'banner-1', src: banner1 },
  { id: 'banner-2', src: banner2 },
  { id: 'banner-3', src: banner3 }
])
// 系统特点数据
const features = ref([
  {
    id: 'feature-precision',
    icon: EyeOutlined,
    title: '精准诊断',
    description: '采用先进的AI算法，对眼科疾病进行高精度诊断，准确率高达95%以上'
  },
  {
    id: 'feature-intelligence',
    icon: RobotOutlined,
    title: '智能分析',
    description: '自动分析眼底图像，快速识别多种眼科疾病，大幅提高诊断效率'
  },
  {
    id: 'feature-cloud',
    icon: CloudServerOutlined,
    title: '云端存储',
    description: '所有诊断数据安全存储在云端，随时随地可查阅历史记录'
  },
  {
    id: 'feature-security',
    icon: SafetyOutlined,
    title: '数据安全',
    description: '采用银行级加密技术，确保患者隐私数据绝对安全'
  },
  {
    id: 'feature-team',
    icon: TeamOutlined,
    title: '专家团队',
    description: '由国内顶尖眼科专家提供技术支持，确保诊断方案权威可靠'
  },
  {
    id: 'feature-speed',
    icon: ClockCircleOutlined,
    title: '快速响应',
    description: '10秒内完成初步诊断，为患者争取宝贵治疗时间'
  }
])

// 行业问题解决方案数据
const solutions = ref([
  {
    id: 'solution-resource',
    title: '基层医疗资源不足',
    description: '通过AI辅助诊断，帮助基层医疗机构提升眼科诊疗能力，缓解专业眼科医生短缺问题'
  },
  {
    id: 'solution-standard',
    title: '诊断标准不统一',
    description: '基于权威医学指南的标准化诊断流程，确保不同地区、不同医院诊断结果一致可靠'
  },
  {
    id: 'solution-convenience',
    title: '患者就诊不便',
    description: '支持远程诊断和在线咨询，减少患者往返医院次数，特别适合偏远地区患者'
  },
  {
    id: 'solution-screening',
    title: '疾病早期筛查难',
    description: 'AI算法能够发现早期微小病变，实现青光眼、糖尿病视网膜病变等疾病的早期筛查'
  }
])

// 监听滚动位置，控制"返回顶部"按钮的显示
const handleScroll = () => {
  showBackToTop.value = window.pageYOffset > 300
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})

const backToTop = () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}
</script>

<template>
  <div class="home-page">

    <!-- 轮播图 -->
    <div class="carousel-section">
      <a-carousel autoplay :autoplay-speed="5000">
        <div v-for="image in carouselImages" :key="image.id">
          <img :src="image.src" :alt="image.id" class="carousel-image" />
        </div>
      </a-carousel>
    </div>

    <!-- 系统特点 -->
    <div class="features-section">
      <a-typography-title :level="2" class="section-title">系统特点</a-typography-title>
      <div class="features-grid">
        <div v-for="feature in features" :key="feature.id" class="feature-card">
          <div class="feature-icon">
            <component :is="feature.icon" />
          </div>
          <a-typography-title :level="4" class="feature-title">{{ feature.title }}</a-typography-title>
          <a-typography-paragraph class="feature-desc">{{ feature.description }}</a-typography-paragraph>
        </div>
      </div>
    </div>

    <!-- 行业问题解决方案 -->
    <div class="solutions-section">
      <a-typography-title :level="2" class="section-title">行业问题解决方案</a-typography-title>
      <div class="solutions-list">
        <div v-for="solution in solutions" :key="solution.id" class="solution-item">
          <a-typography-title :level="3" class="solution-title">{{ solution.title }}</a-typography-title>
          <a-typography-paragraph class="solution-desc">{{ solution.description }}</a-typography-paragraph>
        </div>
      </div>
    </div>
    <a-affix :offsetBottom="80">
      <a-button
        class="toTop"
        type="primary"
        :icon="h(UpCircleOutlined)"
        v-show="showBackToTop"
        @click="backToTop"
      />
    </a-affix>
  </div>
</template>

<style scoped>
.home-page {
  background-color: var(--claude-bg-elevated);
}

.header {
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: var(--claude-bg-dark);
}

.logo {
  color: var(--claude-text-inverse);
  font-size: 20px;
  font-weight: bold;
  margin-right: 50px;
}

.carousel-section {
  height: 700px;
  width: 100%;
  overflow: hidden;
}

.carousel-image {
  width: 100%;
  height: 700px;
  object-fit: cover;
}

.features-section {
  height: 650px;
  width: 100%;
  padding: 60px 10%;
  background-color: var(--claude-bg-card);
}

.section-title {
  text-align: center;
  margin-bottom: 50px;
  color: var(--claude-text-primary);
  font-family: var(--claude-font-serif);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 40px;
}

.feature-card {
  padding: 30px;
  background: var(--claude-bg-elevated);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(20, 20, 19, 0.08);
  text-align: center;
}

.feature-icon {
  font-size: 48px;
  color: var(--claude-brand);
  margin-bottom: 20px;
}

.feature-title {
  margin-bottom: 15px !important;
  color: var(--claude-text-primary);
}

.feature-desc {
  color: var(--claude-text-secondary);
  font-size: 15px;
}

.solutions-section {
  height: 650px;
  width: 100%;
  padding: 60px 15%;
  background-color: var(--claude-bg-elevated);
}

.solutions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 30px;
}

.solution-item {
  flex: 1 1 45%;
  min-width: 300px;
  padding: 30px;
  background: var(--claude-bg-card);
  border-radius: 8px;
}

.solution-title {
  color: var(--claude-brand);
  margin-bottom: 20px !important;
}

.solution-desc {
  color: var(--claude-text-secondary);
  font-size: 15px;
  line-height: 1.8;
}

.to-top-btn {
  position: fixed;
  right: 20px;
  bottom: 80px;
  background-color: var(--claude-bg-dark);
  border-color: var(--claude-bg-dark);
  width: 50px;
  height: 50px;
  font-size: 20px;
  box-shadow: var(--claude-shadow-md);
  margin-right: 15px;
}
</style>
