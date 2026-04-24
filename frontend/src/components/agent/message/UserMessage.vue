<template>
  <div class="user-message">
    <div class="message-content">
      <div v-if="textContent" class="message-text">{{ textContent }}</div>
      <div class="message-time">{{ displayTime }}</div>
    </div>

    <!-- 图片网格：气泡下方，右对齐 -->
    <div v-if="displayImages.length > 0" class="message-images" :class="`grid-${Math.min(displayImages.length, 4)}`">
      <div v-for="(img, i) in displayImages" :key="i" class="img-thumb" @click="openPreview(img.url)">
        <img :src="img.url" alt="附件图片" />
        <div class="img-zoom-hint">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>
      <div v-if="extraCount > 0" class="img-more">+{{ extraCount }}</div>
    </div>

    <!-- Lightbox preview -->
    <ImagePreview v-model:open="previewOpen" :url="previewUrl" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ImagePreview from '@/components/ImagePreview.vue'

interface Props {
  content: string
  time?: string
  images?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  time: '',
  images: () => [],
})

const IMAGE_TAG_REGEX = /<image-analysis>([^<]+)<\/image-analysis>/g

interface ParsedImage {
  url: string
}

const isSafeUrl = (url: string): boolean => {
  return /^https?:\/\//i.test(url.trim())
}

const parsedImages = computed<ParsedImage[]>(() => {
  if (!props.content) return []
  const urls: ParsedImage[] = []
  const regex = new RegExp(IMAGE_TAG_REGEX.source, 'g')
  let match
  while ((match = regex.exec(props.content)) !== null) {
    const url = match[1].trim()
    if (isSafeUrl(url)) {
      urls.push({ url })
    }
  }
  return urls
})

const displayImages = computed(() => parsedImages.value.slice(0, 4))
const extraCount = computed(() => Math.max(0, parsedImages.value.length - 4))
const previewOpen = ref(false)
const previewUrl = ref('')

const openPreview = (url: string) => {
  previewUrl.value = url
  previewOpen.value = true
}

// 过滤掉 <image-analysis> 标签，只展示纯文字
const textContent = computed(() => {
  if (!props.content) return ''
  return props.content.replace(IMAGE_TAG_REGEX, '').trim()
})

const displayTime = computed(() => {
  if (props.time) return props.time
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})
</script>

<style scoped>
.user-message {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 8px 16px;
  gap: 4px;
}

.message-content {
  max-width: 70%;
  padding: 10px 16px 8px;
  /* 深空霓虹气泡：深色底 + 顶部微光 + 左侧描边 */
  background: var(--color-bg-elevated);
  border: 1px solid;
  border-color: transparent;
  border-radius: 18px 18px 4px 18px;
  position: relative;
  overflow: hidden;
  word-break: break-word;
}

/* 顶部渐变光带 — 模拟深空霓虹 */
.message-content::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(34, 104, 245, 0.5) 20%,
    rgba(110, 53, 235, 0.5) 50%,
    rgba(168, 85, 247, 0.3) 80%,
    transparent 100%
  );
  pointer-events: none;
}

/* 左侧边缘微光 */
.message-content::after {
  content: '';
  position: absolute;
  top: 8px;
  left: 0;
  bottom: 8px;
  width: 1.5px;
  background: linear-gradient(
    180deg,
    rgba(34, 104, 245, 0.4) 0%,
    rgba(110, 53, 235, 0.2) 50%,
    transparent 100%
  );
  border-radius: 1px;
  pointer-events: none;
}

.message-text {
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-text-primary);
  padding: 2px 0;
}

.message-time {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}

/* ============ Image Grid ============ */
.message-images {
  display: inline-grid;
  gap: 4px;
  margin-bottom: 6px;
  border-radius: 12px;
  overflow: hidden;
}

.message-images.grid-1 { grid-template-columns: 48px; }
.message-images.grid-2,
.message-images.grid-3,
.message-images.grid-4 { grid-template-columns: 48px 48px; }

.img-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.img-thumb:hover {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2), 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: scale(1.05);
}

.img-thumb:hover .img-zoom-hint {
  opacity: 1;
}

.img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.img-zoom-hint {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}



.img-more {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
}

.message-images:has(.img-more) {
  position: relative;
}

</style>
