# 管理端 UI 重构设计

日期: 2026-04-23

## 背景

当前管理端 UI 存在以下问题：
- 管理页面嵌套在公共路由下，布局和公共页面共享，缺乏管理端专用布局
- 样式用 scoped CSS，没有统一的设计系统，视觉一致性差
- 数据分析页面使用 mock 数据，未对接后端
- 没有仪表盘首页，缺乏系统级概览
- 缺少知识库管理功能

## 目标

全面重构管理端 UI：视觉升级、交互优化、架构改善。

## 方案选择

**渐进式重构**：在现有代码基础上逐步改造，新建独立管理端 Layout，引入 Tailwind CSS，逐页迁移。

选择理由：管理端页面不多（4 个现有 + 2 个新增），全量重写收益不大；渐进式风险低，可随时验证。

## 技术选型

| 层面 | 选择 | 说明 |
|------|------|------|
| 布局样式 | Tailwind CSS | 整体布局、间距、自定义样式 |
| 组件库 | Ant Design Vue 4.x | 交互组件（Table、Form、Modal、Upload 等） |
| 状态管理 | Pinia (已有) | 管理端新增 admin store |
| 图表 | ECharts (已有) | 仪表盘和数据分析页 |

样式策略：Tailwind 做布局 + Ant Design 做组件，两者职责分明。

## 路由设计

将管理端路由从公共路由中完全拆分：

```
/                          → 公共页面 (BasicLayout)
  /diagnosis, /news, /agent, /user/login, /user/userCenter

/admin                     → 管理端 (AdminLayout) [ADMIN 权限]
  /admin/dashboard         → 仪表盘首页 (新增)
  /admin/users             → 用户管理
  /admin/news              → 新闻管理
  /admin/diagnosis         → 诊断管理
  /admin/knowledge         → 知识库管理 (新增)
  /admin/data-analysis     → 数据分析
```

## AdminLayout 结构

```
┌────────────────────────────────────────────┐
│  Header: Logo + "管理后台" + 面包屑 + 用户信息  │
├─────────┬──────────────────────────────────┤
│ Sidebar │                                  │
│         │                                  │
│ 仪表盘   │       Main Content Area          │
│ 用户管理  │                                  │
│ 新闻管理  │                                  │
│ 诊断管理  │                                  │
│ 知识库   │                                  │
│ 数据分析  │                                  │
│         │                                  │
│ ─────── │                                  │
│ 返回前台  │                                  │
└─────────┴──────────────────────────────────┘
```

## 页面设计

### 1. 仪表盘首页 /admin/dashboard (新增)

系统关键指标概览：
- 统计卡片区：用户总数、诊断次数、今日新增诊断、知识库文件数
- 趋势图：近 7 天/30 天诊断趋势（折线图）
- 最近诊断记录：最新 5 条诊断记录简要列表
- 饼图：疾病类型分布

### 2. 用户管理 /admin/users (重构)

- 搜索栏：账号/昵称搜索 + 重置按钮
- 数据表格：用户列表（头像、账号、昵称、角色、注册时间、操作）
- 操作：查看详情、删除（二次确认）

### 3. 新闻管理 /admin/news (重构)

- 搜索栏：标题搜索 + 新增按钮
- 数据表格：新闻列表（标题、摘要、创建时间、操作）
- 操作：编辑（跳转编辑页）、删除（二次确认）

### 4. 诊断管理 /admin/diagnosis (重构)

- 搜索栏：疾病名称搜索 + 时间范围筛选
- 数据表格：诊断记录（用户、图片缩略图、诊断结果、时间、操作）
- 操作：查看详情（侧滑抽屉）、删除、重新诊断
- 详情抽屉：诊断图片、AI 分析结果、诊断建议

### 5. 知识库管理 /admin/knowledge (新增)

基础文件管理：
- 文件列表：文件名、类型、大小、上传时间、状态
- 上传区域：拖拽上传 PDF/Word/图片
- 操作：预览、删除、查看解析状态
- 后端 API 未就绪部分先用 mock 数据

### 6. 数据分析 /admin/data-analysis (重构)

对接真实后端 API 替代 mock 数据：
- 统计概览卡片：总诊断数、确诊数、准确率
- 图表区（可按时间筛选）：诊断趋势（折线）、疾病分布（饼图）、用户活跃度（柱状图）

## 文件结构

```
src/
├── layouts/
│   ├── BasicLayout.vue          # (保持不变)
│   └── AdminLayout.vue          # (新增)
│
├── pages/admin/
│   ├── DashboardPage.vue        # (新增)
│   ├── UserManagePage.vue       # (重构)
│   ├── NewsManagePage.vue       # (重构)
│   ├── DiagnosisManagePage.vue  # (重构)
│   ├── KnowledgePage.vue        # (新增)
│   └── DataAnalysisPage.vue     # (重构)
│
├── components/admin/
│   ├── StatsCard.vue            # (重构)
│   ├── AdminSidebar.vue         # (新增)
│   ├── AdminHeader.vue          # (新增)
│   └── KnowledgeUpload.vue      # (新增)
│
├── router/
│   ├── index.ts
│   └── modules/
│       ├── publicRoutes.ts
│       └── adminRoutes.ts       # (新增)
│
├── stores/
│   └── admin.ts                 # (新增)
│
└── api/                         # (新增知识库 API 后重新生成)
```

## Tailwind CSS 集成

- 安装 tailwindcss + @tailwindcss/vite
- tailwind.config.js content 指向 src/**/*.{vue,ts}
- 职责：布局（flex、grid、间距）、响应式、自定义样式
- 不用 Tailwind 覆盖 Ant Design 组件内部样式
- 保留 base.css 和 main.css，新增 admin.css

## 迁移步骤

1. 搭建 AdminLayout + 路由分离 + Tailwind 配置
2. 逐页迁移：每完成一页验证后再迁移下一页
3. 公共页面（首页、诊断、Agent）完全不受影响
4. 所有页面迁移完成后删除旧的 SystemManagePage.vue
