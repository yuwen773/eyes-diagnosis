<template>
  <div class="tool-requests">
    <div
      v-for="(call, idx) in parsedCalls"
      :key="idx"
      class="tool-card"
    >
      <!-- Card Header -->
      <div class="tool-card-header">
        <span class="tool-icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </span>
        <span class="tool-name">{{ call.name }}</span>
        <span class="tool-tag">调用</span>
      </div>

      <!-- Args Display -->
      <div class="tool-args">
        <template v-if="isEmptyArgs(call.args)">
          <span class="empty-args">{ }</span>
        </template>
        <template v-else>
          <div
            v-for="(val, key) in call.args"
            :key="key"
            class="arg-row"
          >
            <span class="arg-key">{{ key }}</span>
            <span class="arg-sep">:</span>
            <span class="arg-value" v-html="highlightJsonValue(val)"></span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCallArg } from '@/composables/useAgentStream'
import { highlightJsonValue } from '@/utils/jsonHighlight'

interface ToolCall {
  name: string
  args: Record<string, any>
}

interface Props {
  toolName?: string
  content?: string
  toolCalls?: ToolCallArg[]
}

const props = withDefaults(defineProps<Props>(), {
  toolName: 'Tool',
  content: '',
  toolCalls: () => [],
})

const parsedCalls = computed<ToolCall[]>(() => {
  if (props.toolCalls && props.toolCalls.length > 0) {
    return props.toolCalls
  }
  if (props.content) {
    return parseRawContent(props.content)
  }
  if (props.toolName) {
    return [{ name: props.toolName, args: {} }]
  }
  return []
})

const parseRawContent = (raw: string): ToolCall[] => {
  const results: ToolCall[] = []
  const pattern = /([a-zA-Z_]\w*)\s*:\s*(\{[\s\S]*?\}(?=\s*[a-zA-Z_]\w*:|$)|"[^"]*")/g
  let match
  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].trim()
    const argsStr = match[2].trim()
    try {
      if (argsStr.startsWith('{')) {
        results.push({ name, args: JSON.parse(argsStr) })
      } else {
        results.push({ name, args: { value: argsStr.replace(/^"|"$/g, '') } })
      }
    } catch {
      results.push({ name, args: { _raw: argsStr } })
    }
  }
  if (results.length === 0 && raw.trim()) {
    const nameMatch = raw.match(/^([a-zA-Z_]\w*)\s*:/)
    if (nameMatch) {
      const name = nameMatch[1]
      const rest = raw.slice(name.length + 1).trim()
      results.push({ name, args: { _raw: rest } })
    }
  }
  return results
}

const isEmptyArgs = (args: Record<string, any>) => {
  return Object.keys(args).length === 0
}
</script>

<style scoped>
.tool-requests {
  margin: 4px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-card {
  max-width: min(400px, 100%);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
  transition: border-color 0.15s;
}

.tool-card:hover {
  border-color: var(--color-border-default);
}

/* Header */
.tool-card-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: rgba(59, 130, 246, 0.06);
}

.tool-icon {
  display: flex;
  color: var(--color-info);
  flex-shrink: 0;
}

.tool-name {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-info);
  letter-spacing: 0.01em;
}

.tool-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-left: auto;
  opacity: 0.6;
}

/* Args */
.tool-args {
  padding: 8px 12px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
}

.arg-row {
  display: flex;
  gap: 0;
  align-items: baseline;
  flex-wrap: wrap;
  row-gap: 1px;
}

.arg-key {
  color: var(--color-accent-cyan);
  font-weight: 500;
  white-space: nowrap;
}

.arg-sep {
  color: var(--color-text-tertiary);
  margin: 0 2px;
}

.arg-value {
  color: var(--color-text-secondary);
  word-break: break-word;
  flex: 1;
  min-width: 0;
}

.empty-args {
  color: var(--color-text-disabled);
  font-size: 12px;
  font-family: var(--font-mono);
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
:deep(.json-count) { color: #64748b; font-size: 10.5px; margin-left: 2px; }
:deep(.json-more) { color: #64748b; font-style: italic; }
</style>
