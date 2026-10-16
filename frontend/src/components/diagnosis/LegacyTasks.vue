<script setup lang="ts">
import { useLegacyTasks } from '@/composables/useLegacyTasks'
import LegacyTaskDetail from './LegacyTaskDetail.vue'

const { records, selected, total, current, loading, error, refresh } = useLegacyTasks()
</script>

<template>
  <section class="legacy-tasks">
    <h1 class="page-title">旧版任务（只读）</h1>
    <p class="intro">历史任务保留原状态与来源。查看和刷新不会执行任务或保存诊断。</p>
    <nav class="category-links" aria-label="诊断记录类型">
      <RouterLink to="/user/userCenter/diagnosisHistory">已保存的正式诊断记录</RouterLink>
      <RouterLink to="/diagnosis">当前 Python 工作流</RouterLink>
    </nav>
    <button type="button" data-test="refresh" :disabled="loading" @click="refresh">{{ loading ? '加载中…' : '刷新旧任务' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!loading && !records.length">暂无可查看的旧版任务。</p>
    <ul class="task-list" aria-label="旧版任务列表">
      <li v-for="task in records" :key="`${task.sourceType}:${task.taskId}`" class="task-row">
        <RouterLink :to="{ path: '/diagnosis/legacy', query: { source: task.sourceType, task: task.taskId } }">{{ task.taskId }}</RouterLink>
        <span>{{ task.sourceType === 'upload' ? '旧版上传任务' : '旧版诊断工作流' }} · 原状态 {{ task.status }}</span>
        <time>{{ task.createdAt ?? '旧版未记录时间' }}</time>
      </li>
    </ul>
    <div v-if="total > 20" class="pagination">
      <button type="button" :disabled="current === 1 || loading" @click="current--">上一页</button>
      <span>第 {{ current }} 页，共 {{ total }} 条</span>
      <button type="button" :disabled="current * 20 >= total || loading" @click="current++">下一页</button>
    </div>
    <LegacyTaskDetail v-if="selected" :key="`${selected.sourceType}:${selected.taskId}`" :task="selected" />
  </section>
</template>

<style scoped>
.legacy-tasks { max-width: 960px; margin: 0 auto; padding: clamp(1rem, 4vw, 2.5rem); color: var(--claude-text-primary); }
.page-title { font: 1.8rem Georgia, serif; margin: 0 0 .8rem; }
.intro { color: var(--claude-text-secondary); line-height: 1.7; }
.category-links { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
.task-list { list-style: none; padding: 0; }
.task-row { display: grid; gap: .5rem; padding: 1rem 0; border-bottom: 1px solid var(--claude-border, #d9d0c6); overflow-wrap: anywhere; }
.task-row time { color: var(--claude-text-secondary); font-size: .85rem; }
.legacy-tasks button { padding: .5rem 1rem; border: 1px solid var(--claude-border, #d9d0c6); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
.legacy-tasks button:disabled { opacity: .55; cursor: default; }
.pagination { display: flex; gap: 1rem; align-items: center; }
</style>
