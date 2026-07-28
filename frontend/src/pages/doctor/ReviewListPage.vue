<script setup lang="ts">
/**
 * 医生审核任务列表 /doctor/reviews
 * 数据：GET /api/reviews/tasks（后端契约仅下发 taskId / workflowId / reason）。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listTasks, REVIEW_TYPE_LABELS, type ReviewTaskSummaryVO } from '@/api/review'

const router = useRouter()

const tasks = ref<ReviewTaskSummaryVO[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

const load = async () => {
  loading.value = true
  loadError.value = null
  try {
    const res = await listTasks()
    if (res.data.code === 0 && res.data.data) {
      tasks.value = res.data.data
    } else {
      loadError.value = res.data.msg || '无法加载待审核任务'
    }
  } catch {
    loadError.value = '网络异常，无法加载待审核任务'
  } finally {
    loading.value = false
  }
}

const openTask = (task: ReviewTaskSummaryVO) => {
  router.push({
    path: `/doctor/reviews/${task.taskId}`,
    query: { workflowId: task.workflowId, reason: task.reason },
  })
}

onMounted(load)
</script>

<template>
  <div class="review-list">
    <div class="review-list__inner">
      <header class="review-list__header">
        <div>
          <h2 class="review-list__title">待审核任务</h2>
          <p class="review-list__subtitle">以下诊断流程正在等待医生人工复核</p>
        </div>
        <button type="button" class="review-list__refresh" data-testid="refresh-tasks" @click="load">
          刷新
        </button>
      </header>

      <p v-if="loading" class="review-list__hint">正在加载…</p>
      <p v-else-if="loadError" class="review-list__error" data-testid="tasks-error">{{ loadError }}</p>

      <template v-else>
        <p v-if="tasks.length === 0" class="review-list__hint" data-testid="tasks-empty">
          当前没有待处理的审核任务
        </p>

        <table v-else class="review-table" data-testid="tasks-table">
          <thead>
            <tr>
              <th>任务 ID</th>
              <th>诊断工作流</th>
              <th>审核类型</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.taskId" :data-task-id="task.taskId">
              <td class="review-table__mono">{{ task.taskId }}</td>
              <td class="review-table__mono">{{ task.workflowId }}</td>
              <td>
                <span class="review-table__reason" :data-reason="task.reason">
                  {{ REVIEW_TYPE_LABELS[task.reason] ?? task.reason }}
                </span>
              </td>
              <td>
                <button type="button" class="review-table__open" data-testid="open-task" @click="openTask(task)">
                  处理
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>

<style scoped>
.review-list {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}
.review-list__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
.review-list__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 24px;
  color: #141413;
  margin: 0 0 4px;
}
.review-list__subtitle {
  font-size: 14px;
  color: #6b6a66;
  margin: 0;
}
.review-list__refresh {
  border: 1px solid #ded9cb;
  background: #fff;
  color: #6b6a66;
  border-radius: 10px;
  padding: 7px 18px;
  font-size: 13px;
  cursor: pointer;
}
.review-list__refresh:hover {
  border-color: #c96442;
  color: #c96442;
}
.review-list__hint {
  color: #8f8d86;
  font-size: 14px;
}
.review-list__error {
  color: #b53333;
  font-size: 14px;
}
.review-table {
  width: 100%;
  border-collapse: collapse;
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  overflow: hidden;
}
.review-table th {
  text-align: left;
  font-size: 13px;
  color: #6b6a66;
  font-weight: 600;
  padding: 12px 16px;
  background: #f0efe8;
}
.review-table td {
  padding: 12px 16px;
  font-size: 14px;
  color: #141413;
  border-top: 1px solid #eeece3;
}
.review-table__mono {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  word-break: break-all;
}
.review-table__reason {
  font-size: 13px;
  color: #9a6700;
  background: rgba(212, 167, 44, 0.12);
  border-radius: 999px;
  padding: 2px 10px;
}
.review-table__open {
  background: #c96442;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
}
.review-table__open:hover {
  background: #b5502f;
}
</style>
