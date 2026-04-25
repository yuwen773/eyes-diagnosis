<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { VerticalAlignTopOutlined } from '@ant-design/icons-vue'

const props = withDefaults(defineProps<{
  /** Scroll threshold in px before the button appears */
  threshold?: number
  /** Bottom offset in px */
  bottom?: number
  /** Right offset in px */
  right?: number
}>(), {
  threshold: 300,
  bottom: 32,
  right: 32,
})

const visible = ref(false)
let ticking = false

const onScroll = () => {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    visible.value = window.scrollY > props.threshold
    ticking = false
  })
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', onScroll))

const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <Transition name="scroll-top">
    <button
      v-show="visible"
      class="scroll-to-top"
      :style="{ bottom: `${bottom}px`, right: `${right}px` }"
      aria-label="回到顶部"
      @click="scrollToTop"
    >
      <VerticalAlignTopOutlined />
    </button>
  </Transition>
</template>

<style scoped>
.scroll-to-top {
  position: fixed;
  z-index: 900;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: oklch(0.45 0.03 50);
  background: oklch(0.98 0.005 80);
  border: 1px solid oklch(0.88 0.01 75);
  border-radius: 50%;
  box-shadow: 0 2px 12px oklch(0.2 0.02 40 / 0.12);
  cursor: pointer;
  transition: color 0.25s ease,
              background 0.25s ease,
              box-shadow 0.25s ease,
              transform 0.25s ease;
}

.scroll-to-top:hover {
  color: oklch(0.55 0.1 30);
  background: oklch(0.97 0.01 80);
  box-shadow: 0 4px 16px oklch(0.2 0.02 40 / 0.18);
  transform: translateY(-2px);
}

.scroll-to-top:active {
  transform: translateY(0);
}

.scroll-top-enter-active,
.scroll-top-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.scroll-top-enter-from,
.scroll-top-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.9);
}
</style>
