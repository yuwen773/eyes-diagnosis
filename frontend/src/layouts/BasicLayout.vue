<template>
  <div id="basicLayout">
    <a-layout style="min-height: 100vh">
      <a-layout-header class="header">
        <GlobalHeader></GlobalHeader>
      </a-layout-header>
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
      <a-layout-footer class="footer">
        <a href="https://lyf1210.top" target="_blank">
          眼科智能诊断系统 by YuWen
        </a>
      </a-layout-footer>
    </a-layout>
  </div>
</template>

<script setup lang="ts">
import GlobalHeader from '@/components/GlobalHeader.vue'

</script>

<style scoped>
#basicLayout {
  margin: 0;
  padding: 0;
}
#basicLayout .footer {
  background: #efefef;
  padding: 16px;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
}
#basicLayout .content {
  background: linear-gradient(to right,#fefefe,#fff);
  margin-bottom: 28px;
  padding: 20px 0;
}
#basicLayout .header{
  padding-inline: 20px;
/*  margin-bottom: 16px;*/
  color:unset;
  background: white;
  padding: 0;
}
</style>
