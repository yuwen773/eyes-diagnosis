<template>
  <div class="resource-panel">
    <!-- 面板头部 -->
    <div class="panel-header">
      <div class="panel-title-group">
        <h3 class="panel-title">资源</h3>
        <span v-if="totalCount > 0" class="panel-count">{{ totalCount }}</span>
      </div>
      <button class="close-btn" @click="emit('close')" aria-label="关闭面板">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- 统计行 -->
    <div v-if="totalCount > 0" class="panel-stats">
      <span>搜索了 {{ totalCount }} 个资源</span>
    </div>

    <!-- Tab 切换 -->
    <div v-if="totalCount > 0" class="panel-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.count > 0" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <!-- Tab 内容 -->
    <div class="panel-body">
      <!-- 空状态 -->
      <div v-if="totalCount === 0" class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p>暂无资源</p>
        <span>Agent 搜索的图片和链接将展示在这里</span>
      </div>

      <!-- 图片 Tab -->
      <div v-else-if="activeTab === 'image'" class="image-grid">
        <div
          v-for="(img, index) in images"
          :key="index"
          class="image-item"
          @click="emit('previewImage', img.url)"
        >
          <img :src="img.url" :alt="img.title || '图片'" loading="lazy" />
          <div class="image-overlay">
            <button class="overlay-btn" @click.stop="emit('downloadImage', img.url)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 链接 Tab -->
      <div v-else-if="activeTab === 'link'" class="link-list">
        <a
          v-for="(link, index) in links"
          :key="index"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="link-card"
        >
          <div class="link-title">{{ link.title }}</div>
          <div class="link-snippet">{{ link.snippet }}</div>
          <div class="link-domain">{{ link.domain }}</div>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ImageResource, LinkResource } from './types'

export type { ImageResource, LinkResource }

interface Props {
  images?: ImageResource[]
  links?: LinkResource[]
}

const props = withDefaults(defineProps<Props>(), {
  images: () => [],
  links: () => [],
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'previewImage', url: string): void
  (e: 'downloadImage', url: string): void
}>()

const activeTab = ref<'image' | 'link'>('image')

const tabs = computed(() => [
  { key: 'image' as const, label: '图片', count: props.images.length },
  { key: 'link' as const, label: '链接', count: props.links.length },
])

const totalCount = computed(() => props.images.length + props.links.length)
</script>

<style scoped>
.resource-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.panel-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.panel-count {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--color-primary-500);
  color: white;
}

.close-btn {
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

.close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.panel-stats {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.panel-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: var(--color-bg-elevated);
  color: var(--color-primary-500);
}

.tab-count {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--color-bg-hover);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 40px 20px;
}

.empty-state svg {
  opacity: 0.4;
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin: 0;
}

.empty-state span {
  font-size: 12px;
}

/* Image grid */
.image-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.image-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  background: var(--color-bg-tertiary);
}

.image-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s ease;
}

.image-item:hover img {
  transform: scale(1.04);
}

.image-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.image-item:hover .image-overlay {
  opacity: 1;
}

.overlay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
  color: white;
  cursor: pointer;
  transition: background 0.15s ease;
}

.overlay-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Link list */
.link-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-elevated);
  text-decoration: none;
  transition: all 0.15s ease;
}

.link-card:hover {
  border-color: var(--color-primary-500);
  transform: translateY(-1px);
}

.link-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-snippet {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-domain {
  font-size: 11px;
  color: var(--color-text-tertiary);
}
</style>
