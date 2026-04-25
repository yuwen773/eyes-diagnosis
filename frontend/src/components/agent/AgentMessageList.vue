<template>
  <div class="agent-message-list" ref="listRef">
    <div class="messages-container">
      <!-- Welcome Screen -->
      <div v-if="messages.length === 0" class="welcome">
        <!-- Warm radial atmosphere -->
        <div class="nebula" aria-hidden="true">
          <div class="nebula-cloud n1"></div>
          <div class="nebula-cloud n2"></div>
          <div class="nebula-cloud n3"></div>
        </div>

        <!-- 主舞台 -->
        <div class="welcome-stage">
          <!-- Neural Eye AI 动画 -->
          <div class="eye-vision" aria-hidden="true">
            <svg class="ev-svg" viewBox="0 0 240 200" fill="none">
              <defs>
                <radialGradient id="evCoreGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stop-color="#e8956a" />
                  <stop offset="100%" stop-color="#d97757" />
                </radialGradient>
                <filter id="evGlow">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <!-- 外层神经网络脉冲线 -->
              <line x1="120" y1="100" x2="60" y2="50" class="ev-pulse" style="--delay:0s" />
              <line x1="120" y1="100" x2="180" y2="50" class="ev-pulse" style="--delay:0.25s" />
              <line x1="120" y1="100" x2="30" y2="100" class="ev-pulse" style="--delay:0.5s" />
              <line x1="120" y1="100" x2="210" y2="100" class="ev-pulse" style="--delay:0.75s" />
              <line x1="120" y1="100" x2="60" y2="150" class="ev-pulse" style="--delay:1s" />
              <line x1="120" y1="100" x2="180" y2="150" class="ev-pulse" style="--delay:1.25s" />
              <!-- 次级连线 -->
              <line x1="60" y1="50" x2="30" y2="100" class="ev-pulse ev-sub" style="--delay:1.5s" />
              <line x1="180" y1="50" x2="210" y2="100" class="ev-pulse ev-sub" style="--delay:1.75s" />
              <line x1="30" y1="100" x2="60" y2="150" class="ev-pulse ev-sub" style="--delay:2s" />
              <line x1="210" y1="100" x2="180" y2="150" class="ev-pulse ev-sub" style="--delay:2.25s" />

              <!-- 神经节点 -->
              <circle cx="60" cy="50" r="4" class="ev-node" style="--delay:0.3s" />
              <circle cx="180" cy="50" r="4" class="ev-node" style="--delay:0.55s" />
              <circle cx="30" cy="100" r="3.5" class="ev-node" style="--delay:0.8s" />
              <circle cx="210" cy="100" r="3.5" class="ev-node" style="--delay:1.05s" />
              <circle cx="60" cy="150" r="4" class="ev-node" style="--delay:1.3s" />
              <circle cx="180" cy="150" r="4" class="ev-node" style="--delay:1.55s" />
              <circle cx="120" cy="100" r="6" class="ev-core-node" style="--delay:0.1s" filter="url(#evGlow)" />

              <!-- 眼睛轮廓 -->
              <path d="M20 100C20 100 60 50 120 50C180 50 220 100 220 100C220 100 180 150 120 150C60 150 20 100 20 100Z" class="ev-eye" />
              <!-- 眼睛内圈 -->
              <circle cx="120" cy="100" r="28" class="ev-iris-ring" />
              <circle cx="120" cy="100" r="20" class="ev-iris-ring ev-iris-inner" />
              <!-- 瞳孔内核发光 -->
              <circle cx="120" cy="100" r="10" class="ev-pupil" filter="url(#evGlow)" />
              <circle cx="124" cy="96" r="2.5" class="ev-light" />

              <!-- 数据流动粒子 -->
              <circle cx="60" cy="50" r="1.5" class="ev-particle" style="--delay:0s" />
              <circle cx="180" cy="50" r="1.5" class="ev-particle" style="--delay:0.4s" />
              <circle cx="30" cy="100" r="1.5" class="ev-particle" style="--delay:0.8s" />
              <circle cx="210" cy="100" r="1.5" class="ev-particle" style="--delay:1.2s" />
              <circle cx="60" cy="150" r="1.5" class="ev-particle" style="--delay:1.6s" />
              <circle cx="180" cy="150" r="1.5" class="ev-particle" style="--delay:2s" />
            </svg>
          </div>
          <div class="welcome-text">
            <h2 class="welcome-title">EyeSight</h2>
            <p class="welcome-desc">上传眼底图片或描述症状，我来为您分析诊断</p>
          </div>
          <div class="welcome-hints">
            <button
              v-for="(hint, i) in quickHints"
              :key="i"
              class="guide-card"
              :class="`guide-card-${hint.icon}`"
              :style="{ animationDelay: (600 + i * 120) + 'ms', '--accent': hint.color }"
              @click="emit('send', hint.action)"
            >
              <div class="guide-icon-wrap">
                <!-- Image icon -->
                <svg v-if="hint.icon === 'image'" class="guide-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <!-- Text icon -->
                <svg v-else-if="hint.icon === 'text'" class="guide-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <!-- Learn icon -->
                <svg v-else-if="hint.icon === 'learn'" class="guide-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
              <div class="guide-content">
                <span class="guide-title">{{ hint.title }}</span>
                <span class="guide-desc">{{ hint.desc }}</span>
              </div>
              <div class="guide-action">
                <span class="guide-action-text">{{ hint.action }}</span>
                <svg class="guide-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
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
  {
    icon: 'image',
    title: '上传眼底图像',
    desc: '发送眼底图片，AI 辅助分析',
    action: '上传我的眼底OCT图像',
    color: '#d97757',
  },
  {
    icon: 'text',
    title: '描述症状',
    desc: '用文字描述眼部不适',
    action: '我最近眼睛干涩、偶尔模糊是怎么回事',
    color: '#8b5a7a',
  },
  {
    icon: 'learn',
    title: '了解眼病',
    desc: '查询眼科疾病知识',
    action: '介绍一下白内障的症状和预防',
    color: '#5a8b7a',
  },
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
  scrollbar-color: var(--claude-border-warm) transparent;
}

.agent-message-list::-webkit-scrollbar {
  width: 6px;
}

.agent-message-list::-webkit-scrollbar-track {
  background: transparent;
}

.agent-message-list::-webkit-scrollbar-thumb {
  background: var(--claude-border-warm);
  border-radius: 10px;
}

.agent-message-list::-webkit-scrollbar-thumb:hover {
  background: var(--claude-text-tertiary);
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

/* Warm radial atmosphere */
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
  opacity: 0.25;
  animation: nebulaDrift 12s ease-in-out infinite;
}

.n1 {
  width: 320px;
  height: 320px;
  top: 5%;
  left: 15%;
  background: radial-gradient(circle, oklch(0.72 0.09 30 / 0.3) 0%, transparent 70%);
}

.n2 {
  width: 250px;
  height: 250px;
  top: 40%;
  right: 10%;
  background: radial-gradient(circle, oklch(0.55 0.07 320 / 0.2) 0%, transparent 70%);
  animation-delay: 3s;
}

.n3 {
  width: 200px;
  height: 200px;
  bottom: 10%;
  left: 30%;
  background: radial-gradient(circle, oklch(0.72 0.06 50 / 0.15) 0%, transparent 70%);
  animation-delay: 6s;
}

@keyframes nebulaDrift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(15px, -10px) scale(1.05); }
  66% { transform: translate(-10px, 8px) scale(0.97); }
}

/* Welcome stage */
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

/* Eye Vision Neural */
.eye-vision {
  width: 180px;
  height: 160px;
  margin-bottom: 20px;
  animation: eyeVisionIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0ms both;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes eyeVisionIn {
  from { opacity: 0; transform: scale(0.7); }
  to { opacity: 1; transform: scale(1); }
}

.ev-svg {
  width: 100%;
  height: 100%;
}

.ev-eye {
  stroke: #d97757;
  stroke-width: 2;
  fill: none;
  opacity: 0.45;
  animation: evEyeBreath 4s ease-in-out infinite;
}

.ev-iris-ring {
  stroke: #d97757;
  stroke-width: 1.2;
  fill: none;
  opacity: 0.5;
  animation: evRingPulse 3s ease-in-out infinite;
}

.ev-iris-inner {
  opacity: 0.3;
  animation-delay: 0.5s;
}

.ev-core-node {
  fill: url(#evCoreGrad);
  animation: evCorePulse 2.5s ease-in-out infinite;
}

.ev-pulse {
  stroke: #d97757;
  stroke-width: 1;
  stroke-linecap: round;
  opacity: 0;
  stroke-dasharray: 80;
  animation: evPulseOut 3s ease-out infinite;
  animation-delay: var(--delay);
}

.ev-sub {
  stroke-width: 0.8;
  opacity: 0;
}

.ev-node {
  fill: #d97757;
  opacity: 0;
  animation: evNodeAppear 3s ease-out infinite;
  animation-delay: var(--delay);
}

.ev-pupil {
  fill: #d97757;
  opacity: 0.9;
  animation: evPupilBreath 2.5s ease-in-out infinite;
}

.ev-light {
  fill: white;
  opacity: 0.7;
  animation: evLightFlicker 2.5s ease-in-out infinite;
}

.ev-particle {
  fill: #e8956a;
  opacity: 0;
  animation: evParticleFlow 3s ease-in-out infinite;
  animation-delay: var(--delay);
}

@keyframes evEyeBreath {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.55; }
}

@keyframes evRingPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

@keyframes evCorePulse {
  0%, 100% { opacity: 0.8; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}

@keyframes evPulseOut {
  0% { opacity: 0; stroke-dashoffset: 80; }
  15% { opacity: 0.7; }
  100% { opacity: 0; stroke-dashoffset: 0; }
}

@keyframes evNodeAppear {
  0%, 10% { opacity: 0; }
  30% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes evPupilBreath {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}

@keyframes evLightFlicker {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0.9; }
}

@keyframes evParticleFlow {
  0% { opacity: 0; transform: scale(0); }
  20% { opacity: 1; transform: scale(1.5); }
  100% { opacity: 0; transform: scale(0.5) translateY(-10px); }
}

/* Welcome text */
.welcome-text {
  animation: welcomeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 200ms both;
}

.welcome-title {
  font-family: var(--claude-font-serif);
  font-size: 36px;
  font-weight: 700;
  margin: 0 0 10px;
  letter-spacing: -0.04em;
  color: var(--claude-brand);
}

.welcome-desc {
  font-size: 15px;
  color: var(--claude-text-tertiary);
  margin: 0;
  max-width: 400px;
  line-height: 1.6;
}

/* Guide Cards — visual action prompts */
.welcome-hints {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-top: 32px;
  animation: welcomeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 400ms both;
}

.guide-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 18px 16px;
  border-radius: var(--claude-radius-xl);
  border: 1px solid var(--claude-border-warm);
  background: var(--claude-bg-card);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  animation: guideCardIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.guide-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--accent, var(--claude-brand));
  opacity: 0.7;
  transition: opacity 0.3s ease;
}

.guide-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 0%, var(--accent, var(--claude-brand)) 0%, transparent 60%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.guide-card:hover {
  border-color: var(--accent, var(--claude-brand));
  transform: translateY(-3px);
  box-shadow: 0 8px 24px oklch(0.72 0.09 30 / 0.1);
}

.guide-card:hover::before {
  opacity: 1;
}

.guide-card:hover::after {
  opacity: 0.06;
}

.guide-card:hover .guide-icon-wrap {
  transform: scale(1.1);
}

.guide-card:hover .guide-arrow {
  transform: translateX(3px);
  color: var(--accent, var(--claude-brand));
}

.guide-card:active {
  transform: translateY(-1px) scale(0.98);
}

@keyframes guideCardIn {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.guide-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(from var(--accent, var(--claude-brand)) l c h / 0.12);
  color: var(--accent, var(--claude-brand));
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.guide-icon {
  opacity: 0.9;
}

.guide-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.guide-title {
  font-family: var(--claude-font-serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--claude-text-primary);
  line-height: 1.3;
}

.guide-desc {
  font-size: 12px;
  color: var(--claude-text-tertiary);
  line-height: 1.4;
}

.guide-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--claude-border-cream);
}

.guide-action-text {
  font-size: 12px;
  color: var(--claude-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  transition: color 0.2s ease;
}

.guide-card:hover .guide-action-text {
  color: var(--accent, var(--claude-brand));
}

.guide-arrow {
  flex-shrink: 0;
  color: var(--claude-text-tertiary);
  transition: transform 0.2s ease, color 0.2s ease;
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
  background: var(--claude-bg-elevated);
  border: 1px solid var(--claude-border-cream);
  position: relative;
  overflow: hidden;
}

.typing-pill::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(0.72 0.09 30 / 0.04) 40%,
    oklch(0.72 0.09 30 / 0.08) 50%,
    oklch(0.72 0.09 30 / 0.04) 60%,
    transparent 100%
  );
  animation: shimmer 2.8s ease-in-out infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.typing-bar {
  display: block;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--claude-brand);
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
  background: var(--claude-brand);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 20px oklch(0.72 0.09 30 / 0.35);
}

.scroll-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 28px oklch(0.72 0.09 30 / 0.4);
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

/* Unread pulse ring */
.scroll-pulse {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid oklch(0.72 0.09 30 / 0.5);
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
  background: var(--claude-error);
  box-shadow: 0 0 0 2px var(--claude-bg-page),
    0 2px 8px oklch(0.55 0.18 25 / 0.4);
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
