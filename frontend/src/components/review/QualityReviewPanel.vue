<script setup lang="ts">
import { useQualityReviews } from '@/composables/useQualityReviews'
import ReviewTaskList from './ReviewTaskList.vue'
import QualityReviewDetail from './QualityReviewDetail.vue'
const { tasks, detail, busy, error, select, refresh, act } = useQualityReviews()
</script>

<template>
  <main class="quality-review" :aria-busy="busy">
    <h1 class="review-title">医生质量复核</h1>
    <p class="review-note">这是医生复核，不是用户保存授权。允许继续不等于确认疾病预测，也不会自动保存正式诊断记录。</p>
    <button type="button" class="refresh" :disabled="busy" @click="refresh">{{ busy ? '正在加载…' : '刷新复核任务' }}</button>
    <p v-if="error" class="review-error" role="alert">{{ error }}</p>
    <section v-if="detail?.supplementaryNotes?.length" aria-label="用户补充说明">
      <h2>用户补充说明</h2>
      <p v-for="(note, index) in detail.supplementaryNotes" :key="index" class="supplement-note">{{ note }}</p>
    </section>
    <div class="review-columns">
      <ReviewTaskList :tasks="tasks" :selected-id="detail?.reviewTaskId" :busy="busy" @select="select" />
      <QualityReviewDetail v-if="detail" :key="detail.reviewTaskId" :task="detail" :busy="busy" @claim="act()" @submit="act" />
      <p v-else-if="!error && !busy">请选择一个质量复核任务查看图片与来源。</p>
    </div>
    <p class="review-note">列表最多显示 100 项待处理任务；处理后刷新可继续查看其余任务。</p>
  </main>
</template>

<style scoped>
.quality-review { max-width: 1100px; margin: 0 auto; padding: clamp(1rem, 4vw, 2.5rem); color: var(--claude-text-primary); }
.review-title { font-family: Georgia, serif; font-size: 1.75rem; }
.review-note { color: var(--claude-text-secondary); line-height: 1.8; }
.review-columns { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 2rem; margin-top: 1.5rem; }
.refresh { padding: .5rem 1rem; border: 1px solid var(--claude-border, #d9d0c6); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.review-error { color: var(--claude-error, #aa382d); }
.supplement-note { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
@media (max-width: 700px) { .review-columns { grid-template-columns: 1fr; } }
</style>
