<template>
  <div class="dashboard-page">
    <!-- Hero Stats: 4列横向排列 -->
    <section class="stats-hero">
      <div class="stat-card stat-card--primary">
        <div class="stat-indicator"></div>
        <div class="stat-content">
          <div class="stat-value">{{ stats[0].value }}</div>
          <div class="stat-label">{{ stats[0].label }}</div>
        </div>
        <div class="stat-trend">
          <ArrowUpOutlined />12.5%
        </div>
      </div>
      <div v-for="stat in stats.slice(1)" :key="stat.label" class="stat-card">
        <div class="stat-content">
          <div class="stat-value">{{ stat.value }}</div>
          <div class="stat-label">{{ stat.label }}</div>
        </div>
      </div>
    </section>

    <!-- Charts: 2:1 布局 -->
    <section class="charts-section">
      <div class="chart-card">
        <div class="chart-header">
          <span class="chart-title">诊断趋势</span>
          <span class="chart-subtitle">近7天</span>
        </div>
        <div ref="lineChartRef" class="chart-container"></div>
      </div>
      <div class="chart-card">
        <div class="chart-header">
          <span class="chart-title">疾病分布</span>
        </div>
        <div ref="pieChartRef" class="chart-container"></div>
      </div>
    </section>

    <!-- Table Section -->
    <section class="table-section">
      <div class="section-header">
        <span class="section-title">最近诊断记录</span>
        <span class="section-meta">实时更新</span>
        <a-button type="link" class="ml-auto">查看全部</a-button>
      </div>
      <a-table
        :columns="columns"
        :data-source="recentDiagnoses"
        :pagination="false"
        row-key="id"
        size="middle"
        class="recent-table"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted, onUnmounted, nextTick } from 'vue'
import { ArrowUpOutlined } from '@ant-design/icons-vue'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'

const stats = [
  { value: '5,632', label: '诊断总次数' },
  { value: '1,284', label: '用户总数' },
  { value: '47', label: '今日新增' },
  { value: '126', label: '知识库文件' },
]

const lineChartRef = ref<HTMLElement | null>(null)
const pieChartRef = ref<HTMLElement | null>(null)
let lineChart: ECharts | null = null
let pieChart: ECharts | null = null

const initLineChart = () => {
  if (!lineChartRef.value) return
  lineChart = echarts.init(lineChartRef.value)
  lineChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: '诊断次数',
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.3 },
        itemStyle: { color: '#c96442' },
        data: [62, 78, 53, 91, 84, 47, 65],
      },
    ],
  })
}

const initPieChart = () => {
  if (!pieChartRef.value) return
  pieChart = echarts.init(pieChartRef.value)
  pieChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left', top: 'middle' },
    series: [
      {
        type: 'pie',
        radius: ['45%', '75%'],
        center: ['60%', '50%'],
        itemStyle: { borderRadius: 6 },
        label: { show: true, formatter: '{b}', fontSize: 11 },
        color: ['#c96442', '#d97757', '#7a9e4a', '#b53333', '#87867f', '#5e5d59'],
        data: [
          { value: 1048, name: '近视' },
          { value: 735, name: '远视' },
          { value: 580, name: '散光' },
          { value: 484, name: '白内障' },
          { value: 300, name: '青光眼' },
          { value: 200, name: '其他' },
        ],
      },
    ],
  })
}

const handleResize = () => {
  lineChart?.resize()
  pieChart?.resize()
}

const columns = [
  { title: '用户', dataIndex: 'user', key: 'user' },
  {
    title: '诊断结果',
    dataIndex: 'result',
    key: 'result',
    customRender: ({ text }: { text: string }) => {
      const colorMap: Record<string, string> = {
        近视: 'blue',
        远视: 'green',
        散光: 'orange',
        白内障: 'red',
        青光眼: 'purple',
        正常: 'cyan',
      }
      return h('a-tag', { color: colorMap[text] || 'default' }, () => text)
    },
  },
  {
    title: '置信度',
    dataIndex: 'confidence',
    key: 'confidence',
    customRender: ({ text }: { text: number }) => `${(text * 100).toFixed(1)}%`,
  },
  { title: '时间', dataIndex: 'time', key: 'time' },
]

const recentDiagnoses = [
  { id: 1, user: '张三', result: '近视', confidence: 0.95, time: '2026-04-23 14:32' },
  { id: 2, user: '李四', result: '白内障', confidence: 0.87, time: '2026-04-23 13:18' },
  { id: 3, user: '王五', result: '正常', confidence: 0.99, time: '2026-04-23 11:45' },
  { id: 4, user: '赵六', result: '散光', confidence: 0.82, time: '2026-04-23 10:20' },
  { id: 5, user: '孙七', result: '青光眼', confidence: 0.76, time: '2026-04-23 09:05' },
]

onMounted(async () => {
  await nextTick()
  initLineChart()
  initPieChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  lineChart?.dispose()
  pieChart?.dispose()
  lineChart = null
  pieChart = null
})
</script>

<style scoped>
.dashboard-page {
  max-width: 1400px;
  margin: 0 auto;
}

/* ── Hero Stats: 1大3小横向排列 ── */
.stats-hero {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--claude-space-4);
}

.stat-card {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  position: relative;
  overflow: hidden;
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

.stat-content {
  position: relative;
  z-index: 1;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.2;
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

.stat-trend {
  position: absolute;
  top: var(--claude-space-4);
  right: var(--claude-space-4);
  font-size: 0.75rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--claude-radius-sm);
  background: rgba(255,255,255,0.2);
  color: #d4edda;
}

/* ── Charts: 2:1 布局 ── */
.charts-section {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--claude-space-4);
  margin-top: var(--claude-space-4);
}

.chart-card {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
}

.chart-header {
  margin-bottom: var(--claude-space-4);
}

.chart-title {
  font-family: var(--claude-font-serif);
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0;
  display: inline;
}

.chart-subtitle {
  font-size: 0.8rem;
  color: var(--claude-text-tertiary);
  margin-left: var(--claude-space-2);
}

.chart-container {
  height: 300px;
}

/* ── Table Section ── */
.table-section {
  background: var(--claude-bg-card);
  border-radius: var(--claude-radius-lg);
  padding: var(--claude-space-5);
  box-shadow: var(--claude-shadow-sm);
  margin-top: var(--claude-space-4);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--claude-space-4);
}

.section-title {
  font-family: var(--claude-font-serif);
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0;
  display: inline;
}

.section-meta {
  font-size: 0.75rem;
  color: var(--claude-text-tertiary);
  margin-left: var(--claude-space-2);
}

.recent-table :deep(.ant-table) {
  background: transparent;
}

.recent-table :deep(.ant-table-thead > tr > th) {
  background: transparent;
  border-bottom: 1px solid var(--claude-border-warm);
  font-weight: 500;
  color: var(--claude-text-secondary);
}

.recent-table :deep(.ant-table-tbody > tr > td) {
  border-bottom: 1px solid var(--claude-border-cream);
}

.recent-table :deep(.ant-table-tbody > tr:hover > td) {
  background: var(--color-bg-hover);
}
</style>
