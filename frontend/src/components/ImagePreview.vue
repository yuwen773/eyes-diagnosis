<template>
  <Teleport to="body">
    <Transition name="image-preview">
      <div v-if="open" class="image-preview-overlay" @click="close">
        <!-- Close button -->
        <button class="image-preview-close" @click.stop="close" aria-label="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <!-- Image container -->
        <div class="image-preview-container" @click.stop @wheel.prevent="handleWheel">
          <img
            :src="url"
            :alt="alt"
            class="image-preview-img"
            :style="{ transform: imageTransform }"
            :class="{ dragging: isDragging }"
            @mousedown.prevent="startDrag"
            @mousemove="onDrag"
            @mouseup="endDrag"
            @mouseleave="endDrag"
            draggable="false"
          />
        </div>

        <!-- Toolbar -->
        <div class="image-preview-toolbar" @click.stop>
          <button class="toolbar-btn" @click="zoomOut" title="缩小">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <span class="zoom-level">{{ zoomPercent }}</span>
          <button class="toolbar-btn" @click="zoomIn" title="放大">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <div class="toolbar-divider" />

          <button class="toolbar-btn" @click="reset" title="重置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          <div class="toolbar-divider" />

          <button class="toolbar-btn" @click="rotate" title="旋转90°">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

interface Props {
  open: boolean
  url: string
  alt?: string
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  wheelStep?: number
}

const props = withDefaults(defineProps<Props>(), {
  alt: '',
  minZoom: 0.1,
  maxZoom: 5,
  zoomStep: 0.25,
  wheelStep: 0.1,
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const scale = ref(1)
const rotation = ref(0)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const translateStartX = ref(0)
const translateStartY = ref(0)

const imageTransform = computed(() =>
  `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value}) rotate(${rotation.value}deg)`
)

const zoomPercent = computed(() => `${Math.round(scale.value * 100)}%`)

function zoomIn() {
  scale.value = Math.min(scale.value + props.zoomStep, props.maxZoom)
}

function zoomOut() {
  scale.value = Math.max(scale.value - props.zoomStep, props.minZoom)
}

function handleWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -props.wheelStep : props.wheelStep
  scale.value = Math.max(props.minZoom, Math.min(props.maxZoom, scale.value + delta))
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360
}

function reset() {
  scale.value = 1
  rotation.value = 0
  translateX.value = 0
  translateY.value = 0
}

function close() {
  emit('update:open', false)
}

function startDrag(e: MouseEvent) {
  if (scale.value <= 1) return
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  translateStartX.value = translateX.value
  translateStartY.value = translateY.value
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = translateStartX.value + (e.clientX - dragStartX.value)
  translateY.value = translateStartY.value + (e.clientY - dragStartY.value)
}

function endDrag() {
  isDragging.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) {
    close()
  }
}

onMounted(() => {
  if (props.open) document.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

watch(() => props.open, (val) => {
  if (val) {
    reset()
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})
</script>

<style scoped>
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}

.image-preview-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  z-index: 10;
}
.image-preview-close:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.image-preview-container {
  max-width: 90vw;
  max-height: 85vh;
  overflow: hidden;
  cursor: default;
}

.image-preview-img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  display: block;
  user-select: none;
  transition: transform 0.15s ease;
}
.image-preview-img.dragging {
  cursor: grabbing;
  transition: none;
}

.image-preview-toolbar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(31, 35, 40, 0.9);
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: white;
  cursor: pointer;
  transition: background 0.15s;
}
.toolbar-btn svg {
  width: 18px;
  height: 18px;
}
.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.zoom-level {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  font-variant-numeric: tabular-nums;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.2);
}

.image-preview-enter-active { transition: opacity 0.25s ease; }
.image-preview-leave-active { transition: opacity 0.2s ease; }
.image-preview-enter-from,
.image-preview-leave-to { opacity: 0; }
</style>
