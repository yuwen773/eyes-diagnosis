<script setup lang="ts">
import type { ReviewAuditEntry } from '@/api/reviewController'
defineProps<{ entries: ReviewAuditEntry[] }>()
const labels: Record<string, string> = { FINAL_REVIEW_CLAIMED: '医生领取最终复核',
  FINAL_REVIEW_SUBMITTED: '医生提交最终决定', EXPLANATION_PUBLISHED: '解释已发布',
  EXPLANATION_WITHHELD: '解释已扣留' }
</script>
<template>
  <details v-if="entries.length" class="review-audit">
    <summary>复核与发布审计</summary>
    <ul class="audit-list">
      <li v-for="entry in entries" :key="entry.eventId">
        {{ labels[entry.eventType] ?? entry.eventType }} · {{ entry.occurredAt }} · 工作流版本 {{ entry.workflowVersion }}
      </li>
    </ul>
  </details>
</template>
<style scoped>
.review-audit { margin: 1rem 0; font-size: .85rem; overflow-wrap: anywhere; }
.audit-list { padding-left: 1.25rem; line-height: 1.8; }
</style>
