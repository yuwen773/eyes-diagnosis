<template>
  <a-card :title="title" class="chart-card">
    <div ref="chartRef" class="chart" />
  </a-card>
</template>

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
          trigger: 'item',
          formatter: '{a} <br/>{b}: {c} ({d}%)'
        },
        legend: {
          orient: 'vertical',
          right: 10,
          top: 'center',
          data: props.chartData.legend
        },
        series: [
          {
            name: '病种分布',
            type: 'pie',
            radius: ['50%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: {
              borderRadius: 10,
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
                fontSize: '18',
                fontWeight: 'bold'
              }
            },
            labelLine: {
              show: false
            },
            data: props.chartData.data
          }
        ]
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
            series: [
              {
                data: props.chartData.data
              }
            ]
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
