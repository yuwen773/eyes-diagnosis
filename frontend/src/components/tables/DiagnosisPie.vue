<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';

interface ChartData {
  name: string;
  value: number;
}

const props = defineProps<{
  data: ChartData[];
}>();

const chartRef = ref<HTMLElement>();
let chartInstance: echarts.ECharts | null = null;

onMounted(() => {
  renderChart();
});

onUnmounted(() => {
  chartInstance?.dispose();
});

watch(() => props.data, () => {
  renderChart();
}, { deep: true });

const renderChart = () => {
  if (!chartRef.value) return;

  const existingInstance = echarts.getInstanceByDom(chartRef.value);
  if (existingInstance) {
    existingInstance.dispose();
  }

  chartInstance = echarts.init(chartRef.value);

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: {c}% ({d}%)'
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      data: props.data.map(item => item.name)
    },
    series: [
      {
        name: '诊断概率',
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
        data: props.data
      }
    ]
  };

  chartInstance.setOption(option);

  window.addEventListener('resize', () => {
    chartInstance?.resize();
  });
};
</script>

<template>
  <div ref="chartRef" style="width: 100%; height: 100%;"></div>
</template>
