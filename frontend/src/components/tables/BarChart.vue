<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref, watch } from 'vue';
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

    const brandColors = ['#1b7f6b', '#2f9e83', '#b37708', '#c0392b', '#9a9587', '#6f6a5e'];

    const initChart = () => {
      if (!chartRef.value) return;

      const existingInstance = echarts.getInstanceByDom(chartRef.value);
      if (existingInstance) {
        existingInstance.dispose();
      }

      const chart = echarts.init(chartRef.value);
      chartInstance = chart;

      const option = {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          },
          backgroundColor: 'rgba(22, 20, 15, 0.95)',
          borderColor: 'rgba(27, 127, 107, 0.3)',
          borderWidth: 1,
          textStyle: {
            color: '#f5f4ed',
            fontSize: 12
          }
        },
        legend: {
          data: props.chartData.legend,
          bottom: 0,
          left: 'center',
          itemGap: 20,
          textStyle: {
            color: '#87867f',
            fontSize: 11
          }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '50px',
          top: '20px',
          containLabel: true
        },
        xAxis: {
          type: props.chartData.xAxis.type,
          data: props.chartData.xAxis.data,
          axisLine: {
            lineStyle: { color: '#e8e6dc' }
          },
          axisLabel: {
            color: '#87867f',
            fontSize: 11
          }
        },
        yAxis: {
          type: props.chartData.yAxis.type,
          name: props.chartData.yAxis.name,
          nameTextStyle: {
            color: '#87867f',
            fontSize: 11
          },
          axisLine: {
            show: false
          },
          axisLabel: {
            color: '#87867f',
            fontSize: 11
          },
          splitLine: {
            lineStyle: {
              color: '#f0eee6',
              type: 'dashed'
            }
          }
        },
        series: props.chartData.series.map((series: { name: string; data: number[] }, index: number) => ({
          name: series.name,
          type: 'bar',
          barWidth: '40%',
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: brandColors[index % brandColors.length] },
                { offset: 1, color: brandColors[index % brandColors.length] + 'aa' }
              ]
            },
            borderRadius: [4, 4, 0, 0]
          },
          emphasis: {
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: brandColors[index % brandColors.length] },
                  { offset: 1, color: brandColors[index % brandColors.length] }
                ]
              }
            }
          },
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

    onUnmounted(() => {
      window.removeEventListener('resize', resizeChart);
      chartInstance?.dispose();
    });

    watch(
      () => props.chartData,
      () => {
        if (chartInstance) {
          const option = {
            series: props.chartData.series.map((series: { name: string; data: number[] }) => ({
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
  <div class="bar-chart-container">
    <div class="chart-header">
      <h3 class="chart-title">{{ title }}</h3>
    </div>
    <div ref="chartRef" class="chart" />
  </div>
</template>

<style scoped>
.bar-chart-container {
  width: 100%;
}

.chart-header {
  margin-bottom: 16px;
}

.chart-title {
  font-family: var(--claude-font-serif);
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--claude-text-primary);
  margin: 0;
}

.chart {
  height: 300px;
  width: 100%;
}
</style>
