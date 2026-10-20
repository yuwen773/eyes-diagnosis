<template>
  <a-config-provider :theme="claudeTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
// ant-design-vue theme tokens are configured via ConfigProvider

// 医疗编辑风（Clinical Editorial）antd 主题令牌。
// 同步要求：以下色值必须与 frontend/src/styles/design-system/variables.css 的 --iris-* 保持同值（单一真源）。
const claudeTheme = {
  token: {
    colorPrimary: '#1b7f6b',
    colorBgLayout: '#f6f4ef',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorText: '#16140f',
    colorTextSecondary: '#6f6a5e',
    colorTextTertiary: '#9a9587',
    colorBorder: '#e6e2d8',
    colorBorderSecondary: '#d9d4c6',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    colorError: '#b53333',
    colorSuccess: '#2f9e6e',
    colorWarning: '#b37708',
  },
  components: {
    Button: {
      primaryShadow: '0 2px 4px rgba(22, 20, 15, 0.08)',
      defaultBorderColor: '#d9d4c6',
      colorPrimaryHover: '#155f51',
    },
    Card: {
      colorBgContainer: '#ffffff',
      borderRadiusLG: 12,
    },
    Menu: {
      darkItemBg: '#16140f',
      darkSubMenuItemBg: '#100f0b',
      darkItemColor: '#fbfaf6',
      darkItemHoverColor: '#f6f4ef',
      darkItemSelectedBg: 'rgba(27, 127, 107, 0.22)',
      darkItemSelectedColor: '#4ba693',
    },
    Table: {
      colorBgContainer: '#ffffff',
      headerBg: '#f6f4ef',
      borderColor: '#e6e2d8',
      rowHoverBg: '#fbfaf6',
    },
    Input: {
      colorBgContainer: '#ffffff',
      activeBorderColor: '#1b7f6b',
      hoverBorderColor: '#4ba693',
    },
    Modal: {
      colorBgElevated: '#ffffff',
      borderRadiusLG: 12,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Select: {
      colorBgContainer: '#ffffff',
      colorBgElevated: '#ffffff',
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