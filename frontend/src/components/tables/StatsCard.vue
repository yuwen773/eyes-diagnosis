<script lang="ts" >
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    value: {
      type: [String, Number],
      required: true
    },
    label: {
      type: String,
      required: true
    }
  }
});

// const props = defineProps<{
//   value: {
//     type: [String, Number],
//     required: true
//   },
//   label: {
//     type: String,
//     required: true
//   }
// }>()

</script>

<template>
  <a-card class="stat-card">
    <div class="stat-value">{{ value }}</div>
    <div class="stat-label">{{ label }}</div>
  </a-card>
</template>

<style scoped>
.stat-card {
  text-align: center;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: var(--claude-text-primary);
  margin: 16px 0;
}

.stat-label {
  color: var(--claude-text-tertiary);
  font-size: 14px;
}
</style>
