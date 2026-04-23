<template>
  <div class="reasoning-message">
    <button class="reasoning-header" @click="collapsed = !collapsed">
      <span class="reasoning-icon" :class="{ collapsed }">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
      <span class="reasoning-label">思考过程</span>
      <span v-if="collapsed" class="reasoning-preview">{{ preview }}</span>
    </button>
    <div v-show="!collapsed" class="reasoning-content">
      <div class="markdown-body" v-html="renderedContent"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'

interface Props {
  content: string
}

const props = defineProps<Props>()

const { render } = useMarkdown()
const collapsed = ref(false)
const renderedContent = computed(() => render(props.content))
const preview = computed(() => props.content.slice(0, 50) + (props.content.length > 50 ? '...' : ''))
</script>

<style scoped>
.reasoning-message {
  margin: 4px 16px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-subtle);
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.reasoning-header:hover {
  color: var(--color-text-primary);
}

.reasoning-icon {
  display: flex;
  transition: transform 0.2s ease;
}

.reasoning-icon.collapsed {
  transform: rotate(-90deg);
}

.reasoning-label {
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.reasoning-preview {
  margin-left: 8px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  opacity: 0.7;
}

.reasoning-content {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-subtle);
}

.markdown-body {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  padding-left: 2px;
}

.markdown-body :deep(p) {
  margin: 0 0 4px 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(code) {
  background: var(--color-bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 4px 0;
  padding-left: 16px;
}
</style>
