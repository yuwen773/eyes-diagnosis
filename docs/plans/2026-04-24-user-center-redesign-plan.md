# 用户端个人中心全面改版 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 DESIGN.md 设计系统，完成用户端个人中心的全面改版，包含统计卡片、图表、通知中心、响应式适配等功能

**Architecture:** 建设共享设计系统 CSS 变量和组件，逐步重构各页面，最后集成通知中心

**Tech Stack:** Vue 3 + Vite + TypeScript + Ant Design Vue + ECharts/Ant Design Charts

---

## 阶段一：设计系统基础建设

### 任务 1.1: 创建 CSS 变量文件

**文件:**
- 创建: `frontend/src/styles/design-system/variables.css`

**步骤:**

**Step 1: 创建 variables.css 文件**

```css
/* Design System Variables - Based on DESIGN.md */
:root {
  /* Colors - Background & Surface */
  --color-bg: #f5f4ed;           /* Parchment - 页面背景 */
  --color-surface: #faf9f5;       /* Ivory - 卡片/容器背景 */
  --color-surface-dark: #30302e;   /* Dark Surface - 深色表面 */
  --color-surface-elevated: #ffffff; /* Pure White - 提升元素 */

  /* Colors - Primary & Accent */
  --color-primary: #c96442;       /* Terracotta - 主按钮/强调色 */
  --color-primary-hover: #b55a3a; /* Terracotta hover */
  --color-accent: #d97757;       /* Coral - 次要强调 */

  /* Colors - Text */
  --color-text: #141413;         /* Near Black - 主文字 */
  --color-text-secondary: #5e5d59; /* Olive Gray - 次要文字 */
  --color-text-tertiary: #87867f; /* Stone Gray - 辅助文字 */
  --color-text-on-dark: #b0aea5;  /* Warm Silver - 深色背景上的文字 */

  /* Colors - Border */
  --color-border: #f0eee6;        /* Border Cream - 边框 */
  --color-border-strong: #e8e6dc; /* Border Warm - 强调边框 */
  --color-border-dark: #30302e;   /* Border Dark - 深色边框 */

  /* Colors - Semantic */
  --color-error: #b53333;        /* Error Crimson */
  --color-success: #4a7c59;      /* Success Green */
  --color-info: #3898ec;         /* Focus Blue - 唯一冷色调 */

  /* Typography */
  --font-serif: Georgia, 'Times New Roman', serif;
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  --font-mono: 'SF Mono', 'Monaco', 'Inconsolata', monospace;

  /* Font Sizes */
  --text-xs: 0.75rem;    /* 12px - Label */
  --text-sm: 0.875rem;    /* 14px - Caption */
  --text-base: 1rem;     /* 16px - Body */
  --text-lg: 1.125rem;   /* 18px - Body Large */
  --text-xl: 1.25rem;    /* 20px - Sub-heading */
  --text-2xl: 1.5rem;    /* 24px - Feature Title */
  --text-3xl: 1.875rem;  /* 30px - Sub-heading Small */
  --text-4xl: 2.25rem;   /* 36px - Sub-heading */
  --text-5xl: 3rem;      /* 48px - Section Heading */

  /* Line Heights */
  --leading-tight: 1.10;   /* Headlines */
  --leading-snug: 1.20;   /* Sub-headlines */
  --leading-normal: 1.50; /* Body */
  --leading-relaxed: 1.60; /* Body Serif */

  /* Spacing */
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */

  /* Border Radius */
  --radius-sm: 4px;        /* 最小圆角 */
  --radius-md: 8px;        /* 卡片 */
  --radius-lg: 12px;       /* 按钮/输入框 */
  --radius-xl: 16px;       /* 大容器 */
  --radius-2xl: 24px;      /* 标签容器 */
  --radius-full: 9999px;   /* 圆形 */

  /* Shadows */
  --shadow-whisper: 0px 4px 24px rgba(0, 0, 0, 0.05);
  --shadow-ring: 0px 0px 0px 1px;
  --shadow-ring-hover: 0px 0px 0px 2px var(--color-primary);

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 350ms ease;

  /* Z-Index */
  --z-dropdown: 100;
  --z-modal: 1000;
  --z-tooltip: 1100;
}
```

**Step 2: 创建基础样式文件 base.css**

```css
/* Base Styles - Design System */
@import './variables.css';

/* Reset */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text);
  background-color: var(--color-bg);
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-serif);
  font-weight: 500;
  line-height: var(--leading-tight);
  color: var(--color-text);
}

h1 { font-size: var(--text-5xl); }
h2 { font-size: var(--text-4xl); }
h3 { font-size: var(--text-3xl); }
h4 { font-size: var(--text-2xl); }
h5 { font-size: var(--text-xl); }
h6 { font-size: var(--text-lg); }

p {
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

/* Links */
a {
  color: var(--color-primary);
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--color-primary-hover);
}

/* Buttons - Base */
button {
  font-family: var(--font-sans);
  cursor: pointer;
  border: none;
  background: none;
}

/* Selection */
::selection {
  background-color: var(--color-primary);
  color: var(--color-surface-elevated);
}
```

**Step 3: 创建公共组件样式 components.css**

```css
/* Component Styles - Design System */
@import './variables.css';

/* Card Component */
.ds-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  box-shadow: var(--shadow-whisper);
}

.ds-card-elevated {
  background: var(--color-surface-elevated);
}

/* Button Components */
.ds-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: 500;
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
  cursor: pointer;
}

.ds-btn-primary {
  background: var(--color-primary);
  color: var(--color-surface-elevated);
  box-shadow: var(--shadow-ring), 0px 0px 0px 1px var(--color-primary);
}

.ds-btn-primary:hover {
  background: var(--color-primary-hover);
}

.ds-btn-secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
}

.ds-btn-secondary:hover {
  background: var(--color-border);
}

/* Input Components */
.ds-input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--color-text);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
}

.ds-input:focus {
  outline: none;
  border-color: var(--color-info);
  box-shadow: 0 0 0 3px rgba(56, 152, 236, 0.2);
}

/* Tag/Badge */
.ds-tag {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-full);
  background: var(--color-border);
  color: var(--color-text-secondary);
}

.ds-tag-primary {
  background: var(--color-primary);
  color: var(--color-surface-elevated);
}

.ds-tag-success {
  background: var(--color-success);
  color: var(--color-surface-elevated);
}

/* Stat Card */
.ds-stat-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.ds-stat-value {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1;
}

.ds-stat-label {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  margin-top: var(--space-2);
}

/* Page Container */
.ds-page {
  padding: var(--space-6);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  min-height: 100%;
}

/* Responsive Grid */
.ds-grid {
  display: grid;
  gap: var(--space-6);
}

.ds-grid-2 { grid-template-columns: repeat(2, 1fr); }
.ds-grid-3 { grid-template-columns: repeat(3, 1fr); }
.ds-grid-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 768px) {
  .ds-grid-2,
  .ds-grid-3,
  .ds-grid-4 {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 479px) {
  .ds-grid-2,
  .ds-grid-3,
  .ds-grid-4 {
    grid-template-columns: 1fr;
  }
}
```

**Step 4: 提交**

```bash
cd frontend/src/styles
mkdir -p design-system
git add design-system/
git commit -m "feat(ui): add design system CSS foundation

- Add variables.css with design tokens from DESIGN.md
- Add base.css with typography and reset styles
- Add components.css with reusable component styles

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 1.2: 创建 StatCard 统计卡片组件

**文件:**
- 创建: `frontend/src/components/user/StatCard.vue`

**步骤:**

**Step 1: 创建 StatCard.vue**

```vue
<template>
  <div class="ds-stat-card">
    <div class="ds-stat-value">{{ value }}</div>
    <div class="ds-stat-label">{{ label }}</div>
    <div v-if="trend" class="ds-stat-trend" :class="trendClass">
      {{ trendText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  value: string | number
  label: string
  trend?: number // 正数表示上升，负数表示下降
  prefix?: string
  suffix?: string
}

const props = withDefaults(defineProps<Props>(), {
  value: 0,
  label: '',
  trend: undefined,
  prefix: '',
  suffix: ''
})

const trendClass = computed(() => {
  if (!props.trend) return ''
  return props.trend > 0 ? 'trend-up' : 'trend-down'
})

const trendText = computed(() => {
  if (!props.trend) return ''
  const sign = props.trend > 0 ? '+' : ''
  return `${sign}${props.trend}%`
})
</script>

<style scoped>
@import '@/styles/design-system/variables.css';

.ds-stat-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: all var(--transition-normal);
}

.ds-stat-card:hover {
  box-shadow: var(--shadow-whisper);
  transform: translateY(-2px);
}

.ds-stat-value {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1;
}

.ds-stat-label {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  margin-top: var(--space-2);
}

.ds-stat-trend {
  font-size: var(--text-xs);
  margin-top: var(--space-2);
  font-weight: 500;
}

.trend-up {
  color: var(--color-success);
}

.trend-down {
  color: var(--color-error);
}
</style>
```

**Step 2: 提交**

```bash
git add components/user/StatCard.vue
git commit -m "feat(ui): add StatCard component for profile statistics

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 阶段二：UserCenter 布局重构

### 任务 2.1: 重构 UserCenter 主布局

**文件:**
- 修改: `frontend/src/pages/userCenter/UserCenter.vue`

**步骤:**

**Step 1: 阅读现有 UserCenter.vue 代码**

读取文件了解当前实现。

**Step 2: 应用设计系统变量，重构布局**

将现有布局代码更新为使用 design-system CSS 变量。

**Step 3: 提交**

```bash
git add pages/userCenter/UserCenter.vue
git commit -m "refactor(ui): apply design system to UserCenter layout

- Use CSS variables from design-system
- Update color scheme to match DESIGN.md
- Improve responsive breakpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 2.2: 重构 Sidebar 组件

**文件:**
- 修改: `frontend/src/pages/userCenter/UserCenter.vue` (Sidebar 部分)

**步骤:**

**Step 1: 更新 Sidebar 样式**

应用设计系统的配色和间距。

**Step 2: 添加通知铃铛图标**

在 Sidebar 顶部添加通知入口。

**Step 3: 提交**

```bash
git add pages/userCenter/UserCenter.vue
git commit -m "refactor(ui): improve UserCenter sidebar with notification icon

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 2.3: 添加响应式支持

**文件:**
- 修改: `frontend/src/pages/userCenter/UserCenter.vue` (响应式部分)

**步骤:**

**Step 1: 添加移动端 Tab 导航**

在小于 768px 时，Sidebar 变为顶部 Tab 栏。

**Step 2: 测试响应式断点**

验证各断点下的布局正确性。

**Step 3: 提交**

```bash
git add pages/userCenter/UserCenter.vue
git commit -m "feat(ui): add responsive mobile tab navigation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 阶段三：Profile 页面重构

### 任务 3.1: 重构 Profile 页面 - 统计卡片

**文件:**
- 修改: `frontend/src/pages/userCenter/Profile.vue`

**步骤:**

**Step 1: 添加统计卡片区域**

在页面顶部添加 4 个 StatCard 展示诊断统计数据。

**Step 2: 调用 API 获取统计数据**

添加 `getDiagnosisStats` 接口调用。

**Step 3: 提交**

```bash
git add pages/userCenter/Profile.vue
git commit -m "feat(ui): add diagnosis statistics cards to Profile page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 3.2: 重构 Profile 页面 - 信息展示

**文件:**
- 修改: `frontend/src/pages/userCenter/Profile.vue`

**步骤:**

**Step 1: 更新样式使用 design-system**

应用 CSS 变量替换硬编码颜色值。

**Step 2: 添加编辑资料入口**

在页面右上角添加"编辑资料"按钮。

**Step 3: 提交**

```bash
git add pages/userCenter/Profile.vue
git commit -m "refactor(ui): apply design system to Profile page styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 阶段四：AccountSetting 页面重构

### 任务 4.1: 添加密码修改功能

**文件:**
- 修改: `frontend/src/pages/userCenter/AccountSetting.vue`

**步骤:**

**Step 1: 添加密码修改表单区块**

在页面底部添加密码修改区域。

**Step 2: 调用修改密码 API**

集成 `updateUserPassword` 接口。

**Step 3: 提交**

```bash
git add pages/userCenter/AccountSetting.vue
git commit -m "feat(ui): add password change functionality to AccountSetting

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 4.2: 优化表单验证

**文件:**
- 修改: `frontend/src/pages/userCenter/AccountSetting.vue`

**步骤:**

**Step 1: 添加实时表单验证**

手机号、邮箱格式实时校验。

**Step 2: 添加表单提交反馈**

loading 状态和成功/失败提示。

**Step 3: 提交**

```bash
git add pages/userCenter/AccountSetting.vue
git commit -m "feat(ui): enhance form validation in AccountSetting

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 阶段五：DiagnosisHistory 页面增强

### 任务 5.1: 创建诊断趋势图表组件

**文件:**
- 创建: `frontend/src/components/user/DiagnosisTrendChart.vue`

**步骤:**

**Step 1: 创建图表组件**

使用 ECharts 或 @ant-design/charts 创建折线图和饼图。

**Step 2: 集成到 DiagnosisHistory**

在表格上方添加图表区域。

**Step 3: 提交**

```bash
git add components/user/DiagnosisTrendChart.vue
git commit -m "feat(ui): add diagnosis trend chart component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 5.2: 添加日期范围筛选

**文件:**
- 修改: `frontend/src/pages/userCenter/DiagnosisHistory.vue`

**步骤:**

**Step 1: 集成日期范围选择器**

使用 Ant Design DatePicker 实现日期筛选。

**Step 2: 更新 API 调用传递日期参数**

支持按日期范围查询。

**Step 3: 提交**

```bash
git add pages/userCenter/DiagnosisHistory.vue
git commit -m "feat(ui): add date range filter to DiagnosisHistory

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 5.3: 添加批量导出功能

**文件:**
- 修改: `frontend/src/pages/userCenter/DiagnosisHistory.vue`

**步骤:**

**Step 1: 添加批量选择功能**

表格前添加 checkbox 列。

**Step 2: 添加导出按钮**

下拉菜单支持导出 PDF/CSV。

**Step 3: 提交**

```bash
git add pages/userCenter/DiagnosisHistory.vue
git commit -m "feat(ui): add batch export to DiagnosisHistory

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 阶段六：通知中心（新增）

### 任务 6.1: 创建通知状态管理

**文件:**
- 创建: `frontend/src/stores/notification.ts`

**步骤:**

**Step 1: 创建 notification store**

使用 Pinia 管理通知列表和未读状态。

**Step 2: 添加通知 API 调用**

集成 `getNotificationList` 和 `markAsRead` 接口。

**Step 3: 提交**

```bash
git add stores/notification.ts
git commit -m "feat(store): add notification state management

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 6.2: 创建通知面板组件

**文件:**
- 创建: `frontend/src/components/user/NotificationPanel.vue`

**步骤:**

**Step 1: 创建通知面板组件**

展示通知列表，支持标记已读。

**Step 2: 添加空状态和加载状态**

处理无通知和加载中的 UI。

**Step 3: 提交**

```bash
git add components/user/NotificationPanel.vue
git commit -m "feat(ui): add NotificationPanel component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### 任务 6.3: 集成通知中心到 Sidebar

**文件:**
- 修改: `frontend/src/pages/userCenter/UserCenter.vue`

**步骤:**

**Step 1: 添加通知菜单项**

在侧边栏菜单添加"通知中心"项。

**Step 2: 创建 NotificationCenter 页面**

创建 `frontend/src/pages/userCenter/NotificationCenter.vue`

**Step 3: 配置路由**

在路由中添加通知中心页面。

**Step 4: 提交**

```bash
git add pages/userCenter/UserCenter.vue pages/userCenter/NotificationCenter.vue
git add router/index.ts
git commit -m "feat(ui): integrate notification center into UserCenter

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 阶段七：测试与验收

### 任务 7.1: 功能测试

**步骤:**

**Step 1: 测试 Profile 页面**

验证统计卡片数据显示正确。

**Step 2: 测试 AccountSetting 页面**

验证表单验证和保存功能。

**Step 3: 测试 DiagnosisHistory 页面**

验证筛选、图表、导出功能。

**Step 4: 测试通知中心**

验证通知列表和标记已读功能。

---

### 任务 7.2: 响应式测试

**步骤:**

**Step 1: 测试桌面端 (≥992px)**

双栏布局正常显示。

**Step 2: 测试平板端 (768-991px)**

侧边栏收起为图标模式。

**Step 3: 测试移动端 (<768px)**

顶部 Tab 导航正常切换。

---

### 任务 7.3: 视觉验收

**步骤:**

**Step 1: 对比 DESIGN.md 规范**

确认配色、字体、间距符合设计规范。

**Step 2: 提交最终代码**

```bash
git add .
git commit -m "feat(ui): complete user center redesign

- Design system CSS variables and components
- Responsive layout with mobile support
- Statistics cards and charts
- Notification center
- All pages follow DESIGN.md spec

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 总结

**实施顺序:**
1. 阶段一：设计系统基础（2个任务）
2. 阶段二：UserCenter 布局重构（3个任务）
3. 阶段三：Profile 页面重构（2个任务）
4. 阶段四：AccountSetting 页面重构（2个任务）
5. 阶段五：DiagnosisHistory 页面增强（3个任务）
6. 阶段六：通知中心（3个任务）
7. 阶段七：测试验收

**总任务数：** 15 个

---

## 执行选项

**计划已保存到 `docs/plans/2026-04-24-user-center-redesign-plan.md`**

两种执行方式：

**1. 子代理驱动（当前会话）** - 我dispatch新子代理执行每个任务，期间进行代码审查，快速迭代

**2. 并行会话（新会话）** - 在新会话中使用 executing-plans，批量执行带检查点

选择哪种方式？
