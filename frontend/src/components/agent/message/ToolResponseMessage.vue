<template>
  <div class="tool-response">
    <div class="tool-header" @click="toggleExpand">
      <div class="tool-meta">
        <span class="tool-badge">返回</span>
        <span class="tool-name">{{ toolName }}</span>
      </div>
      <span class="expand-icon" :class="{ expanded: isExpanded }" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </div>

    <transition name="collapse">
      <div v-if="isExpanded" class="tool-content">
        <pre class="content-pre"><code v-html="highlightedContent"></code></pre>
      </div>
    </transition>

    <button
      v-if="content.length > 120 && !isExpanded"
      class="expand-trigger"
      @click.stop="toggleExpand"
    >
      展开详情
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { highlightJson } from '@/utils/jsonHighlight'

interface Props {
  toolName: string
  content: string
}

const props = withDefaults(defineProps<Props>(), {
  toolName: '',
  content: '',
})

const isExpanded = ref(props.content.length <= 120)

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const highlightedContent = computed(() => {
  return highlightJson(props.content)
})
</script>

<style scoped>
.tool-response {
  max-width: min(400px, 100%);
  margin: 6px 16px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s;
}

.tool-header:hover {
  opacity: 0.75;
}

.tool-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-success);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.tool-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.expand-icon {
  color: var(--color-text-tertiary);
  transition: transform 0.2s ease;
  display: flex;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.tool-content {
  padding: 0 14px 10px;
}

.content-pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
}

.expand-trigger {
  display: block;
  width: 100%;
  padding: 6px 0;
  border: none;
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-primary-500);
  cursor: pointer;
  transition: color 0.15s;
}

.expand-trigger:hover {
  color: var(--color-primary-400, var(--color-primary-500));
}

/* Collapse transition */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

/* JSON Syntax Colors */
:deep(.json-key) { color: #7dd3fc; }
:deep(.json-str) { color: #86efac; }
:deep(.json-num) { color: #c4b5fd; }
:deep(.json-bool) { color: #f9a8d4; }
:deep(.json-null) { color: #f87171; }
:deep(.json-bracket) { color: #94a3b8; }
:deep(.json-comma) { color: #94a3b8; }
:deep(.json-sep) { color: #94a3b8; }
</style>
