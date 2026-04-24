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
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          }
        },
        legend: {
          data: props.chartData.legend
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true
        },
        xAxis: {
          type: props.chartData.xAxis.type,
          data: props.chartData.xAxis.data
        },
        yAxis: {
          type: props.chartData.yAxis.type,
          name: props.chartData.yAxis.name
        },
        series: props.chartData.series.map((series: any) => ({
          name: series.name,
          type: 'bar',
          data: series.data
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
            series: props.chartData.series.map((series: any) => ({
              name: series.name,
              data: series.data
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
