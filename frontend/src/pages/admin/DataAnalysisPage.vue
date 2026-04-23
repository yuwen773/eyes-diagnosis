<template>
  <a-layout class="analytics-container">
    <a-layout-content class="content">
      <a-row :gutter="[24, 24]">
        <!-- 统计卡片 -->
        <a-col :span="24">
          <a-row :gutter="[16, 16]">
            <StatsCard
              v-for="(stat, index) in stats"
              :key="index"
              :value="stat.value"
              :label="stat.label"
            />
          </a-row>
        </a-col>

        <!-- 患者数量趋势图 -->
        <a-col :span="24">
          <LineChart
            title="患者数量趋势 (过去12个月)"
            :chartData="monthlyTrend"
          />
        </a-col>

        <!-- 病种分布和年龄分布并排 -->
        <a-col :span="12">
          <PieChart
            title="病种分布"
            :chartData="diseaseDistribution"
          />
        </a-col>
        <a-col :span="12">
          <BarChart
            title="不同年龄段患者分布"
            :chartData="ageDistribution"
          />
        </a-col>

        <!-- 诊断结果对比 -->
        <a-col :span="24">
          <BarChart
            title="诊断结果对比"
            :chartData="diagnosisComparison"
          />
        </a-col>
        <a-affix :offsetBottom="80">
          <a-button
            class="toTop"
            type="primary"
            :icon="h(UpCircleOutlined)"
            v-show="showBackToTop"
            @click="backToTop"
          />
        </a-affix>
      </a-row>
    </a-layout-content>
  </a-layout>
</template>
<script lang="ts">
import { defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import StatsCard from '@/components/tables/StatsCard.vue'
import LineChart from '@/components/tables/LineChart.vue'
import PieChart from '@/components/tables/PieChart.vue'
import BarChart from '@/components/tables/BarChart.vue'
import { UpCircleOutlined } from '@ant-design/icons-vue'
const AnalyticsData = {
  monthlyTrend: {
    xAxis: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    series: {
      '近视': [120, 132, 101, 134, 90, 230, 210, 182, 191, 234, 290, 330],
      '远视': [220, 182, 191, 234, 290, 330, 310, 123, 442, 321, 90, 149],
      '散光': [150, 232, 201, 154, 190, 330, 410, 320, 310, 123, 440, 320],
      '弱视': [320, 332, 301, 334, 390, 330, 320, 310, 123, 442, 321, 90],
      '白内障': [820, 932, 901, 934, 1290, 1330, 1320, 1020, 930, 820, 980, 1000],
      '青光眼': [820, 932, 901, 934, 1290, 1330, 1320, 1020, 930, 820, 980, 1000]
    }
  },
  diseaseDistribution: {
    legend: ['近视', '远视', '散光', '弱视', '白内障', '青光眼', '黄斑病变', '角膜炎', '结膜炎', '视网膜病变'],
    data: [
      { value: 1048, name: '近视' },
      { value: 735, name: '远视' },
      { value: 580, name: '散光' },
      { value: 484, name: '弱视' },
      { value: 300, name: '白内障' },
      { value: 251, name: '青光眼' },
      { value: 198, name: '黄斑病变' },
      { value: 102, name: '角膜炎' },
      { value: 98, name: '结膜炎' },
      { value: 70, name: '视网膜病变' }
    ]
  },
  ageDistribution: {
    xAxis: {
      type: 'value',
      boundaryGap: [0, 0.01]
    },
    yAxis: {
      type: 'category',
      data: ['0-20岁', '21-40岁', '41-60岁', '61-80岁', '80岁以上']
    },
    legend: ['近视', '远视', '散光', '弱视', '其他眼病'],
    series: [
      { name: '近视', data: [300, 500, 200, 50, 10] },
      { name: '远视', data: [50, 200, 400, 300, 100] },
      { name: '散光', data: [200, 300, 150, 50, 20] },
      { name: '弱视', data: [150, 50, 20, 5, 2] },
      { name: '其他眼病', data: [50, 100, 250, 400, 300] }
    ]
  },
  diagnosisComparison: {
    xAxis: {
      type: 'value',
      min: 0,
      max: 100
    },
    yAxis: {
      type: 'category',
      data: ['准确率', '漏诊率', '误诊率', '一致性', '灵敏度', '特异性']
    },
    legend: ['AI诊断结果', '人工复核结果'],
    series: [
      { name: 'AI诊断结果', data: [95, 5, 3, 92, 96, 98] },
      { name: '人工复核结果', data: [98, 2, 5, 90, 94, 96] }
    ]
  },
  stats :[
    {
      label: 'Total Patients',
      value: 8452
    },
    {
      label: 'Disease Types',
      value: 12
    },
    {
      label: 'Accuracy',
      value: '98.7%'
    },
    {
      label: 'Analysis Speed',
      value: '2.3s'
    }
  ]
};
export default defineComponent({
  components: {
    LineChart,
    PieChart,
    BarChart,
    StatsCard
  },


  setup() {
    const showBackToTop = ref(false)
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
    return {
      ...AnalyticsData,
      h,
      UpCircleOutlined,
      showBackToTop,
      backToTop
    };
  }
});
</script>

<style scoped>
.analytics-container {
  min-height: 100vh;
  background: #f0f2f5;
  padding: 24px;
}

.header {
  text-align: center;
  margin-bottom: 30px;
}

.header h1 {
  color: #1a3a5f;
  margin-bottom: 10px;
}

.header p {
  color: #8c8c8c;
}

.content {
  background: #fff;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.toTop {
  position: fixed;
  right: 20px;
  bottom: 80px;
  background-color: #1a3a5f;
  border-color: #1a3a5f;
  width: 50px;
  height: 50px;
  font-size: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  margin-right: 15px;
}
</style>
