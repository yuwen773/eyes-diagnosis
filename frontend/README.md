# Frontend - 眼科智能诊断前端

Vue 3 + TypeScript 单页应用，提供图像诊断、AI 问诊、健康资讯、用户中心、后台管理等功能。

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue 3 | 3.5 | 核心框架（Composition API + `<script setup>`） |
| TypeScript | 5.6 | 类型安全 |
| Vite | 5 | 构建工具 |
| Ant Design Vue | 4 | UI 组件库 |
| Tailwind CSS | v4 | 原子化 CSS |
| Pinia | 2 | 状态管理 |
| Vue Router | 4 | 路由 |
| ECharts | 5 | 图表 |
| @microsoft/fetch-event-source | 2 | SSE 流式通信（Agent 对话） |

## 目录结构

```
src/
├── api/                    # API 调用层
│   ├── typings.d.ts        # OpenAPI 自动生成的类型声明
│   ├── *Controller.ts      # 自动生成的 API 函数
│   ├── agentController.ts  # 手动编写（SSE 流式）
│   └── mcpController.ts    # 手动编写
├── assets/                 # 静态资源（图片、CSS 设计令牌）
├── components/             # 通用组件
│   ├── GlobalHeader.vue    # 顶部导航栏
│   ├── GlobalFooter.vue    # 页脚
│   ├── ImagePreview.vue    # 全屏图片查看器
│   ├── admin/              # 管理后台组件
│   ├── agent/              # AI 对话组件（7 个子组件 + 消息/设置子目录）
│   ├── diagnosis/          # 诊断组件（上传、结果展示）
│   ├── tables/             # 图表组件（Pie、Bar、Line）
│   └── user/               # 用户中心组件
├── composables/            # 组合式函数
│   ├── useAgentStream.ts   # SSE 流式对话核心逻辑
│   ├── useDiagnosisExport.ts # 诊断报告导出（CSV/PDF）
│   └── useDiagramRenderer.ts
├── config/                 # 应用配置
├── layouts/                # 布局组件
│   ├── BasicLayout.vue     # 公共布局（Header + Content + Footer）
│   └── AdminLayout.vue     # 管理布局（侧边栏 + Header）
├── pages/                  # 页面组件
│   ├── HomePage.vue        # 首页
│   ├── diagnosis/          # 诊断页
│   ├── agent/              # AI 对话页
│   ├── news/               # 资讯页（列表、详情、编辑）
│   ├── user/               # 登录、注册
│   ├── userCenter/         # 用户中心（个人资料、账户设置、诊断历史、通知）
│   └── admin/              # 管理后台（6 个页面）
├── router/                 # 路由配置
│   ├── index.ts            # 主路由
│   └── modules/adminRoutes.ts # 管理路由
├── stores/                 # Pinia Store
│   ├── user.ts             # 登录用户状态
│   ├── diagnosis.ts        # 诊断状态
│   └── notification.ts     # 通知状态
├── styles/                 # 设计系统
│   └── design-system/      # CSS 变量、重置、组件样式
├── types/                  # TypeScript 类型定义
└── utils/                  # 工具函数
    └── access/             # 权限控制（路由守卫）
```

## 页面路由

### 公共页面

| 路径 | 页面 | 权限 |
|------|------|------|
| `/` | 首页 | 公开 |
| `/diagnosis` | 疾病诊断 | 公开 |
| `/news` | 健康资讯 | 公开 |
| `/news/:id` | 资讯详情 | 公开 |
| `/agent` | AI 助手对话 | 公开 |
| `/user/login` | 登录 | 公开 |
| `/user/register` | 注册 | 公开 |

### 用户中心

| 路径 | 页面 | 权限 |
|------|------|------|
| `/user/userCenter/profile` | 个人资料 | 登录 |
| `/user/userCenter/accountSettings` | 账户设置 | 登录 |
| `/user/userCenter/diagnosisHistory` | 诊断历史 | 登录 |
| `/user/userCenter/notification` | 通知中心 | 登录 |

### 管理后台

| 路径 | 页面 | 权限 |
|------|------|------|
| `/admin/dashboard` | 仪表盘 | 管理员 |
| `/admin/users` | 用户管理 | 管理员 |
| `/admin/news` | 资讯管理 | 管理员 |
| `/admin/diagnosis` | 诊断管理 | 管理员 |
| `/admin/knowledge` | 知识库管理 | 管理员 |
| `/admin/data-analysis` | 数据分析 | 管理员 |

## 核心：Agent 对话系统

前端通过 `useAgentStream` 组合式函数与后端 SSE 端点通信：

- 使用 `@microsoft/fetch-event-source` 建立流式连接
- 按事件类型渲染不同消息组件（助手回复、推理过程、工具调用、工具结果、MCP 确认）
- 支持图片附件粘贴、会话管理、资源提取（图片/链接）

## 开发命令

```bash
npm install           # 安装依赖
npm run dev           # 开发服务器 http://localhost:5173
npm run build         # 类型检查 + 生产构建
npm run pure-build    # 仅构建（跳过类型检查）
npm run openapi       # 从后端 OpenAPI 规范重新生成 API 客户端
npm run lint          # ESLint 检查与修复
npm run format        # Prettier 格式化
npm run type-check    # TypeScript 类型检查
npm run preview       # 预览生产构建
```

## 环境变量

| 文件 | 变量 | 说明 |
|------|------|------|
| `.env.development` | `VITE_API_BASE_URL` | 后端 API 地址（默认 `http://localhost:8081/api`） |

## API 客户端生成

运行 `npm run openapi` 从后端 OpenAPI 规范自动生成 TypeScript API 客户端代码到 `src/api/` 目录。生成配置见 `openapi.config.js`。

## 样式架构

- **Tailwind CSS v4**：通过 Vite 插件引入，无配置文件
- **Ant Design Vue 4**：全局引入，自定义主题（陶土色 `#c96442` 为主色调）
- **设计令牌**：`src/assets/claude-tokens.css` 定义 CSS 自定义属性
- **设计系统**：`src/styles/design-system/` 包含变量、重置、组件样式

## Python 登录态与 OpenAPI（完整迁移工单 02）

前端继续使用现有登录/退出/失效引导，Axios 的 withCredentials 携带 HttpOnly EYE_SESSION。
三个会话端点和受保护 HTTP/SSE 均在 Python；旧 Spring Cookie 不复用。
启动 Python :8080 后运行 `npm run openapi`，来源为 `/api/openapi.json`；隔离端口可用 OPENAPI_SCHEMA_URL 覆盖。
生成器先写临时目录，保留 knowledge/mcp/workflow/review/supplement/toolConfirmation 六个手写适配器。
`openapi/overrides.ts` 保留现有上传和复诊函数签名；`src/api/compatibility.d.ts` 保留对应参数类型。
生成时恢复旧 TypeScript 的可选字段、数字 Long 声明、UserEdit 的已忽略字段与 chunkCount；
真实 HTTP Long 仍是字符串。这些兼容声明不是服务端校验规则，后续 UI 类型修正另列。
Python-only 控制器是新生成文件，现有页面仍调用六个适配器。生成器不覆盖它们，前端调用点无需改动。
参见 [验证记录](../docs/python-session-auth-evidence.md)。
