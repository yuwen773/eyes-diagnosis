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

      const seriesKeys = Object.keys(props.chartData.series);

      const option = {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(22, 20, 15, 0.95)',
          borderColor: 'rgba(27, 127, 107, 0.3)',
          borderWidth: 1,
          textStyle: {
            color: '#f5f4ed',
            fontSize: 12
          }
        },
        legend: {
          data: seriesKeys,
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
          type: 'category',
          boundaryGap: false,
          data: props.chartData.xAxis,
          axisLine: {
            lineStyle: { color: '#e8e6dc' }
          },
          axisLabel: {
            color: '#87867f',
            fontSize: 11
          }
        },
        yAxis: {
          type: 'value',
          name: '病例数',
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
        series: seriesKeys.map((key, index) => ({
          name: key,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: {
            color: brandColors[index % brandColors.length]
          },
          lineStyle: {
            width: 2.5,
            color: brandColors[index % brandColors.length]
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: brandColors[index % brandColors.length] + '40' },
                { offset: 1, color: brandColors[index % brandColors.length] + '00' }
              ]
            }
          },
          emphasis: {
            scale: true,
            itemStyle: {
              borderWidth: 2,
              borderColor: '#fff'
            }
          },
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

    onUnmounted(() => {
      window.removeEventListener('resize', resizeChart);
      chartInstance?.dispose();
    });

    watch(
      () => props.chartData,
      () => {
        if (chartInstance) {
          const seriesKeys = Object.keys(props.chartData.series);
          const option = {
            series: seriesKeys.map((key) => ({
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
  <div class="line-chart-container">
    <div class="chart-header">
      <h3 class="chart-title">{{ title }}</h3>
    </div>
    <div ref="chartRef" class="chart" />
  </div>
</template>

<style scoped>
.line-chart-container {
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
