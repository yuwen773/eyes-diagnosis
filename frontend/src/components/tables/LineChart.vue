<script lang="ts">
import { defineComponent, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

export default defineComponent({
  props: {
    title: {
      type: String,
      required: true
    },
    chartData: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const chartRef = ref<HTMLElement | null>(null);
    let chartInstance: echarts.ECharts | null = null;

    const initChart = () => {
      if (!chartRef.value) return;

      const chart = echarts.init(chartRef.value);
      chartInstance = chart;

      const option = {
        tooltip: {
          trigger: 'axis'
        },
        legend: {
          data: Object.keys(props.chartData.series)
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
          data: props.chartData.xAxis
        },
        yAxis: {
          type: 'value',
          name: '患者数量'
        },
        series: Object.keys(props.chartData.series).map(key => ({
          name: key,
          type: 'line',
          stack: '总量',
          data: props.chartData.series[key]
        }))
      };

      chart.setOption(option);
    };

    const resizeChart = () => {
      chartInstance?.resize();
    };

    onMounted(() => {
      initChart();
      window.addEventListener('resize', resizeChart);
    });

    watch(
      () => props.chartData,
      () => {
        if (chartInstance) {
          const option = {
            series: Object.keys(props.chartData.series).map(key => ({
              name: key,
              data: props.chartData.series[key]
            }))
          };
          chartInstance.setOption(option);
        }
      },
      { deep: true }
    );

    return { chartRef };
  }
});
</script>

<template>
  <a-card :title="title" class="chart-card">
    <div ref="chartRef" class="chart" />
  </a-card>
</template>

<style scoped>
.chart-card {
  margin-bottom: 24px;
  border-radius: 8px;
}

.chart {
  height: 350px;
  width: 100%;
}
</style>
