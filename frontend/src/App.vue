<template>
  <a-config-provider :theme="claudeTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
// ant-design-vue theme tokens are configured via ConfigProvider

const claudeTheme = {
  token: {
    colorPrimary: '#c96442',
    colorBgLayout: '#f5f4ed',
    colorBgContainer: '#faf9f5',
    colorBgElevated: '#ffffff',
    colorText: '#141413',
    colorTextSecondary: '#5e5d59',
    colorTextTertiary: '#87867f',
    colorBorder: '#f0eee6',
    colorBorderSecondary: '#e8e6dc',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
    colorError: '#b53333',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
  },
  components: {
    Button: {
      primaryShadow: '0 2px 4px rgba(20, 20, 19, 0.1)',
      defaultBorderColor: '#e8e6dc',
      colorPrimaryHover: '#d97757',
    },
    Card: {
      colorBgContainer: '#faf9f5',
      borderRadiusLG: 12,
    },
    Menu: {
      darkItemBg: '#30302e',
      darkSubMenuItemBg: '#252523',
      darkItemColor: '#faf9f5',
      darkItemHoverColor: '#f5f4ed',
      darkItemSelectedBg: 'rgba(201, 100, 66, 0.15)',
      darkItemSelectedColor: '#d97757',
    },
    Table: {
      colorBgContainer: '#faf9f5',
      headerBg: '#f5f4ed',
      borderColor: '#f0eee6',
      rowHoverBg: '#faf9f5',
    },
    Input: {
      colorBgContainer: '#ffffff',
      activeBorderColor: '#c96442',
      hoverBorderColor: '#d97757',
    },
    Modal: {
      colorBgElevated: '#faf9f5',
      borderRadiusLG: 12,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Select: {
      colorBgContainer: '#ffffff',
      colorBgElevated: '#faf9f5',
    },
  },
}
</script>

<style>
#app {
  margin: 0;
  padding: 0;
}
</style>