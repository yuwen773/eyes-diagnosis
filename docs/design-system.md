# 前端设计系统（Clinical Editorial，已弃用）

> **已弃用（deprecated，2026-11-10 起）**：`frontend/`（Vue）已停止开发。
> 产品前端与设计真源是根 `DESIGN.md` 与 `web/`（React）；本文仅保留为旧实现的历史参考，不再更新。
>
> 品牌令牌实现是 `frontend/src/styles/design-system/variables.css`（`--iris-*`）；
> `frontend/src/assets/claude-tokens.css` 只放主题覆盖。

## Users

混合用户群——眼科医生（临床检查）、医院管理员（记录管理/系统运维）、普通患者（AI 自助诊断）。三种角色技术熟练度和使用场景差异大，界面需根据角色调整复杂度。

## Brand Personality

**温暖、专业、关怀**。药用青绿主色 + 米色背景传递人文关怀，Georgia 衬线标题传达医疗专业性，柔和圆角和暖色阴影营造被温柔对待的感受。

## Aesthetic Direction

**医疗编辑风（Clinical Editorial）**，2026-07-28 由用户在四个预览方向中选定 A。浅色为主、暖墨深色为辅。

## Design Rules

- **品牌主色是药用青绿 `--iris-accent: #1b7f6b`**，不是旧的赤陶 `#c96442`。新代码直接用 `--iris-*`，不要写 `var(--claude-*)`——那是废弃别名。
- **严重度语义色与品牌色解耦**：低/中/高风险用 `--iris-sev-low/moderate/high`，不跟随品牌色。
- **所有数字用等宽字体** `--iris-font-mono`（JetBrains Mono）——置信度、病灶计数、时间戳。
- **衬线标题用 `--iris-font-serif`（Georgia），weight 只允许 500–600，禁止 700+ 与斜体**；正文与控件用 `--iris-font-sans`。
- **发丝线优先于厚重卡片阴影**，需要层级时才用极轻阴影。
- **AI 装饰零容忍**：不用粒子、扫描线、光环动画、圆形渐变装饰、居中 hero 大标题。
- 页面骨架用 sub-style B：顶部 KPI 条（mono 指标 4 列）+ 章节 overline + `.dt-row` 表格行 + `.card-accent` 顶部条。

## 参考实现

`HomePage.vue`、`user/UserLoginPage.vue`、`user/UserRegisterPage.vue` 已按上述规则重写，可复用其原语（`.kpi-card`、`.dt-row`、`.section-overline`、`.card-accent`）。其余 17 个页面尚未按 B 风格重写，改到时以这三页为模板。

## Priority Areas

1. **诊断流程**：登录、首页、图片上传、诊断结果——用户最先接触的核心路径
2. **用户中心**：个人中心、诊断历史、通知——高频使用功能
3. **Agent 智能对话**：AI 对话、会话管理、资源面板——最复杂的交互界面

## Design Principles

1. **温度优先**：暖色调、柔和圆角、友善文案，让用户感到被关心
2. **角色自适应**：医生看专业数据，患者看通俗解读，同一系统不同复杂度
3. **克制之美**：青绿点缀而非铺满，每个视觉元素服务于信息或情感
4. **流畅过渡**：状态变化有流畅动效，传递系统响应性和可靠性
5. **双主题一致性**：浅色/深色传达相同品牌性格，非简单颜色翻转
