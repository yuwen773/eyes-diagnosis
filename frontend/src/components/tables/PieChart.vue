<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref, watch, computed } from 'vue';
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

    // 医疗编辑风色系（与 --iris-* 一致：青绿强调 + 严重度语义色 + 中性）
    const brandColors = [
      '#1b7f6b', // 药用青绿
      '#2f9e83', // 浅青绿
      '#b37708', // 琥珀（中风险）
      '#c0392b', // 深红（高风险）
      '#9a9587', // 石灰
      '#6f6a5e', // 暖墨次级
      '#5a9ea0', // 青蓝辅助
      '#7a9e4a', // 橄榄中性
    ];

    // 计算总数
    const totalCount = computed(() => {
      const data = props.chartData.data || [];
      return data.reduce((sum: number, item: { value: number }) => sum + (item.value || 0), 0);
    });

    const initChart = () => {
      if (!chartRef.value) return;

      // 如果 DOM 上已有实例，先销毁
      const existingInstance = echarts.getInstanceByDom(chartRef.value);
      if (existingInstance) {
        existingInstance.dispose();
      }

      const chart = echarts.init(chartRef.value);
      chartInstance = chart;

      const data = props.chartData.data || [];

      const option = {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(22, 20, 15, 0.95)',
          borderColor: 'rgba(27, 127, 107, 0.3)',
          borderWidth: 1,
          textStyle: {
            color: '#f5f4ed',
            fontSize: 12
          },
          formatter: (params: { name: string; value: number; percent: number }) => {
            return `<div style="font-weight: 600; margin-bottom: 4px;">${params.name}</div>
                    <div>病例数: <span style="color: #1b7f6b; font-weight: 600;">${params.value.toLocaleString()}</span></div>
                    <div>占比: <span style="color: #1b7f6b; font-weight: 600;">${params.percent}%</span></div>`;
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
                shadowColor: 'rgba(27, 127, 107, 0.3)'
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

    onUnmounted(() => {
      window.removeEventListener('resize', resizeChart);
      chartInstance?.dispose();
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
