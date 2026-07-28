<script setup lang="ts">
/**
 * 诊断运营 Dashboard（PR-12）
 *
 * 数据来源：GET /api/workflow/stats/summary（后端本 PR 新增）。
 * 指标卡：今日诊断数量 / 完成率 / 平均耗时 / 人工复核数量。
 * 加载失败时优雅降级展示「暂无数据」。
 */
import { computed, onMounted, ref } from 'vue'
import {
  FileTextOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SolutionOutlined,
} from '@ant-design/icons-vue'
import {
  getWorkflowStatsSummary,
  type WorkflowStatsSummary,
} from '@/api/workflowStats'

const loading = ref(true)
const data = ref<WorkflowStatsSummary | null>(null)

const formatRate = (value: number) => {
  const pct = value <= 1 ? value * 100 : value
  return `${pct.toFixed(1)}%`
}

const formatDuration = (seconds: number) => {
  const total = Math.round(seconds)
  if (total >= 60) {
    return `${Math.floor(total / 60)}分${total % 60}秒`
  }
  return `${total}秒`
}

const cards = computed(() => {
  const d = data.value
  return [
    {
      key: 'todayCount',
      label: '今日诊断数量',
      value: d ? String(d.todayCount) : '—',
      icon: FileTextOutlined,
      tone: 'primary',
    },
    {
      key: 'completionRate',
      label: '完成率',
      value: d ? formatRate(d.completionRate) : '—',
      icon: CheckCircleOutlined,
      tone: 'success',
    },
    {
      key: 'avgDurationSeconds',
      label: '平均耗时',
      value: d ? formatDuration(d.avgDurationSeconds) : '—',
      icon: ClockCircleOutlined,
      tone: 'warning',
    },
    {
      key: 'pendingReviewCount',
      label: '人工复核数量',
      value: d ? String(d.pendingReviewCount) : '—',
      icon: SolutionOutlined,
      tone: 'primary',
    },
  ]
})

const load = async () => {
  loading.value = true
  try {
    const res = await getWorkflowStatsSummary()
    if (res.data.code === 0 && res.data.data) {
      data.value = res.data.data
    } else {
      data.value = null
    }
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="wf-dashboard">
    <div class="wf-dashboard__inner">
      <header class="wf-dashboard__header">
        <h2 class="wf-dashboard__title">诊断运营看板</h2>
        <p class="wf-dashboard__subtitle">工作流整体运行概览</p>
      </header>

      <p v-if="loading" class="wf-dashboard__hint" data-testid="dashboard-loading">
        正在加载运营指标…
      </p>

      <div
        v-else-if="data"
        class="wf-dashboard__grid"
        data-testid="dashboard-metrics"
      >
        <article
          v-for="card in cards"
          :key="card.key"
          class="metric-card"
          :class="`metric-card--${card.tone}`"
          :data-metric="card.key"
        >
          <div class="metric-card__icon">
            <component :is="card.icon" />
          </div>
          <div class="metric-card__body">
            <p class="metric-card__label">{{ card.label }}</p>
            <p class="metric-card__value" :data-testid="`metric-${card.key}`">
              {{ card.value }}
            </p>
          </div>
        </article>
      </div>

      <div v-else class="wf-dashboard__empty" data-testid="dashboard-empty">
        <p class="wf-dashboard__empty-title">暂无数据</p>
        <p class="wf-dashboard__empty-hint">运营指标暂不可用，请稍后重试。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wf-dashboard {
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}
.wf-dashboard__inner {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.wf-dashboard__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wf-dashboard__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 26px;
  color: #141413;
  margin: 0;
}
.wf-dashboard__subtitle {
  font-size: 14px;
  color: #8f8d86;
  margin: 0;
}
.wf-dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.metric-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 1px 2px rgba(20, 20, 19, 0.05);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px rgba(20, 20, 19, 0.07);
}
.metric-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
  background: rgba(201, 100, 66, 0.1);
  color: #c96442;
}
.metric-card--success .metric-card__icon {
  background: rgba(63, 145, 96, 0.12);
  color: #2f7d4f;
}
.metric-card--warning .metric-card__icon {
  background: rgba(212, 167, 44, 0.14);
  color: #9a6700;
}
.metric-card__label {
  font-size: 13px;
  color: #6b6a66;
  margin: 0 0 6px;
}
.metric-card__value {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 28px;
  font-weight: 700;
  color: #141413;
  margin: 0;
  line-height: 1.1;
}
.wf-dashboard__hint {
  color: #8f8d86;
  font-size: 14px;
}
.wf-dashboard__empty {
  background: #faf9f5;
  border: 1px dashed #ded9cb;
  border-radius: 14px;
  padding: 48px 24px;
  text-align: center;
}
.wf-dashboard__empty-title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 18px;
  color: #6b6a66;
  margin: 0 0 6px;
}
.wf-dashboard__empty-hint {
  font-size: 13px;
  color: #8f8d86;
  margin: 0;
}
</style>
