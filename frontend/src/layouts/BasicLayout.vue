<template>
  <div id="basicLayout">
    <a-layout :style="isAgentPage ? 'height: 100vh' : 'min-height: 100vh'">
      <a-layout-header class="header">
        <GlobalHeader></GlobalHeader>
      </a-layout-header>
      <a-layout-content class="content" :class="{ 'content--flush': isAgentPage }">
        <router-view />
      </a-layout-content>
      <GlobalFooter v-if="!isAgentPage" />
      <ScrollToTop v-if="!isAgentPage" />
    </a-layout>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import GlobalHeader from '@/components/GlobalHeader.vue'
import GlobalFooter from '@/components/GlobalFooter.vue'
import ScrollToTop from '@/components/ScrollToTop.vue'

const route = useRoute()
const isAgentPage = computed(() => route.path.startsWith('/agent'))
</script>

<style scoped>
#basicLayout {
  margin: 0;
  padding: 0;
}

#basicLayout .content {
  background: var(--claude-bg-page);
  padding: 0 0 20px 0;
}

#basicLayout .content.content--flush {
  padding: 0;
  flex: 1;
  overflow: hidden;
}

#basicLayout .header {
  padding: 0;
  height: auto;
  line-height: normal;
  background: transparent;
}
</style>
