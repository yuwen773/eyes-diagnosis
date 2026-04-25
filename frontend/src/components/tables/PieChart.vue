<script lang="ts">
import { defineComponent, onMounted, ref, watch, computed } from 'vue';
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

    // 品牌色系
    const brandColors = [
      '#c96442', // 赤陶色
      '#d97757', // 浅赤陶
      '#7a9e4a', // 橄榄绿
      '#b53333', // 深红
      '#8b6b4a', // 棕褐
      '#5a7a8a', // 蓝灰
      '#9e7a5a', // 沙色
      '#6b5a7a', // 紫灰
    ];

    // 计算总数
    const totalCount = computed(() => {
      const data = props.chartData.data || [];
      return data.reduce((sum: number, item: { value: number }) => sum + (item.value || 0), 0);
    });

    const initChart = () => {
      if (!chartRef.value) return;

      const chart = echarts.init(chartRef.value);
      chartInstance = chart;

      const data = props.chartData.data || [];

      const option = {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(26, 26, 24, 0.95)',
          borderColor: 'rgba(201, 100, 66, 0.3)',
          borderWidth: 1,
          textStyle: {
            color: '#f5f4ed',
            fontSize: 12
          },
          formatter: (params: { name: string; value: number; percent: number }) => {
            return `<div style="font-weight: 600; margin-bottom: 4px;">${params.name}</div>
                    <div>病例数: <span style="color: #c96442; font-weight: 600;">${params.value.toLocaleString()}</span></div>
                    <div>占比: <span style="color: #c96442; font-weight: 600;">${params.percent}%</span></div>`;
          }
        },
        // 图例放底部
        legend: {
          orient: 'horizontal',
          bottom: 0,
          left: 'center',
          itemGap: 16,
          itemWidth: 12,
          itemHeight: 12,
          textStyle: {
            color: '#87867f',
            fontSize: 11
          },
          data: data.map((item: { name: string }) => item.name)
        },
        // 中心放总数
        graphic: [{
          type: 'group',
          left: 'center',
          top: '38%',
          children: [
            {
              type: 'text',
              style: {
                text: totalCount.value.toLocaleString(),
                fill: '#141413',
                fontSize: 28,
                fontWeight: 700,
                fontFamily: 'Georgia, serif'
              }
            },
            {
              type: 'text',
              style: {
                text: '总病例',
                fill: '#87867f',
                fontSize: 12,
                y: 24
              }
            }
          ]
        }],
        series: [
          {
            name: '病种分布',
            type: 'pie',
            radius: ['45%', '75%'],
            center: ['50%', '45%'],
            roseType: 'radius', // 南丁格尔玫瑰图
            itemStyle: {
              borderRadius: 6,
              borderColor: '#faf9f5',
              borderWidth: 3
            },
            label: {
              show: true,
              position: 'outside',
              formatter: '{b}\n{d}%',
              fontSize: 11,
              color: '#5e5d59',
              lineHeight: 16,
              padding: [0, 0, 0, 0],
              // 标签引导线
              labelLine: {
                show: true,
                length: 8,
                length2: 12,
                lineStyle: {
                  color: '#e8e6dc',
                  width: 1
                }
              }
            },
            emphasis: {
              scale: true,
              scaleSize: 8,
              itemStyle: {
                shadowBlur: 20,
                shadowColor: 'rgba(201, 100, 66, 0.3)'
              },
              label: {
                fontWeight: 600,
                color: '#141413'
              }
            },
            data: data.map((item: { value: number; name: string }, index: number) => ({
              ...item,
              itemStyle: {
                color: brandColors[index % brandColors.length]
              }
            }))
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
          const data = props.chartData.data || [];
          chartInstance.setOption({
            graphic: [{
              type: 'group',
              left: 'center',
              top: '38%',
              children: [
                {
                  type: 'text',
                  style: {
                    text: totalCount.value.toLocaleString(),
                    fill: '#141413',
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: 'Georgia, serif'
                  }
                },
                {
                  type: 'text',
                  style: {
                    text: '总病例',
                    fill: '#87867f',
                    fontSize: 12,
                    y: 24
                  }
                }
              ]
            }],
            series: [{
              data: data.map((item: { value: number; name: string }, index: number) => ({
                ...item,
                itemStyle: {
                  color: brandColors[index % brandColors.length]
                }
              }))
            }]
          });
        }
      },
      { deep: true }
    );

    return { chartRef };
  }
});
</script>

<template>
  <div class="pie-chart-container">
    <div class="chart-header">
      <h3 class="chart-title">{{ title }}</h3>
    </div>
    <div ref="chartRef" class="chart" />
  </div>
</template>

<style scoped>
.pie-chart-container {
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
  height: 320px;
  width: 100%;
}
</style>
