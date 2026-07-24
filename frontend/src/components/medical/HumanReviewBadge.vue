<template>
  <a-tag :color="color">{{ label }}</a-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

const label = computed(() => {
  switch (props.status) {
    case 'PENDING_AI':
      return '待 AI 出具'
    case 'AI_ONLY':
      return '仅 AI 结论'
    case 'AWAITING_REVIEW':
      return '需人工复核'
    case 'REVIEWED':
      return '已人工复核'
    case 'OVERRIDDEN':
      return '已推翻 AI 结论'
    default:
      return '未知'
  }
})

const color = computed(() => {
  switch (props.status) {
    case 'REVIEWED':
      return 'green'
    case 'AWAITING_REVIEW':
      return 'gold'
    case 'OVERRIDDEN':
      return 'purple'
    case 'AI_ONLY':
      return 'blue'
    default:
      return 'default'
  }
})
</script>