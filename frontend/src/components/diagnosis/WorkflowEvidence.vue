<script setup lang="ts">
import type { WorkflowEvidenceView } from '@/api/workflowController'

defineProps<{ evidence: WorkflowEvidenceView }>()
</script>

<template>
  <section class="workflow-evidence" aria-label="任务参考资料">
    <h4>{{ evidence.status === 'SUFFICIENT' ? '一般参考资料' : '证据不足' }}</h4>
    <p v-if="evidence.status === 'INSUFFICIENT'">
      当前没有足够的已审核参考资料，本次不提供基于资料的完整解释。
      <span v-if="evidence.reasonCode === 'RETRIEVAL_UNAVAILABLE'">参考资料检索暂不可用。</span>
      <span v-if="evidence.reasonCode === 'SOURCE_NO_LONGER_APPROVED'">原参考资料已撤回或审核属性已变更。</span>
    </p>
    <p v-if="evidence.attempts === 2">已尝试一次查询改写，检索范围保持一致。</p>
    <ul v-if="evidence.citations.length">
      <li v-for="citation in evidence.citations" :key="citation.citationId">
        <strong>{{ citation.title }}</strong>
        <p>来源：{{ citation.source }}</p>
        <p>引用：<code>{{ citation.citationId }}</code> · 审核版本 {{ citation.sourceRevision }}</p>
        <details><summary>引用内容校验标识</summary><code>{{ citation.quotedTextDigest }}</code></details>
      </li>
    </ul>
    <p class="reference-note">参考资料仅支持一般性说明，不证明本人的疾病或概率。</p>
  </section>
</template>

<style scoped>
.workflow-evidence { margin-top: 1rem; border-top: 1px solid var(--claude-border-warm); padding-top: 1rem; line-height: 1.7; }
.workflow-evidence h4 { margin: 0; }
.workflow-evidence li { margin-bottom: .8rem; overflow-wrap: anywhere; }
.workflow-evidence p { margin: .4rem 0; }
.reference-note { color: var(--claude-text-secondary); font-size: .85rem; }
</style>
