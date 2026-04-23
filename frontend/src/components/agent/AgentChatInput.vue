<template>
  <div class="agent-chat-input" :class="{ focused: isFocused, 'has-content': inputText.length > 0 || attachments.length > 0 }">
    <div class="input-container">
      <!-- Attachment preview strip -->
      <div v-if="attachments.length > 0" class="attachment-strip">
        <div v-for="(att, i) in attachments" :key="i" class="attachment-card">
          <!-- Image preview -->
          <template v-if="att.previewUrl">
            <div class="img-preview" @click="openPreview(att.previewUrl!)">
              <img :src="att.previewUrl" :alt="att.name" />
              <div class="img-zoom-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
            </div>
            <button class="remove-badge" @click="removeAttachment(i)" aria-label="移除">&times;</button>
          </template>
          <!-- File chip -->
          <template v-else>
            <div class="file-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </div>
            <span class="file-name" :title="att.name">{{ truncateName(att.name) }}</span>
            <button class="remove-badge" @click="removeAttachment(i)" aria-label="移除">&times;</button>
          </template>
        </div>
      </div>

      <!-- Input row -->
      <div class="input-row">
        <!-- Left toolbar -->
        <div class="toolbar-left">
          <button class="toolbar-btn attach-btn" @click="triggerFilePicker" aria-label="添加附件" title="上传图片或文件">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        </div>
        <input ref="fileInputRef" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt" class="hidden-input" @change="handleFileSelect" />

        <!-- Textarea -->
        <div class="textarea-wrap">
          <textarea
            ref="textareaRef"
            v-model="inputText"
            :placeholder="inputText.length === 0 && attachments.length === 0 ? 'Enter 发送 · Shift+Enter 换行 · Ctrl+V 粘贴图片' : ''"
            :rows="1"
            class="chat-textarea"
            @input="autoResize"
            @focus="isFocused = true"
            @blur="isFocused = false"
            @keydown="handleKeydown"
            @paste="handlePaste"
          />
          <transition name="count-fade">
            <span v-if="inputText.length > 0" class="char-count">{{ inputText.length }}</span>
          </transition>
        </div>

        <!-- Send / Stop -->
        <transition name="action-swap" mode="out-in">
          <button
            v-if="!loading"
            key="send"
            class="action-btn send-btn"
            :disabled="!canSend"
            @click="handleSend"
            aria-label="发送"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>

          <button
            v-else
            key="stop"
            class="action-btn stop-btn"
            @click="handleStop"
            aria-label="停止生成"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="3" />
            </svg>
          </button>
        </transition>
      </div>
    </div>

    <!-- Hint -->
    <div class="input-hint">
      <span class="disclaimer">内容由AI生成，仅供参考</span>
    </div>

    <!-- Full-size image preview lightbox -->
    <ImagePreview v-model:open="previewOpen" :url="lightboxUrl" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import ImagePreview from '@/components/ImagePreview.vue'

interface Attachment {
  file: File
  name: string
  previewUrl: string | null
}

interface Props {
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
})

const emit = defineEmits<{
  (e: 'send', text: string, files: File[]): void
  (e: 'stop'): void
}>()

const inputText = ref('')
const isFocused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const attachments = ref<Attachment[]>([])
const previewOpen = ref(false)
const lightboxUrl = ref('')

const openPreview = (url: string) => {
  lightboxUrl.value = url
  previewOpen.value = true
}

const canSend = computed(() => inputText.value.trim() || attachments.value.length > 0)

// Truncate filename: keep extension, middle-truncate the name part
const truncateName = (name: string, maxLen = 16): string => {
  if (name.length <= maxLen) return name
  const dotIdx = name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? name.slice(dotIdx) : ''
  const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name
  const keep = maxLen - ext.length - 3 // 3 for "..."
  if (keep <= 0) return name.slice(0, maxLen)
  return base.slice(0, Math.ceil(keep / 2)) + '...' + base.slice(-Math.floor(keep / 2)) + ext
}

const autoResize = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return

  let hasFile = false
  for (const item of items) {
    if (item.kind === 'file') {
      hasFile = true
      const file = item.getAsFile()
      if (file) addFile(file)
    }
  }
  if (hasFile) e.preventDefault()
}

const addFile = (file: File) => {
  const isImage = file.type.startsWith('image/')
  const previewUrl = isImage ? URL.createObjectURL(file) : null
  attachments.value.push({ file, name: file.name, previewUrl })
}

const removeAttachment = (index: number) => {
  const att = attachments.value[index]
  if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
  attachments.value.splice(index, 1)
}

const triggerFilePicker = () => {
  fileInputRef.value?.click()
}

const handleFileSelect = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  for (const file of input.files) {
    addFile(file)
  }
  input.value = ''
}

const handleSend = () => {
  if (!canSend.value) return
  const files = attachments.value.map(a => a.file)
  emit('send', inputText.value.trim(), files)
  inputText.value = ''
  // Revoke preview URLs
  attachments.value.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl) })
  attachments.value = []
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
  })
}

const handleStop = () => {
  emit('stop')
}

onUnmounted(() => {
  attachments.value.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl) })
})
</script>

<style scoped>
/* ============ Root ============ */
.agent-chat-input {
  padding: 8px 16px 6px;
  position: relative;
  z-index: 10;
}

/* ============ Input Container ============ */
.input-container {
  border-radius: 20px;
  border: 1.5px solid var(--color-border-subtle);
  background: var(--color-bg-elevated);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.agent-chat-input.focused .input-container {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

[data-theme="aurora"] .agent-chat-input.focused .input-container {
  border-color: #2268f5;
  box-shadow: 0 0 0 3px rgba(34, 104, 245, 0.15), 0 4px 16px rgba(34, 104, 245, 0.08);
}

[data-theme="pop"] .agent-chat-input.focused .input-container {
  border-color: #a855f7;
  box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15), 0 4px 16px rgba(168, 85, 247, 0.06);
}

/* ============ Attachment Strip ============ */
.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px 4px;
}

.attachment-card {
  position: relative;
  animation: cardIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes cardIn {
  from { opacity: 0; transform: scale(0.85) translateY(6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* -- Image preview (larger) -- */
.img-preview {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1.5px solid var(--color-border-subtle);
  background: var(--color-bg-tertiary);
  cursor: pointer;
  position: relative;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.img-preview:hover {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2), 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: scale(1.05);
}

.img-preview:hover .img-zoom-hint {
  opacity: 1;
}

.img-preview img {
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

/* -- File chip -- */
.attachment-card:has(.file-icon) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-subtle);
}

.file-icon {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.file-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* -- Remove button -- */
.remove-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-bg-elevated);
  border-radius: 50%;
  background: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
}

.remove-badge:hover {
  background: #ef4444;
  border-color: #ef4444;
  color: white;
  transform: scale(1.1);
}

/* File chip variant: remove badge positioned inline */
.attachment-card:has(.file-icon) .remove-badge {
  position: static;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 14px;
}

.attachment-card:has(.file-icon) .remove-badge:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.hidden-input {
  display: none;
}

/* ============ Input Row ============ */
.input-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 6px 6px;
}

/* ============ Left Toolbar ============ */
.toolbar-left {
  display: flex;
  align-items: center;
  padding-top: 2px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.toolbar-btn:hover {
  background: var(--color-bg-hover, var(--color-bg-tertiary));
  color: var(--color-text-secondary);
}

.attach-btn:hover {
  color: var(--color-primary-500);
  background: rgba(168, 85, 247, 0.08);
}

[data-theme="aurora"] .attach-btn:hover {
  color: #2268f5;
  background: rgba(34, 104, 245, 0.08);
}

[data-theme="pop"] .attach-btn:hover {
  color: #a855f7;
  background: rgba(168, 85, 247, 0.06);
}

/* ============ Textarea ============ */
.textarea-wrap {
  flex: 1;
  position: relative;
  min-width: 0;
}

.chat-textarea {
  width: 100%;
  padding: 9px 44px 9px 6px;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow-y: auto;
  min-height: 24px;
}

.chat-textarea::placeholder {
  color: var(--color-text-tertiary);
  opacity: 0.8;
}

.chat-textarea::-webkit-scrollbar {
  width: 3px;
}

.chat-textarea::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 3px;
}

.char-count {
  position: absolute;
  right: 10px;
  bottom: 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  opacity: 0.6;
  background: var(--color-bg-elevated);
  padding: 1px 4px;
  border-radius: 4px;
}

.count-fade-enter-active,
.count-fade-leave-active {
  transition: opacity 150ms ease;
}

.count-fade-enter-from,
.count-fade-leave-to {
  opacity: 0;
}

/* ============ Send / Stop Buttons ============ */
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
  margin-bottom: 1px;
}

/* -- Send button: prominent gradient -- */
.send-btn {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  color: white;
  box-shadow: 0 2px 8px rgba(168, 85, 247, 0.25);
}

.send-btn:disabled {
  background: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
  filter: none;
  transform: none;
}

.send-btn:not(:disabled):hover {
  transform: translateY(-1px) scale(1.08);
  box-shadow: 0 4px 16px rgba(168, 85, 247, 0.35);
  filter: brightness(1.08);
}

.send-btn:not(:disabled):active {
  transform: scale(0.93);
  box-shadow: 0 1px 4px rgba(168, 85, 247, 0.2);
}

/* Theme variants */
[data-theme="aurora"] .send-btn:not(:disabled) {
  background: linear-gradient(135deg, #2268f5, #4f46e5);
  box-shadow: 0 2px 8px rgba(34, 104, 245, 0.25);
}

[data-theme="aurora"] .send-btn:not(:disabled):hover {
  box-shadow: 0 4px 20px rgba(34, 104, 245, 0.4), 0 0 40px rgba(79, 70, 229, 0.15);
}

[data-theme="pop"] .send-btn:not(:disabled) {
  background: linear-gradient(135deg, #a855f7, #ec4899);
  box-shadow: 0 2px 8px rgba(168, 85, 247, 0.25);
}

[data-theme="pop"] .send-btn:not(:disabled):hover {
  box-shadow: 0 4px 20px rgba(168, 85, 247, 0.4), 0 0 40px rgba(236, 72, 153, 0.12);
}

/* Animated glow ring */
.send-btn:not(:disabled)::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 14px;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: -1;
}

[data-theme="aurora"] .send-btn:not(:disabled)::after {
  background: conic-gradient(from 0deg, transparent, rgba(34, 104, 245, 0.25), transparent, rgba(79, 70, 229, 0.25), transparent);
  animation: glowSpin 3s linear infinite;
}

[data-theme="pop"] .send-btn:not(:disabled)::after {
  background: conic-gradient(from 0deg, transparent, rgba(168, 85, 247, 0.25), transparent, rgba(236, 72, 153, 0.25), transparent);
  animation: glowSpin 3s linear infinite;
}

.agent-chat-input.focused .send-btn:not(:disabled)::after {
  opacity: 1;
}

@keyframes glowSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* -- Stop button: urgent red -- */
.stop-btn {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
  animation: stopPulse 1.5s ease-in-out infinite;
}

.stop-btn:hover {
  filter: brightness(1.15);
  transform: scale(1.05);
}

.stop-btn:active {
  transform: scale(0.93);
  animation: none;
}

@keyframes stopPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
  50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}

/* Button swap transition */
.action-swap-enter-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.action-swap-leave-active {
  transition: all 0.15s ease;
}

.action-swap-enter-from {
  opacity: 0;
  transform: scale(0.8) rotate(-10deg);
}

.action-swap-leave-to {
  opacity: 0;
  transform: scale(0.8) rotate(10deg);
}

/* ============ Hint (disclaimer) ============ */
.input-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 6px;
  font-size: 10px;
  color: var(--color-text-tertiary);
  letter-spacing: 0.02em;
  opacity: 0.45;
  transition: opacity 0.2s ease;
}

.agent-chat-input.focused .input-hint {
  opacity: 0.6;
}

.disclaimer {
  font-style: italic;
}
</style>
