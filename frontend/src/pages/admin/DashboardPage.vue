<template>
  <div class="dashboard-page">
    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <a-card v-for="stat in stats" :key="stat.label" :bordered="false">
        <div class="text-3xl font-bold text-blue-600">{{ stat.value }}</div>
        <div class="text-sm text-gray-500 mt-2">{{ stat.label }}</div>
      </a-card>
    </div>

    <!-- 图表区域 -->
    <div class="grid grid-cols-2 gap-4 mb-6">
      <a-card title="诊断趋势 (近7天)" :bordered="false">
        <div ref="lineChartRef" style="height: 320px"></div>
      </a-card>
      <a-card title="疾病类型分布" :bordered="false">
        <div ref="pieChartRef" style="height: 320px"></div>
      </a-card>
    </div>

    <!-- 最近诊断记录 -->
    <a-card title="最近诊断记录" :bordered="false">
      <a-table :columns="columns" :data-source="recentDiagnoses" :pagination="false" row-key="id" size="middle" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'

// ── 统计卡片 mock 数据 ─────────────────────────────────
const stats = [
  { value: '1,284', label: '用户总数' },
  { value: '5,632', label: '诊断总次数' },
  { value: '47', label: '今日新增诊断' },
  { value: '126', label: '知识库文件数' },
]

// ── 图表 ref ───────────────────────────────────────────
const lineChartRef = ref<HTMLElement | null>(null)
const pieChartRef = ref<HTMLElement | null>(null)
let lineChart: ECharts | null = null
let pieChart: ECharts | null = null

// ── 折线图配置 ─────────────────────────────────────────
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
        data: [62, 78, 53, 91, 84, 47, 65],
      },
    ],
  })
}

// ── 饼图配置 ───────────────────────────────────────────
const initPieChart = () => {
  if (!pieChartRef.value) return
  pieChart = echarts.init(pieChartRef.value)
  pieChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left' },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        itemStyle: { borderRadius: 10 },
        label: { show: true, formatter: '{b}: {d}%' },
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

// ── 窗口 resize 处理 ───────────────────────────────────
const handleResize = () => {
  lineChart?.resize()
  pieChart?.resize()
}

// ── 最近诊断记录表格 ──────────────────────────────────
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

// ── 生命周期 ───────────────────────────────────────────
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
  /* AdminLayout already provides padding & background */
}
</style>
