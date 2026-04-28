<template>
  <div id="basicLayout">
    <a-layout :style="layoutStyle">
      <a-layout-header v-if="!isAuthPage" class="header">
        <GlobalHeader></GlobalHeader>
      </a-layout-header>
      <a-layout-content class="content" :class="{ 'content--flush': isAgentPage || isAuthPage }">
        <router-view />
      </a-layout-content>
      <GlobalFooter v-if="showFooter" />
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
const isAuthPage = computed(() => route.path.startsWith('/user/login') || route.path.startsWith('/user/register'))
const showFooter = computed(() => !isAgentPage.value && !isAuthPage.value)
const layoutStyle = computed(() => {
  if (isAgentPage.value || isAuthPage.value) return 'height: 100vh; overflow: hidden'
  return ''
})
</script>

<style scoped>
#basicLayout {
  margin: 0;
  padding: 0;
}

#basicLayout .content {
  background: var(--claude-bg-page);
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
