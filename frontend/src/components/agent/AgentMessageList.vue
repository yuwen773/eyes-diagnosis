<template>
  <div class="agent-message-list" ref="listRef">
    <div class="messages-container">
      <!-- Welcome Screen -->
      <div v-if="messages.length === 0" class="welcome">
        <!-- 星云光晕 -->
        <div class="nebula" aria-hidden="true">
          <div class="nebula-cloud n1"></div>
          <div class="nebula-cloud n2"></div>
          <div class="nebula-cloud n3"></div>
        </div>
        <!-- 漂浮星尘 -->
        <div class="starfield" aria-hidden="true"></div>

        <!-- 主舞台 -->
        <div class="welcome-stage">
          <!-- 星座动画 -->
          <div class="constellation" aria-hidden="true">
            <svg class="constellation-svg" viewBox="0 0 240 220" fill="none">
              <defs>
                <linearGradient id="nodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--color-primary-400)" />
                  <stop offset="100%" stop-color="var(--color-accent-purple, var(--color-secondary-400))" />
                </linearGradient>
                <filter id="nodeGlow">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="coreGlow">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <!-- 连线 -->
              <line x1="120" y1="20" x2="60" y2="65" class="c-line" style="animation-delay:0s" />
              <line x1="120" y1="20" x2="180" y2="65" class="c-line" style="animation-delay:0.2s" />
              <line x1="60" y1="65" x2="30" y2="130" class="c-line" style="animation-delay:0.4s" />
              <line x1="60" y1="65" x2="120" y2="110" class="c-line" style="animation-delay:0.6s" />
              <line x1="180" y1="65" x2="210" y2="130" class="c-line" style="animation-delay:0.3s" />
              <line x1="180" y1="65" x2="120" y2="110" class="c-line" style="animation-delay:0.5s" />
              <line x1="60" y1="65" x2="180" y2="65" class="c-line" style="animation-delay:1.2s" />
              <line x1="120" y1="110" x2="30" y2="130" class="c-line" style="animation-delay:0.8s" />
              <line x1="120" y1="110" x2="210" y2="130" class="c-line" style="animation-delay:0.7s" />
              <line x1="120" y1="110" x2="80" y2="180" class="c-line" style="animation-delay:0.9s" />
              <line x1="120" y1="110" x2="160" y2="180" class="c-line" style="animation-delay:1s" />
              <line x1="30" y1="130" x2="80" y2="180" class="c-line" style="animation-delay:1.3s" />
              <line x1="210" y1="130" x2="160" y2="180" class="c-line" style="animation-delay:1.1s" />
              <line x1="80" y1="180" x2="160" y2="180" class="c-line" style="animation-delay:1.5s" />
              <!-- 节点 -->
              <circle cx="120" cy="20" r="4" class="c-node c-node-lg" style="animation-delay:0s" filter="url(#nodeGlow)" />
              <circle cx="60" cy="65" r="3.2" class="c-node" style="animation-delay:0.3s" />
              <circle cx="180" cy="65" r="3.2" class="c-node" style="animation-delay:0.5s" />
              <circle cx="120" cy="110" r="5.5" class="c-node c-node-core" style="animation-delay:0.1s" filter="url(#coreGlow)" />
              <circle cx="30" cy="130" r="2.8" class="c-node" style="animation-delay:0.7s" />
              <circle cx="210" cy="130" r="2.8" class="c-node" style="animation-delay:0.9s" />
              <circle cx="80" cy="180" r="3" class="c-node" style="animation-delay:1.1s" />
              <circle cx="160" cy="180" r="3" class="c-node" style="animation-delay:1.3s" />
              <!-- 微尘粒子 -->
              <circle cx="45" cy="40" r="1" class="c-dust" style="animation-delay:0s" />
              <circle cx="195" cy="45" r="0.8" class="c-dust" style="animation-delay:1s" />
              <circle cx="15" cy="100" r="0.7" class="c-dust" style="animation-delay:2s" />
              <circle cx="225" cy="95" r="0.9" class="c-dust" style="animation-delay:0.5s" />
              <circle cx="100" cy="200" r="0.8" class="c-dust" style="animation-delay:1.5s" />
              <circle cx="140" cy="195" r="0.6" class="c-dust" style="animation-delay:2.5s" />
            </svg>
          </div>
          <div class="welcome-text">
            <h2 class="welcome-title">SpaceMind</h2>
            <p class="welcome-desc">描述您想要的画面，我来帮您寻找或创作</p>
          </div>
          <div class="welcome-hints">
            <button
              v-for="(hint, i) in quickHints"
              :key="i"
              class="hint-card"
              :style="{ animationDelay: (500 + i * 80) + 'ms' }"
              @click="emit('send', hint)"
            >
              <svg class="hint-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{{ hint }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Messages -->
      <template v-for="(msg, index) in messages" :key="index">
        <div class="msg-animate">
          <UserMessage v-if="msg.type === 'user'" :content="msg.content" :time="msg.time" />
          <ReasoningMessage v-else-if="msg.type === 'reasoning'" :content="msg.content" />
          <AssistantMessage
  v-else-if="msg.type === 'assistant'"
  :content="msg.content"
  :isLoading="msg.isLoading"
  @toggle-resources="(data: ResourceData) => emit('toggleResources', data)"
/>
          <ToolRequestMessage v-else-if="msg.type === 'tool-request'" :toolName="msg.toolName || '工具'" :toolCalls="msg.toolCalls" :content="msg.content" />
          <ToolResponseMessage v-else-if="msg.type === 'tool-response'" :toolName="msg.toolName || ''" :content="msg.content" />
          <ToolConfirmMessage v-else-if="msg.type === 'mcp-confirm' || msg.type === 'interrupt'" :message="msg.content" @confirm="emit('confirm')" @cancel="emit('cancel')" />
        </div>
      </template>

      <!-- Typing indicator -->
      <transition name="typing-fade">
        <div v-if="loading" class="typing-row">
          <div class="typing-pill">
            <span class="typing-bar"></span>
            <span class="typing-bar"></span>
            <span class="typing-bar"></span>
          </div>
        </div>
      </transition>
    </div>

    <!-- Scroll-to-bottom -->
    <transition name="scroll-reveal">
      <button
        v-if="showScrollBtn"
        class="scroll-btn"
        :class="{ 'has-unread': unreadCount > 0 }"
        @click="scrollToBottom"
        aria-label="滚动到底部"
      >
        <span v-if="unreadCount > 0" class="scroll-pulse" aria-hidden="true"></span>
        <svg class="scroll-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="7 7 12 12 17 7" />
          <polyline points="7 13 12 18 17 13" opacity="0.4" />
        </svg>
        <span v-if="unreadCount > 0" class="scroll-badge">{{ unreadCount }}</span>
      </button>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import UserMessage from './message/UserMessage.vue'
import AssistantMessage from './message/AssistantMessage.vue'
import ReasoningMessage from './message/ReasoningMessage.vue'
import ToolRequestMessage from './message/ToolRequestMessage.vue'
import ToolResponseMessage from './message/ToolResponseMessage.vue'
import ToolConfirmMessage from './message/ToolConfirmMessage.vue'
import type { ToolCallArg } from '@/composables/useAgentStream'
import type { ResourceData } from './types'

interface Message {
  type: 'user' | 'assistant' | 'reasoning' | 'tool-request' | 'tool-response' | 'mcp-confirm' | 'interrupt' | 'loading'
  content: string
  toolName?: string
  toolCalls?: ToolCallArg[]
  isLoading?: boolean
  time?: string
  images?: string[]
}

interface Props {
  messages: Message[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  messages: () => [],
  loading: false,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'send', text: string): void
  (e: 'toggleResources', data: ResourceData): void
}>()

const quickHints = [
  '一张赛博朋克风格的城市夜景',
  '用水彩风格画一只猫',
  '复古海报风格的旅行插画',
]

const listRef = ref<HTMLElement | null>(null)
const unreadCount = ref(0)
const isAtBottom = ref(true)

const showScrollBtn = computed(() => !isAtBottom.value)

const scrollToBottom = () => {
  if (listRef.value) {
    listRef.value.scrollTo({ top: listRef.value.scrollHeight, behavior: 'smooth' })
    unreadCount.value = 0
    isAtBottom.value = true
  }
}

const checkBottom = () => {
  if (!listRef.value) return
  const el = listRef.value
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isAtBottom.value = distanceToBottom < 80

  if (isAtBottom.value) {
    unreadCount.value = 0
  }
}

onMounted(() => {
  listRef.value?.addEventListener('scroll', checkBottom, { passive: true })
  nextTick(checkBottom)
})

onUnmounted(() => {
  listRef.value?.removeEventListener('scroll', checkBottom)
})

watch(() => props.messages.length, () => {
  nextTick(() => {
    if (isAtBottom.value) {
      scrollToBottom()
    } else {
      unreadCount.value++
    }
  })
})

watch(() => props.loading, (val) => {
  if (val) {
    nextTick(() => {
      if (isAtBottom.value) scrollToBottom()
    })
  }
})
</script>

<style scoped>
.agent-message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-default) transparent;
}

.agent-message-list::-webkit-scrollbar {
  width: 6px;
}

.agent-message-list::-webkit-scrollbar-track {
  background: transparent;
}

.agent-message-list::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 10px;
}

.agent-message-list::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-tertiary);
}

.messages-container {
  max-width: 100%;
  width: 100%;
  margin: 0 auto;
  padding: 0 20px;
}

/* ============ Welcome Screen ============ */
.welcome {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  padding: 40px 20px;
  overflow: hidden;
}

/* Nebula backdrop */
.nebula {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  animation: nebulaFadeIn 1.5s ease both;
}

@keyframes nebulaFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.nebula-cloud {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.35;
  animation: nebulaDrift 12s ease-in-out infinite;
}

[data-theme="aurora"] .n1 {
  width: 320px;
  height: 320px;
  top: 5%;
  left: 15%;
  background: radial-gradient(circle, rgba(34, 104, 245, 0.4) 0%, transparent 70%);
}

[data-theme="aurora"] .n2 {
  width: 250px;
  height: 250px;
  top: 40%;
  right: 10%;
  background: radial-gradient(circle, rgba(110, 53, 235, 0.35) 0%, transparent 70%);
  animation-delay: 3s;
}

[data-theme="aurora"] .n3 {
  width: 200px;
  height: 200px;
  bottom: 10%;
  left: 30%;
  background: radial-gradient(circle, rgba(0, 212, 170, 0.2) 0%, transparent 70%);
  animation-delay: 6s;
}

[data-theme="pop"] .n1 {
  width: 320px;
  height: 320px;
  top: 5%;
  left: 15%;
  background: radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, transparent 70%);
}

[data-theme="pop"] .n2 {
  width: 250px;
  height: 250px;
  top: 40%;
  right: 10%;
  background: radial-gradient(circle, rgba(236, 72, 153, 0.3) 0%, transparent 70%);
  animation-delay: 3s;
}

[data-theme="pop"] .n3 {
  width: 200px;
  height: 200px;
  bottom: 10%;
  left: 30%;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%);
  animation-delay: 6s;
}

@keyframes nebulaDrift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(15px, -10px) scale(1.05); }
  66% { transform: translate(-10px, 8px) scale(0.97); }
}

/* Starfield */
.starfield {
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: nebulaFadeIn 2s ease 0.3s both;
}

[data-theme="aurora"] .starfield::after {
  content: '';
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(200, 220, 255, 0.7);
  box-shadow:
    30px 40px 0 0 rgba(200, 220, 255, 0.3),
    80px 15px 0 0 rgba(200, 220, 255, 0.5),
    140px 70px 0 0 rgba(200, 220, 255, 0.2),
    200px 30px 0 0 rgba(200, 220, 255, 0.6),
    260px 80px 0 0 rgba(200, 220, 255, 0.3),
    50px 120px 0 0 rgba(200, 220, 255, 0.4),
    180px 140px 0 0 rgba(200, 220, 255, 0.5),
    100px 180px 0 0 rgba(200, 220, 255, 0.2),
    300px 100px 0 0 rgba(200, 220, 255, 0.4),
    220px 170px 0 0 rgba(200, 220, 255, 0.3),
    350px 50px 0 0 rgba(200, 220, 255, 0.5),
    370px 160px 0 0 rgba(200, 220, 255, 0.2);
  animation: starTwinkle 4s ease-in-out infinite;
}

[data-theme="pop"] .starfield::after {
  content: '';
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(220, 200, 255, 0.7);
  box-shadow:
    30px 40px 0 0 rgba(220, 200, 255, 0.3),
    80px 15px 0 0 rgba(220, 200, 255, 0.5),
    140px 70px 0 0 rgba(220, 200, 255, 0.2),
    200px 30px 0 0 rgba(220, 200, 255, 0.6),
    260px 80px 0 0 rgba(220, 200, 255, 0.3),
    50px 120px 0 0 rgba(220, 200, 255, 0.4),
    180px 140px 0 0 rgba(220, 200, 255, 0.5),
    100px 180px 0 0 rgba(220, 200, 255, 0.2),
    300px 100px 0 0 rgba(220, 200, 255, 0.4),
    220px 170px 0 0 rgba(220, 200, 255, 0.3),
    350px 50px 0 0 rgba(220, 200, 255, 0.5),
    370px 160px 0 0 rgba(220, 200, 255, 0.2);
  animation: starTwinkle 4s ease-in-out infinite;
}

@keyframes starTwinkle {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* Welcome stage — content above backdrop */
.welcome-stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

@keyframes welcomeIn {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Constellation */
.constellation {
  width: 160px;
  height: 150px;
  margin-bottom: 20px;
  animation: constellationIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0ms both;
}

@keyframes constellationIn {
  from { opacity: 0; transform: scale(0.7); }
  to { opacity: 1; transform: scale(1); }
}

.constellation-svg {
  width: 100%;
  height: 100%;
}

.c-line {
  stroke: var(--color-primary-400, var(--color-primary-500));
  stroke-width: 1;
  opacity: 0.4;
  stroke-linecap: round;
  animation: cLineBreath 4s ease-in-out infinite;
}

.c-node {
  fill: var(--color-primary-400, var(--color-primary-500));
  opacity: 0.85;
  animation: cNodeBreath 3.5s ease-in-out infinite;
}

.c-node-lg {
  opacity: 0.95;
}

.c-node-core {
  fill: url(#nodeGrad);
  opacity: 1;
  animation: cCoreBreath 3s ease-in-out infinite;
}

[data-theme="aurora"] .c-node-core {
  filter: drop-shadow(0 0 10px rgba(34, 104, 245, 0.6));
}

[data-theme="pop"] .c-node-core {
  filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.6));
}

.c-dust {
  fill: var(--color-primary-300, var(--color-primary-400));
  opacity: 0;
  animation: dustDrift 5s ease-in-out infinite;
}

@keyframes cLineBreath {
  0%, 100% { opacity: 0.3; stroke-width: 1; }
  50% { opacity: 0.65; stroke-width: 1.4; }
}

@keyframes cNodeBreath {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}

@keyframes cCoreBreath {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 1; }
}

@keyframes dustDrift {
  0% { opacity: 0; transform: translateY(0); }
  30% { opacity: 0.5; }
  70% { opacity: 0.4; }
  100% { opacity: 0; transform: translateY(-8px); }
}

/* Welcome text */
.welcome-text {
  animation: welcomeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 200ms both;
}

.welcome-title {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 700;
  margin: 0 0 10px;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, var(--color-primary-400, var(--color-primary-500)) 0%, var(--color-accent-purple, var(--color-secondary-400)) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

[data-theme="aurora"] .welcome-title {
  background: linear-gradient(135deg, #6aa3ff 0%, #a270fc 50%, #2268f5 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

[data-theme="pop"] .welcome-title {
  background: linear-gradient(135deg, #c084fc 0%, #f472b6 50%, #a855f7 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

.welcome-desc {
  font-size: 15px;
  color: var(--color-text-secondary);
  margin: 0;
  max-width: 400px;
  line-height: 1.6;
}

/* Quick hint cards */
.welcome-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 28px;
  animation: welcomeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 400ms both;
}

@keyframes hintCardIn {
  from { opacity: 0; transform: translateY(12px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.hint-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: var(--glass-bg, rgba(26, 35, 50, 0.6));
  backdrop-filter: var(--glass-blur-light, blur(12px));
  -webkit-backdrop-filter: var(--glass-blur-light, blur(12px));
  color: var(--color-text-secondary);
  font-family: var(--font-body);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  line-height: 1.4;
  animation: hintCardIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  position: relative;
  overflow: hidden;
}

.hint-card::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.25s ease;
  border-radius: inherit;
}

[data-theme="aurora"] .hint-card::before {
  background: linear-gradient(135deg, rgba(34, 104, 245, 0.1) 0%, rgba(110, 53, 235, 0.05) 100%);
}

[data-theme="pop"] .hint-card::before {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(236, 72, 153, 0.04) 100%);
}

.hint-icon {
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.hint-card:hover {
  border-color: var(--color-primary-500);
  color: var(--color-text-primary);
  transform: translateY(-2px);
}

.hint-card:hover::before {
  opacity: 1;
}

.hint-card:hover .hint-icon {
  opacity: 1;
  color: var(--color-primary-500);
}

[data-theme="aurora"] .hint-card:hover {
  box-shadow: 0 0 0 1px rgba(34, 104, 245, 0.15), 0 4px 16px rgba(34, 104, 245, 0.12);
}

[data-theme="pop"] .hint-card:hover {
  box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.12), 0 4px 16px rgba(168, 85, 247, 0.1);
}

.hint-card:active {
  transform: translateY(0) scale(0.97);
}

.hint-card span {
  position: relative;
  z-index: 1;
}

/* ============ Typing Indicator ============ */
.typing-row {
  padding: 16px 16px 16px 20px;
}

.typing-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 10px 18px;
  border-radius: 18px 18px 18px 4px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  position: relative;
  overflow: hidden;
}

/* Subtle shimmer sweep across the pill */
.typing-pill::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.04) 40%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 60%,
    transparent 100%
  );
  animation: shimmer 2.8s ease-in-out infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Three bars that breathe in a wave */
.typing-bar {
  display: block;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--color-primary-500);
  opacity: 0.35;
  animation: barPulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  will-change: transform, opacity;
}

.typing-bar:nth-child(1) { animation-delay: 0s; }
.typing-bar:nth-child(2) { animation-delay: 0.18s; }
.typing-bar:nth-child(3) { animation-delay: 0.36s; }

@keyframes barPulse {
  0%, 100% {
    transform: scaleY(0.55);
    opacity: 0.3;
  }
  40% {
    transform: scaleY(1);
    opacity: 0.9;
  }
}

[data-theme="aurora"] .typing-bar {
  background: #2268f5;
}

[data-theme="pop"] .typing-bar {
  background: #a855f7;
}

/* ============ Scroll Button ============ */
.scroll-btn {
  position: sticky;
  bottom: 16px;
  align-self: flex-end;
  margin-right: 28px;
  z-index: 50;
  flex: none;

  width: 44px;
  height: 44px;
  aspect-ratio: 1;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, var(--color-primary-500), var(--color-primary-400, var(--color-primary-500)));
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 20px color-mix(in srgb, var(--color-primary-500) 35%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.scroll-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--color-primary-500) 40%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.scroll-btn:hover .scroll-icon {
  transform: translateY(2px);
}

.scroll-btn:active {
  transform: scale(0.88);
  transition-duration: 0.1s;
}

.scroll-btn:active .scroll-icon {
  transform: translateY(3px);
}

.scroll-icon {
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Aurora theme */
[data-theme="aurora"] .scroll-btn {
  background: linear-gradient(135deg, #2268f5, #5b9aff);
  box-shadow: 0 4px 20px rgba(34, 104, 245, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

[data-theme="aurora"] .scroll-btn:hover {
  box-shadow: 0 8px 28px rgba(34, 104, 245, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

/* Pop theme */
[data-theme="pop"] .scroll-btn {
  background: linear-gradient(135deg, #a855f7, #c084fc);
  box-shadow: 0 4px 20px rgba(168, 85, 247, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

[data-theme="pop"] .scroll-btn:hover {
  box-shadow: 0 8px 28px rgba(168, 85, 247, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

/* Unread pulse ring */
.scroll-pulse {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  pointer-events: none;
  animation: scrollPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes scrollPulse {
  0% {
    transform: scale(0.95);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.25);
    opacity: 0;
  }
  100% {
    transform: scale(0.95);
    opacity: 0;
  }
}

[data-theme="aurora"] .scroll-pulse {
  border: 2px solid rgba(34, 104, 245, 0.5);
}

[data-theme="pop"] .scroll-pulse {
  border: 2px solid rgba(168, 85, 247, 0.5);
}

/* Badge */
.scroll-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  color: #fff;
  pointer-events: none;
  background: #ef4444;
  box-shadow: 0 0 0 2px var(--color-bg-primary, #fff),
    0 2px 8px rgba(239, 68, 68, 0.4);
  animation: badgePop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes badgePop {
  from { transform: scale(0); }
  to { transform: scale(1); }
}

/* Scroll button reveal animation */
.scroll-reveal-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.scroll-reveal-leave-active {
  transition: all 0.2s ease-in;
}

.scroll-reveal-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.85);
}

.scroll-reveal-leave-to {
  opacity: 0;
  transform: scale(0.85);
}

/* ============ Message Animation ============ */
.msg-animate {
  padding: 12px 20px;
  animation: msgIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes msgIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Typing indicator fade */
.typing-fade-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.typing-fade-leave-active {
  transition: opacity 0.2s ease;
}

.typing-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.typing-fade-leave-to {
  opacity: 0;
}
</style>
