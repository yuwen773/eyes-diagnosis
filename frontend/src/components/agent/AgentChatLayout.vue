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
  background: var(--color-bg-primary);
}

.layout-left {
  width: 260px;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease;
  overflow: hidden;
}

.layout-left.collapsed {
  width: 0;
  opacity: 0;
}

.layout-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.layout-right {
  width: 0;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-border-subtle);
}

.layout-right.expanded {
  width: 320px;
}
</style>
