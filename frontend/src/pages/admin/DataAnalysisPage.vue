<template>
  <div class="analytics-page">
    <!-- 时间筛选器 -->
    <div class="filter-bar">
      <a-radio-group v-model:value="timeRange" button-style="solid">
        <a-radio-button value="7">近7天</a-radio-button>
        <a-radio-button value="30">近30天</a-radio-button>
        <a-radio-button value="90">近90天</a-radio-button>
      </a-radio-group>
    </div>

    <!-- Stats: 4列横向 -->
    <section class="stats-hero">
      <div v-for="(stat, index) in stats" :key="index" class="stat-card" :class="{ 'stat-card--primary': index === 0 }">
        <div v-if="index === 0" class="stat-indicator"></div>
        <div class="stat-value">{{ stat.value }}</div>
        <div class="stat-label">{{ stat.label }}</div>
      </div>
    </section>

    <!-- Charts: 2:1 布局 -->
    <section class="charts-section">
      <div class="chart-card">
        <LineChart title="诊断趋势" :chartData="diagnosisTrend" />
      </div>
      <div class="chart-card">
        <PieChart title="疾病类型分布" :chartData="diseaseDistribution" />
      </div>
    </section>

    <!-- Bar Chart: 全宽 -->
    <section class="bar-section">
      <BarChart title="用户活跃度" :chartData="userActivity" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import StatsCard from '@/components/tables/StatsCard.vue'
import LineChart from '@/components/tables/LineChart.vue'
import PieChart from '@/components/tables/PieChart.vue'
import BarChart from '@/components/tables/BarChart.vue'

// TODO: replace mock data with API calls
const timeRange = ref<string>('30')

const stats = reactive([
  { label: '总诊断数', value: 8452 },
  { label: '确诊数', value: 7891 },
  { label: '准确率', value: '98.7%' },
  { label: '平均诊断速度', value: '2.3s' },
])

const diagnosisTrend = reactive({
  xAxis: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  series: {
    '近视': [120, 132, 101, 134, 90, 230, 210, 182, 191, 234, 290, 330],
    '远视': [220, 182, 191, 234, 290, 330, 310, 123, 442, 321, 90, 149],
    '散光': [150, 232, 201, 154, 190, 330, 410, 320, 310, 123, 440, 320],
    '弱视': [320, 332, 301, 334, 390, 330, 320, 310, 123, 442, 321, 90],
    '白内障': [820, 932, 901, 934, 1290, 1330, 1320, 1020, 930, 820, 980, 1000],
    '青光眼': [820, 932, 901, 934, 1290, 1330, 1320, 1020, 930, 820, 980, 1000],
  }
})

const diseaseDistribution = reactive({
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
    { value: 70, name: '视网膜病变' },
  ]
})

const userActivity = reactive({
  xAxis: {
    type: 'category',
    data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  },
  yAxis: {
    type: 'value',
    name: '活跃用户数',
  },
  legend: ['在线诊断', '报告查看', '数据导出'],
  series: [
    { name: '在线诊断', data: [120, 200, 150, 80, 70, 110, 130] },
    { name: '报告查看', data: [90, 150, 180, 220, 200, 180, 160] },
    { name: '数据导出', data: [30, 50, 40, 60, 45, 35, 25] },
  ]
})
</script>

<style scoped>
.analytics-page {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--claude-space-5);
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--claude-space-3);
  padding: var(--claude-space-4);
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  box-shadow: var(--claude-shadow-sm);
}

/* ── Stats: 4列横向 ── */
.stats-hero {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--claude-space-4);
}

.stat-card {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
}

.stat-card--primary {
  background: linear-gradient(135deg, var(--claude-brand) 0%, var(--claude-brand-dark) 100%);
  color: var(--claude-text-inverse);
}

.stat-indicator {
  position: absolute;
  top: -20px;
  right: -20px;
  width: 100px;
  height: 100px;
  background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%);
  border-radius: 50%;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--claude-text-primary);
}

.stat-card--primary .stat-value {
  color: inherit;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--claude-text-secondary);
  margin-top: var(--claude-space-2);
}

.stat-card--primary .stat-label {
  color: rgba(255,255,255,0.85);
}

/* ── Charts ── */
.charts-section {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--claude-space-4);
}

.chart-card {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
}

.bar-section {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
}
</style>
