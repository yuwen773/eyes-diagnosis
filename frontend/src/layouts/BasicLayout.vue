<template>
  <div id="basicLayout">
    <a-layout style="min-height: 100vh">
      <a-layout-header class="header">
        <GlobalHeader></GlobalHeader>
      </a-layout-header>
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
      <GlobalFooter />
    </a-layout>
  </div>
</template>

<script setup lang="ts">
import GlobalHeader from '@/components/GlobalHeader.vue'
import GlobalFooter from '@/components/GlobalFooter.vue'
</script>

<style scoped>
#basicLayout {
  margin: 0;
  padding: 0;
}

#basicLayout .content {
  background: var(--claude-bg-page);
  padding: 20px 0;
}

#basicLayout .header {
  padding-inline: 20px;
  color: unset;
  background: white;
  padding: 0;
}
</style>
