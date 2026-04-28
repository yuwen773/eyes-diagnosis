<template>
  <div class="agent-chat-layout">
    <!-- 左栏：历史列表 -->
    <aside class="layout-left" :class="{ collapsed: leftCollapsed }">
      <slot name="left" />
    </aside>

    <!-- 中间：消息+输入 -->
    <main class="layout-center">
      <slot name="center" />
    </main>

    <!-- 右栏：资源面板 -->
    <aside class="layout-right" :class="{ expanded: rightExpanded }">
      <slot name="right" />
    </aside>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  leftCollapsed?: boolean
  rightExpanded?: boolean
}>()
</script>

<style scoped>
.agent-chat-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--claude-bg-page);
}

.layout-left {
  flex-shrink: 0;
  width: 280px;
  transform: scaleX(1);
  transform-origin: left center;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease;
  overflow: hidden;
}

.layout-left.collapsed {
  transform: scaleX(0);
  opacity: 0;
}

.layout-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background: var(--claude-bg-page);
}

.layout-right {
  flex-shrink: 0;
  width: 340px;
  transform: scaleX(0);
  transform-origin: right center;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease;
  overflow: hidden;
  background: var(--claude-bg-card);
  border-left: 1px solid var(--claude-border-cream);
}

.layout-right:not(.expanded) {
  /* collapsed state — right panel starts hidden */
  transform: scaleX(0);
  opacity: 0;
  width: 0;
  border-left: none;
}

.layout-right.expanded {
  transform: scaleX(1);
  opacity: 1;
}
</style>
