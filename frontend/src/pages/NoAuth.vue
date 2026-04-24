<script lang="ts" setup>
</script>

<template>
  <a-result status="403" title="403 - Forbidden" sub-title="You do not have permission to access this page.">
    <template #extra>
      <a-button type="primary" @click="$router.push('/')">Back Home</a-button>
    </template>
  </a-result>
</template>
