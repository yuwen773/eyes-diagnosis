<template>
  <div class="assistant-message">
    <div class="message-content">
      <div class="message-header">
        <span class="agent-name">SpaceMind</span>
      </div>
      <div class="message-body markdown-body" v-html="finalContent"></div>

      <!-- 内联缩略图 -->
      <div v-if="allImages.length > 0" class="message-images">
        <img
          v-for="(img, index) in allImages"
          :key="index"
          :src="img.url"
          :alt="img.title || '图片'"
          @click="emit('previewImage', img.url)"
        />
      </div>

      <!-- 资源触发按钮 -->
      <button
        v-if="hasResources"
        class="resource-trigger-btn"
        @click="handleToggleResources"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        {{ allImages.length }} 张图片 · {{ imageSourceCount }} 个来源
      </button>

      <!-- 操作按钮栏（类 Grok） -->
      <div class="message-actions">
        <button class="action-icon-btn" title="重新生成" @click="emit('regenerate')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button class="action-icon-btn" title="复制" @click="copyContent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button class="action-icon-btn" title="分享" @click="emit('share')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>
        <button class="action-icon-btn" :class="{ liked: liked }" title="点赞" @click="liked = !liked">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" :fill="liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
        </button>
      </div>

      <div v-if="isLoading" class="typing-cursor" aria-hidden="true">|</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'
import { useDiagramRenderer } from '@/composables/useDiagramRenderer'
import type { ImageResource, LinkResource, ResourceData } from '../types'

interface Props {
  content: string
  isLoading?: boolean
  images?: ImageResource[]
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  isLoading: false,
  images: undefined,
})

const emit = defineEmits<{
  (e: 'previewImage', url: string): void
  (e: 'toggleResources', data: ResourceData): void
  (e: 'regenerate'): void
  (e: 'share'): void
}>()

const { render } = useMarkdown()
const { renderDiagrams, unbindDiagramEvents } = useDiagramRenderer()
const liked = ref(false)

onUnmounted(() => {
  unbindDiagramEvents()
})

// 图表渲染后的最终内容
const finalContent = ref('')

// 渲染图表
const renderWithDiagrams = async (markdownContent: string) => {
  if (!markdownContent) {
    finalContent.value = ''
    return
  }
  // 1. 先 Markdown 渲染
  const htmlContent = render(markdownContent)
  // 2. 后处理图表代码块
  finalContent.value = await renderDiagrams(htmlContent)
}

// 监听 content 变化
watch(
  () => props.content,
  async (newContent) => {
    await renderWithDiagrams(newContent)
  },
  { immediate: true }
)

// 监听 isLoading 变化，loading 结束后重新渲染图表
watch(
  () => props.isLoading,
  async (isLoading) => {
    if (!isLoading && props.content) {
      await renderWithDiagrams(props.content)
    }
  }
)

const isImageUrl = (url: string): boolean => {
  const imageExts = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i
  const imageHosts = ['images.pexels.com', 'images.unsplash.com', 'imgur.com']
  if (imageExts.test(url)) return true
  try {
    const hostname = new URL(url).hostname
    if (imageHosts.some(h => hostname.includes(h))) return true
  } catch { /* invalid url */ }
  return false
}

const extractedImages = computed(() => {
  const images: ImageResource[] = []
  for (const match of props.content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    images.push({ url: match[2], title: match[1] || undefined })
  }
  for (const match of props.content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
    if (isImageUrl(match[2])) {
      images.push({ url: match[2], title: match[1] })
    }
  }
  return images
})

const allImages = computed(() => {
  const seen = new Set<string>()
  const result: ImageResource[] = []
  const sources = [...(props.images || []), ...extractedImages.value]
  for (const img of sources) {
    if (!seen.has(img.url)) {
      seen.add(img.url)
      result.push(img)
    }
  }
  return result
})

const imageSourceCount = computed(() => {
  const domains = new Set<string>()
  for (const img of allImages.value) {
    try {
      domains.add(new URL(img.url).hostname)
    } catch { /* invalid url */ }
  }
  return domains.size
})

function getExtractedLinks() {
  const seen = new Set<string>()
  const links: LinkResource[] = []
  for (const match of props.content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
    const url = match[2]
    if (seen.has(url)) continue
    seen.add(url)
    try {
      links.push({ url, title: match[1], snippet: match[1], domain: new URL(url).hostname })
    } catch { /* invalid url */ }
  }
  return links
}

const handleToggleResources = () => {
  emit('toggleResources', {
    images: allImages.value,
    links: getExtractedLinks(),
  })
}

const hasResources = computed(() =>
  allImages.value.length > 0 || imageSourceCount.value > 0
)

const copyContent = async () => {
  try {
    await navigator.clipboard.writeText(props.content)
  } catch {
    // fallback
  }
}
</script>

<style scoped>
.assistant-message {
  display: flex;
  align-items: flex-start;
  padding: 8px 16px;
}

.message-content {
  max-width: min(680px, 100%);
  padding: 10px 16px;
  border-radius: 18px 18px 18px 4px;
  border: 1px solid var(--color-border-subtle);
  position: relative;
}

[data-theme="aurora"] .message-content {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-default);
}

[data-theme="pop"] .message-content {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-subtle);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.agent-name {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary-500);
  letter-spacing: -0.01em;
}

.message-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-primary);
  word-break: break-word;
  padding-left: 2px;
}

/* Markdown styles */
.markdown-body :deep(p) {
  margin: 0 0 8px 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 12px 0 8px 0;
}

.markdown-body :deep(h1):first-child,
.markdown-body :deep(h2):first-child,
.markdown-body :deep(h3):first-child {
  margin-top: 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 8px 0;
  padding-left: 20px;
}

.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding-left: 12px;
  border-left: 3px solid var(--color-border-default);
  color: var(--color-text-secondary);
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(a) {
  color: var(--color-primary-500);
  text-decoration: none;
  font-weight: 500;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(code:not(.hljs)) {
  background: var(--color-bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: var(--font-mono);
}

/* ============ 代码块样式 - 双主题适配 ============ */
.markdown-body :deep(.hljs.code-block) {
  position: relative;
  background: var(--color-bg-tertiary);
  border-radius: 10px;
  margin: 12px 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.markdown-body :deep(.hljs.code-block:hover) {
  border-color: var(--color-border-default);
  box-shadow: var(--shadow-md);
}

/* 语言标签 */
.markdown-body :deep(.code-lang) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-primary-500);
  padding: 3px 8px;
  background: var(--color-bg-tertiary);
  border-radius: 4px;
  border: 1px solid var(--color-border-subtle);
}

/* 复制按钮 */
.markdown-body .code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border-subtle);
}

.markdown-body :deep(.copy-btn) {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 14px !important;
  background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%) !important;
  border: none !important;
  color: #fff !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(168, 85, 247, 0.4);
}

.markdown-body :deep(.copy-btn:hover) {
  box-shadow: 0 4px 16px rgba(168, 85, 247, 0.5) !important;
}

.markdown-body :deep(.copy-btn.copied) {
  background: var(--color-success) !important;
}

/* 代码内容 */
.markdown-body :deep(.hljs.code-block code) {
  display: block;
  padding: 14px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
  font-family: var(--font-mono);
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-default) transparent;
}

.markdown-body :deep(.hljs.code-block code::-webkit-scrollbar) {
  height: 5px;
}

.markdown-body :deep(.hljs.code-block code::-webkit-scrollbar-track) {
  background: transparent;
}

.markdown-body :deep(.hljs.code-block code::-webkit-scrollbar-thumb) {
  background: var(--color-border-default);
  border-radius: 3px;
}

/* ============ 图表渲染样式 - 双主题适配 ============ */
.markdown-body :deep(.diagram-wrapper) {
  position: relative;
  margin: 12px 0;
  background: var(--color-bg-secondary);
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.markdown-body :deep(.diagram-wrapper:hover) {
  border-color: var(--color-border-default);
  box-shadow: var(--shadow-md);
}

/* 图表 tab 容器 */
.markdown-body :deep(.diagram-tabs) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--color-bg-tertiary);
  border-bottom: 1px solid var(--color-border-subtle);
}

.markdown-body :deep(.diagram-tabs-left) {
  display: flex;
  gap: 4px;
}

.markdown-body :deep(.diagram-tab) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.markdown-body :deep(.diagram-tab:hover) {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.markdown-body :deep(.diagram-tab.active) {
  background: var(--color-primary-500);
  color: #fff;
  border-color: var(--color-primary-500);
}

/* 图表内容区 */
.markdown-body :deep(.diagram-content) {
  padding: 16px;
}

.markdown-body :deep(.diagram-preview) {
  overflow-x: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: 6px;
  border: 1px dashed var(--color-border-subtle);
}

.markdown-body :deep(.diagram-preview svg),
.markdown-body :deep(.diagram-preview img) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
  border-radius: 4px;
}

/* Mermaid SVG 样式增强 */
.markdown-body :deep(.diagram-preview svg) {
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.1));
}

/* PlantUML 图片 */
.markdown-body :deep(.plantuml-diagram) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* draw.io iframe */
.markdown-body :deep(.drawio-iframe) {
  width: 100%;
  min-height: 250px;
  border: none;
  border-radius: 6px;
  background: #fff;
}

/* 图表代码面板 */
.markdown-body :deep(.diagram-code) {
  display: none;
  overflow-x: auto;
}

.markdown-body :deep(.diagram-code pre.code-block) {
  margin: 0;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.markdown-body :deep(.diagram-code pre.code-block code) {
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text-secondary);
}

/* 图表错误状态 */
.markdown-body :deep(.diagram-error) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 6px;
  color: var(--color-error);
  font-size: 13px;
}

/* draw.io 占位符 */
.markdown-body :deep(.drawio-placeholder) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}

.markdown-body :deep(.drawio-hint) {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 14px;
}

.markdown-body :deep(.drawio-placeholder p) {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.markdown-body :deep(.drawio-open-btn) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--color-primary-500);
  color: #fff;
  border-radius: 6px;
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
  box-shadow: 0 2px 8px rgba(168, 85, 247, 0.25);
}

.markdown-body :deep(.drawio-open-btn:hover) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(168, 85, 247, 0.35);
}

.typing-cursor {
  display: inline;
  animation: blink 1s step-end infinite;
  color: var(--color-primary-500);
  font-weight: 300;
  margin-left: 1px;
}

@keyframes blink {
  50% { opacity: 0; }
}

/* 内联缩略图 */
.message-images {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.message-images img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.15s ease;
  border: 1px solid var(--color-border-subtle);
}

.message-images img:hover {
  transform: scale(1.05);
}

/* 资源触发按钮 */
.resource-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding: 5px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.resource-trigger-btn:hover {
  border-color: var(--color-primary-500);
  color: var(--color-primary-500);
}

/* 操作按钮栏 */
.message-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-subtle);
}

.action-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-icon-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.action-icon-btn.liked {
  color: var(--color-primary-500);
}
</style>
