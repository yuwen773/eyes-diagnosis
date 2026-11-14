<script setup lang="ts">
/**
 * 把协作消息里的结构化上下文/结果渲染成可读的键值树。
 * 只做展示：未知键原样显示，长数组默认折叠，原始 JSON 仍由调用方另行提供。
 */
import { computed } from 'vue'

const props = defineProps<{ value: unknown; label?: string; depth?: number }>()
const level = computed(() => props.depth ?? 0)

const LABELS: Record<string, string> = {
  snapshotDigest: '快照摘要', predictedLabel: '预测标签', probability: '模型概率',
  qualityScore: '质量分', qualityReasons: '质量原因', calibrationStatus: '校准状态',
  modelVersion: '模型版本', preprocessVersion: '预处理版本',
  summary: '摘要', limitations: '限制', reanalysisSuggestion: '再分析建议',
  search: '检索', query: '查询', citations: '引用',
  inference: '推理摘要', vision: '图像信息整理', evidence: '冻结证据', version: '版本',
  title: '资料', source: '来源', chunkIndex: '片段', excerpt: '原文',
  feedback: '反馈', previousDraft: '上一版草稿', draft: '当前草稿',
  claims: '声明', id: '编号', section: '区段', text: '说明', references: '引用',
  citationIndex: '引用序号', quote: '引文', action: '结论', objections: '异议',
  target: '指向', reason: '理由', evidenceVersion: '证据版本',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const entries = computed(() => isObject(props.value) ? Object.entries(props.value) : [])
const primitiveArray = computed(() =>
  Array.isArray(props.value) && props.value.every(item => !isObject(item) && !Array.isArray(item)))

function labelOf(key: string) {
  return LABELS[key] ?? key
}
</script>

<template>
  <div class="tv" :class="{ nested: level > 0 }">
    <span v-if="value === null || value === undefined" class="tv-null">—</span>

    <ul v-else-if="Array.isArray(value) && primitiveArray" class="tv-list">
      <li v-for="(item, index) in value" :key="index">{{ item }}</li>
    </ul>

    <details v-else-if="Array.isArray(value) && value.length > 2" class="tv-group">
      <summary>{{ label || '条目' }} · {{ value.length }} 条</summary>
      <div v-for="(item, index) in value" :key="index" class="tv-item">
        <TraceValue :value="item" :depth="level + 1" />
      </div>
    </details>

    <div v-else-if="Array.isArray(value)" class="tv-items">
      <div v-for="(item, index) in value" :key="index" class="tv-item">
        <TraceValue :value="item" :depth="level + 1" />
      </div>
    </div>

    <dl v-else-if="isObject(value)" class="tv-pairs">
      <div v-for="[key, child] in entries" :key="key" class="tv-pair">
        <dt>{{ labelOf(key) }}</dt>
        <dd><TraceValue :value="child" :label="labelOf(key)" :depth="level + 1" /></dd>
      </div>
    </dl>

    <span v-else-if="typeof value === 'number'" class="mono">{{ value }}</span>

    <span v-else class="tv-text">{{ value }}</span>
  </div>
</template>

<style scoped>
.tv { min-width: 0; }
.tv-null { color: var(--iris-ink-3); }
.mono { font-family: 'JetBrains Mono', Consolas, monospace; }
.tv-text { overflow-wrap: anywhere; }
.tv-pairs { margin: 0; }
.tv-pair { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; padding: 5px 0; border-top: 1px dashed var(--iris-line); }
/* 嵌套层不再并排：标签窄列会把长文本挤成一字一行。 */
.tv.nested .tv-pair { grid-template-columns: 1fr; gap: 1px; }
.tv.nested dt { font-size: 11px; padding-top: 0; }
.tv-pair:first-child { border-top: 0; }
dt { font-size: 12px; color: var(--iris-ink-3); padding-top: 2px; }
dd { margin: 0; font-size: 13px; line-height: 1.6; color: var(--iris-ink); }
.tv-list { margin: 0; padding-left: 16px; font-size: 13px; line-height: 1.6; }
.tv-items, .tv-item { display: grid; gap: 6px; }
.tv-item { padding: 6px 10px; border-left: 1px solid var(--iris-line); }
.tv-group { border: 0; padding: 0; }
.tv-group summary { cursor: pointer; font-size: 12px; color: var(--iris-ink-2); padding: 4px 0; }
</style>
