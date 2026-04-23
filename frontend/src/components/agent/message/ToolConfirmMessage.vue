<template>
  <div class="tool-confirm">
    <span class="confirm-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </span>
    <div class="confirm-body">
      <p class="confirm-label">需要确认</p>
      <p class="confirm-msg">{{ message }}</p>
      <div class="confirm-actions">
        <button class="confirm-btn cancel" @click="handleCancel">取消</button>
        <button class="confirm-btn ok" @click="handleConfirm">确认</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  message: string
}

defineProps<Props>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const handleConfirm = () => emit('confirm')
const handleCancel = () => emit('cancel')
</script>

<style scoped>
.tool-confirm {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  margin: 8px 16px;
  border-radius: 12px;
  background: var(--color-success-bg, rgba(16, 185, 129, 0.12));
  border: 1px solid transparent;
}

[data-theme="aurora"] .tool-confirm {
  border-color: rgba(16, 185, 129, 0.25);
}

[data-theme="pop"] .tool-confirm {
  border-color: rgba(16, 185, 129, 0.2);
}

.confirm-icon {
  flex-shrink: 0;
  color: var(--color-success);
  display: flex;
}

.confirm-body {
  flex: 1;
  min-width: 0;
}

.confirm-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-success);
  margin-bottom: 4px;
}

.confirm-msg {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

.confirm-btn {
  padding: 5px 18px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast, 150ms ease);
}

.confirm-btn.cancel {
  background: var(--color-bg-hover, var(--color-bg-secondary));
  color: var(--color-text-secondary);
}

.confirm-btn.cancel:hover {
  color: var(--color-text-primary);
}

.confirm-btn.ok {
  background: var(--color-success);
  color: white;
}

.confirm-btn.ok:hover {
  filter: brightness(1.1);
}
</style>
