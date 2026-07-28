<script setup lang="ts">
/**
 * ReviewActionPanel —— 完全由 allowedActions 数组驱动的审核操作面板。
 *
 * 铁律：本组件不做任何业务判断（不看置信度、不看状态、不隐藏按钮），
 * 传入什么动作就渲染什么按钮；allowedActions 为空时只提示不可操作。
 */
import { ref } from 'vue'
import type { ReviewDecisionCode } from '@/api/review'
import { DECISION_LABELS } from '@/api/review'

const props = defineProps<{
  allowedActions: ReviewDecisionCode[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { decision: ReviewDecisionCode; comment: string }): void
}>()

const selected = ref<ReviewDecisionCode | null>(null)
const comment = ref('')

const choose = (action: ReviewDecisionCode) => {
  selected.value = action
}

const submit = () => {
  if (!selected.value || props.submitting) return
  emit('submit', { decision: selected.value, comment: comment.value.trim() })
}
</script>

<template>
  <section class="review-panel" data-testid="review-action-panel">
    <h3 class="review-panel__title">审核操作</h3>

    <p v-if="allowedActions.length === 0" class="review-panel__empty" data-testid="review-no-actions">
      当前任务暂无可执行的审核动作
    </p>

    <template v-else>
      <div class="review-panel__actions" role="radiogroup" aria-label="审核决定">
        <button
          v-for="action in allowedActions"
          :key="action"
          type="button"
          class="review-action"
          :class="{ 'review-action--selected': selected === action }"
          :data-action="action"
          :aria-pressed="selected === action"
          @click="choose(action)"
        >
          {{ DECISION_LABELS[action] ?? action }}
        </button>
      </div>

      <label class="review-panel__comment-label" for="review-comment">审核备注（可选）</label>
      <textarea
        id="review-comment"
        v-model="comment"
        class="review-panel__comment"
        rows="3"
        placeholder="补充说明本次审核判断依据…"
        data-testid="review-comment"
      ></textarea>

      <button
        type="button"
        class="review-panel__submit"
        data-testid="review-submit"
        :disabled="!selected || submitting"
        @click="submit"
      >
        {{ submitting ? '提交中…' : '提交审核决定' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.review-panel {
  background: #faf9f5;
  border: 1px solid #e8e6dc;
  border-radius: 12px;
  padding: 20px 24px;
}
.review-panel__title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  color: #141413;
  margin: 0 0 14px;
}
.review-panel__empty {
  font-size: 13px;
  color: #8f8d86;
  margin: 0;
}
.review-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.review-action {
  border: 1px solid #ded9cb;
  background: #fff;
  color: #33322f;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.review-action:hover {
  border-color: #c96442;
  color: #c96442;
}
.review-action--selected {
  border-color: #c96442;
  background: rgba(201, 100, 66, 0.1);
  color: #c96442;
  font-weight: 600;
}
.review-panel__comment-label {
  display: block;
  font-size: 13px;
  color: #6b6a66;
  margin-bottom: 6px;
}
.review-panel__comment {
  width: 100%;
  border: 1px solid #ded9cb;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 14px;
  color: #141413;
  background: #fff;
  resize: vertical;
  box-sizing: border-box;
  margin-bottom: 14px;
}
.review-panel__comment:focus {
  outline: none;
  border-color: #c96442;
}
.review-panel__submit {
  background: #c96442;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 9px 22px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.review-panel__submit:hover:not(:disabled) {
  background: #b5502f;
}
.review-panel__submit:disabled {
  background: #d9d7cd;
  cursor: not-allowed;
}
</style>
