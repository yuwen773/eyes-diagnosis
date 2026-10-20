<template>
  <div class="trend-chart-container">
    <a-row :gutter="[16, 16]">
      <!-- Line Chart: Monthly Diagnosis Trend -->
      <a-col :xs="24" :lg="12">
        <a-card title="月度诊断趋势" class="chart-card">
          <div ref="lineChartRef" class="chart"></div>
        </a-card>
      </a-col>
      <!-- Pie Chart: Disease Distribution -->
      <a-col :xs="24" :lg="12">
        <a-card title="疾病分布" class="chart-card">
          <div ref="pieChartRef" class="chart"></div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref, watch, onUnmounted } from 'vue';
import * as echarts from 'echarts';
import dayjs from 'dayjs';

interface DiagnosisRecord {
  id?: string | number;
  createTime?: string;
  result?: string;
  url?: string;
  confidence?: number;
  severity?: string;
  reexamineStatus?: number;
  status?: string;
  username?: string;
}

export default defineComponent({
  name: 'DiagnosisTrendChart',
  props: {
    diagnosisData: {
      type: Array as () => DiagnosisRecord[],
      default: () => []
    }
  },
  setup(props) {
    const lineChartRef = ref<HTMLElement | null>(null);
    const pieChartRef = ref<HTMLElement | null>(null);
    let lineChartInstance: echarts.ECharts | null = null;
    let pieChartInstance: echarts.ECharts | null = null;

    // Warm color palette
    const colors = {
      primary: '#1b7f6b',
      secondary: '#2f9e83',
      background: '#faf9f5',
      text: '#5e5d59'
    };

    // Process data for line chart (monthly diagnosis count)
    const getLineChartData = () => {
      const monthlyData: Record<string, number> = {};

      props.diagnosisData.forEach((record: DiagnosisRecord) => {
        if (record.createTime) {
          const month = dayjs(Number(record.createTime)).format('YYYY-MM');
          monthlyData[month] = (monthlyData[month] || 0) + 1;
        }
      });

      // Sort by month and get last 12 months
      const sortedMonths = Object.keys(monthlyData).sort().slice(-12);
      const xAxisData = sortedMonths;
      const seriesData = sortedMonths.map(month => monthlyData[month]);

      return { xAxisData, seriesData };
    };

    // Process data for pie chart (disease distribution)
    const getPieChartData = () => {
      const diseaseCount: Record<string, number> = {};

      props.diagnosisData.forEach((record: DiagnosisRecord) => {
        if (record.result) {
          // Extract main disease name from result (e.g., "正常视网膜", "白内障")
          const disease = record.result.split(/[，,。.]/)[0] || record.result;
          diseaseCount[disease] = (diseaseCount[disease] || 0) + 1;
        }
      });

      return Object.entries(diseaseCount).map(([name, value]) => ({
        name,
        value
      }));
    };

    const initLineChart = () => {
      if (!lineChartRef.value) return;

      const existingInstance = echarts.getInstanceByDom(lineChartRef.value);
      if (existingInstance) {
        existingInstance.dispose();
      }

      lineChartInstance = echarts.init(lineChartRef.value);
      const { xAxisData, seriesData } = getLineChartData();

      const option = {
        color: [colors.primary],
        tooltip: {
          trigger: 'axis',
          backgroundColor: colors.background,
          textStyle: { color: colors.text }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: xAxisData.length > 0 ? xAxisData : ['暂无数据'],
          axisLabel: {
            color: colors.text,
            rotate: 30
          },
          axisLine: {
            lineStyle: { color: colors.secondary }
          }
        },
        yAxis: {
          type: 'value',
          name: '诊断数量',
          nameTextStyle: { color: colors.text },
          axisLabel: { color: colors.text },
          axisLine: { lineStyle: { color: colors.secondary } },
          splitLine: { lineStyle: { color: '#eee' } }
        },
        series: [
          {
            name: '月度诊断数',
            type: 'line',
            smooth: true,
            data: seriesData.length > 0 ? seriesData : [0],
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: colors.primary + '80' },
                { offset: 1, color: colors.primary + '10' }
              ])
            },
            lineStyle: { color: colors.primary, width: 2 },
            itemStyle: { color: colors.primary }
          }
        ]
      };

      lineChartInstance.setOption(option);
    };

    const initPieChart = () => {
      if (!pieChartRef.value) return;

      const existingInstance = echarts.getInstanceByDom(pieChartRef.value);
      if (existingInstance) {
        existingInstance.dispose();
      }

      pieChartInstance = echarts.init(pieChartRef.value);
      const pieData = getPieChartData();

      const option = {
        color: [colors.primary, colors.secondary, '#e8a87c', '#c38d9e', '#41b3a3', '#f6cd61'],
        tooltip: {
          trigger: 'item',
          formatter: '{a} <br/>{b}: {c} ({d}%)',
          backgroundColor: colors.background,
          textStyle: { color: colors.text }
        },
        legend: {
          orient: 'vertical',
          right: 10,
          top: 'center',
          textStyle: { color: colors.text }
        },
        series: [
          {
            name: '疾病分布',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: true,
            itemStyle: {
              borderRadius: 8,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: false,
              position: 'center'
            },
            emphasis: {
              label: {
                show: true,
                fontSize: '16',
                fontWeight: 'bold',
                color: colors.text
              }
            },
            labelLine: {
              show: false
            },
            data: pieData.length > 0 ? pieData : [{ name: '暂无数据', value: 1 }]
          }
        ]
      };

      pieChartInstance.setOption(option);
    };

    const resizeCharts = () => {
      lineChartInstance?.resize();
      pieChartInstance?.resize();
    };

    const updateCharts = () => {
      if (lineChartInstance) {
        const { xAxisData, seriesData } = getLineChartData();
        lineChartInstance.setOption({
          xAxis: { data: xAxisData.length > 0 ? xAxisData : ['暂无数据'] },
          series: [{ data: seriesData.length > 0 ? seriesData : [0] }]
        });
      }

      if (pieChartInstance) {
        const pieData = getPieChartData();
        pieChartInstance.setOption({
          series: [{ data: pieData.length > 0 ? pieData : [{ name: '暂无数据', value: 1 }] }]
        });
      }
    };

    onMounted(() => {
      initLineChart();
      initPieChart();
      window.addEventListener('resize', resizeCharts);
    });

    onUnmounted(() => {
      window.removeEventListener('resize', resizeCharts);
      lineChartInstance?.dispose();
      pieChartInstance?.dispose();
    });

    watch(
      () => props.diagnosisData,
      () => {
        updateCharts();
      },
      { deep: true }
    );

    return {
      lineChartRef,
      pieChartRef
    };
  }
});
</script>

<style scoped>
.trend-chart-container {
  margin-bottom: 24px;
}

.chart-card {
  border-radius: 8px;
  height: 100%;
}

.chart {
  height: 320px;
  width: 100%;
}
</style>
