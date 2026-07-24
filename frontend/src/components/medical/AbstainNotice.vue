<template>
  <a-alert v-if="visible" :type="alertType" show-icon>
    <template #message>AI 暂未给出诊断结论</template>
    <p class="abstain-reason">{{ reasonText }}</p>
  </a-alert>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  rejected: boolean
  reason?: string
}>()

const visible = computed(() => props.rejected || !!props.reason)

const alertType = computed(() => (props.rejected ? 'error' : 'warning'))

const reasonText = computed(() => {
  if (props.rejected && props.reason === 'QUALITY_FAIL') {
    return '图片质量不符合要求：请重新拍摄清晰、光照均匀的眼底照片。'
  }
  if (props.rejected && props.reason === 'OOD') {
    return '图像与训练分布差异过大：不像是眼底图，请上传专业设备拍摄的影像。'
  }
  if (props.reason === 'LOW_CONFIDENCE') {
    return '模型置信度不足，请前往医院由医生面诊。'
  }
  return '诊断未给出。'
})
</script>

<style scoped>
.abstain-reason {
  margin: 4px 0 0;
  font-size: 13px;
}
</style>