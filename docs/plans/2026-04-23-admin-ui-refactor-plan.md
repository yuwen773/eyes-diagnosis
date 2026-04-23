# 管理端 UI 重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将管理端 UI 从公共路由中拆分出来，引入 Tailwind CSS + Ant Design Vue，构建独立的管理后台布局和 6 个管理页面。

**Architecture:** 渐进式重构——新建独立的 AdminLayout，拆分管理端路由到独立模块，引入 Tailwind CSS 做布局，Ant Design Vue 做交互组件。管理端路由前缀从 `/systemManage/admin/*` 迁移到 `/admin/*`。

**Tech Stack:** Vue 3 + TypeScript, Tailwind CSS 4, Ant Design Vue 4, ECharts 5, Pinia, Vue Router 4

---

### Task 1: 安装和配置 Tailwind CSS

**Files:**
- Create: `frontend/tailwind.config.js`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/package.json`

**Step 1: 安装依赖**

Run:
```bash
cd frontend && npm install -D tailwindcss @tailwindcss/vite
```

**Step 2: 配置 Vite 插件**

`frontend/vite.config.ts` — 添加 tailwindcss 插件:

```ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

**Step 3: 在 main.ts 中引入 Tailwind**

在 `frontend/src/main.ts` 中的 `import "ant-design-vue/dist/reset.css"` 之后添加:

```ts
import './assets/main.css'
```

**Step 4: 在 main.css 顶部添加 Tailwind 指令**

在 `frontend/src/assets/main.css` 文件顶部添加:

```css
@import "tailwindcss";
```

**Step 5: 验证 Tailwind 生效**

Run:
```bash
cd frontend && npm run dev
```

打开浏览器访问任意页面，用 DevTools 检查元素，确认 Tailwind 工具类（如 `flex`, `p-4`）可用。

**Step 6: Commit**

```bash
git add frontend/vite.config.ts frontend/src/main.ts frontend/src/assets/main.css frontend/package.json frontend/package-lock.json
git commit -m "chore: 引入 Tailwind CSS 4"
```

---

### Task 2: 创建 AdminLayout 布局组件

**Files:**
- Create: `frontend/src/layouts/AdminLayout.vue`
- Create: `frontend/src/components/admin/AdminSidebar.vue`
- Create: `frontend/src/components/admin/AdminHeader.vue`

**Step 1: 创建 AdminSidebar 组件**

Create `frontend/src/components/admin/AdminSidebar.vue`:

```vue
<template>
  <a-layout-sider
    :collapsed="collapsed"
    :trigger="null"
    collapsible
    width="220"
    collapsed-width="64"
    class="!bg-white !border-r border-gray-200"
  >
    <div class="h-16 flex items-center justify-center border-b border-gray-200">
      <h1 v-if="!collapsed" class="text-lg font-semibold text-gray-800">管理后台</h1>
      <span v-else class="text-lg font-semibold text-gray-800">管</span>
    </div>
    <a-menu
      v-model:selectedKeys="selectedKeys"
      v-model:openKeys="openKeys"
      mode="inline"
      class="!border-r-0"
    >
      <a-menu-item key="/admin/dashboard" @click="navigate('/admin/dashboard')">
        <DashboardOutlined />
        <span>仪表盘</span>
      </a-menu-item>
      <a-menu-item key="/admin/users" @click="navigate('/admin/users')">
        <UserOutlined />
        <span>用户管理</span>
      </a-menu-item>
      <a-menu-item key="/admin/news" @click="navigate('/admin/news')">
        <ReadOutlined />
        <span>新闻管理</span>
      </a-menu-item>
      <a-menu-item key="/admin/diagnosis" @click="navigate('/admin/diagnosis')">
        <MedicineBoxOutlined />
        <span>诊断管理</span>
      </a-menu-item>
      <a-menu-item key="/admin/knowledge" @click="navigate('/admin/knowledge')">
        <FolderOutlined />
        <span>知识库</span>
      </a-menu-item>
      <a-menu-item key="/admin/data-analysis" @click="navigate('/admin/data-analysis')">
        <BarChartOutlined />
        <span>数据分析</span>
      </a-menu-item>
      <a-menu-divider />
      <a-menu-item @click="goHome">
        <RollbackOutlined />
        <span>返回前台</span>
      </a-menu-item>
    </a-menu>
  </a-layout-sider>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  DashboardOutlined,
  UserOutlined,
  ReadOutlined,
  MedicineBoxOutlined,
  FolderOutlined,
  BarChartOutlined,
  RollbackOutlined,
} from '@ant-design/icons-vue'

defineProps<{
  collapsed: boolean
}>()

const router = useRouter()
const route = useRoute()
const selectedKeys = ref<string[]>([route.path])
const openKeys = ref<string[]>([])

const navigate = (path: string) => {
  router.push(path)
}

const goHome = () => {
  router.push('/')
}

watch(
  () => route.path,
  (path) => {
    selectedKeys.value = [path]
  },
)
</script>
```

**Step 2: 创建 AdminHeader 组件**

Create `frontend/src/components/admin/AdminHeader.vue`:

```vue
<template>
  <a-layout-header class="!bg-white !px-6 flex items-center justify-between border-b border-gray-200 h-14 leading-14">
    <div class="flex items-center gap-4">
      <MenuFoldOutlined
        v-if="!collapsed"
        class="text-xl cursor-pointer"
        @click="$emit('toggle')"
      />
      <MenuUnfoldOutlined
        v-else
        class="text-xl cursor-pointer"
        @click="$emit('toggle')"
      />
      <a-breadcrumb class="ml-2">
        <a-breadcrumb-item>
          <router-link to="/admin/dashboard">管理后台</router-link>
        </a-breadcrumb-item>
        <a-breadcrumb-item v-if="route.meta?.title">
          {{ route.meta.title }}
        </a-breadcrumb-item>
      </a-breadcrumb>
    </div>
    <div class="flex items-center gap-3">
      <a-avatar :src="loginUserStore.loginUser.userAvatar" class="cursor-pointer">
        {{ loginUserStore.loginUser.userName?.[0] ?? 'U' }}
      </a-avatar>
      <span class="text-sm text-gray-600">{{ loginUserStore.loginUser.userName }}</span>
      <a-dropdown>
        <MoreOutlined class="text-lg cursor-pointer ml-2" />
        <template #overlay>
          <a-menu>
            <a-menu-item @click="router.push('/user/userCenter')">
              <UserOutlined />
              个人中心
            </a-menu-item>
            <a-menu-item @click="doLogout">
              <LogoutOutlined />
              退出登录
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>
  </a-layout-header>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons-vue'
import { useLoginUserStore } from '@/stores/user'
import { userLogout } from '@/api/userController'
import { message } from 'ant-design-vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
}>()

const router = useRouter()
const route = useRoute()
const loginUserStore = useLoginUserStore()

const doLogout = async () => {
  const res = await userLogout()
  if (res.data.code === 0) {
    loginUserStore.setLoginUser({ userName: '未登录' })
    message.success('退出登录成功')
    await router.push('/user/login')
  } else {
    message.error('退出登录失败' + res.data.msg)
  }
}
</script>
```

**Step 3: 创建 AdminLayout 组件**

Create `frontend/src/layouts/AdminLayout.vue`:

```vue
<template>
  <a-layout class="min-h-screen">
    <AdminSidebar :collapsed="collapsed" />
    <a-layout>
      <AdminHeader :collapsed="collapsed" @toggle="collapsed = !collapsed" />
      <a-layout-content class="m-6 p-6 bg-white rounded-lg">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AdminSidebar from '@/components/admin/AdminSidebar.vue'
import AdminHeader from '@/components/admin/AdminHeader.vue'

const collapsed = ref(false)
</script>
```

**Step 4: Commit**

```bash
git add frontend/src/layouts/AdminLayout.vue frontend/src/components/admin/AdminSidebar.vue frontend/src/components/admin/AdminHeader.vue
git commit -m "feat: 创建 AdminLayout 布局组件（侧边栏 + 顶栏）"
```

---

### Task 3: 拆分路由 — 管理端路由独立模块

**Files:**
- Create: `frontend/src/router/modules/adminRoutes.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/App.vue`

**Step 1: 创建管理端路由模块**

Create `frontend/src/router/modules/adminRoutes.ts`:

```ts
import type { RouteRecordRaw } from 'vue-router'
import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'

const adminRoutes: RouteRecordRaw[] = [
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: {
      access: ACCESS_ENUM.ADMIN,
      hideInMenu: true,
    },
    redirect: '/admin/dashboard',
    children: [
      {
        path: 'dashboard',
        name: '仪表盘',
        component: () => import('@/pages/admin/DashboardPage.vue'),
        meta: { access: ACCESS_ENUM.ADMIN, title: '仪表盘', hideInMenu: true },
      },
      {
        path: 'users',
        name: '用户管理',
        component: () => import('@/pages/admin/UserManagePage.vue'),
        meta: { access: ACCESS_ENUM.ADMIN, title: '用户管理', hideInMenu: true },
      },
      {
        path: 'news',
        name: '新闻管理',
        component: () => import('@/pages/admin/NewsManagePage.vue'),
        meta: { access: ACCESS_ENUM.ADMIN, title: '新闻管理', hideInMenu: true },
      },
      {
        path: 'diagnosis',
        name: '诊断管理',
        component: () => import('@/pages/admin/DiagnosisManagePage.vue'),
        meta: { access: ACCESS_ENUM.ADMIN, title: '诊断管理', hideInMenu: true },
      },
      {
        path: 'knowledge',
        name: '知识库管理',
        component: () => import('@/pages/admin/KnowledgePage.vue'),
        meta: { access: ACCESS_ENUM.ADMIN, title: '知识库管理', hideInMenu: true },
      },
      {
        path: 'data-analysis',
        name: '数据分析',
        component: () => import('@/pages/admin/DataAnalysisPage.vue'),
        meta: { access: ACCESS_ENUM.ADMIN, title: '数据分析', hideInMenu: true },
      },
    ],
  },
  {
    path: '/news/edit/:id',
    name: '编辑新闻',
    component: () => import('@/pages/news/NewsEditPage.vue'),
    props: true,
    meta: { access: ACCESS_ENUM.ADMIN, hideInMenu: true },
  },
]

export default adminRoutes
```

**Step 2: 重构主路由文件**

Replace `frontend/src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router'
import {
  HomeOutlined,
  SettingOutlined,
  MedicineBoxOutlined,
  RobotOutlined,
  ReadOutlined,
} from '@ant-design/icons-vue'
import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'
import adminRoutes from './modules/adminRoutes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: '主页',
      component: () => import('@/pages/HomePage.vue'),
      meta: { icon: HomeOutlined },
    },
    {
      path: '/user/login',
      name: '用户登录',
      component: () => import('@/pages/user/UserLoginPage.vue'),
      meta: { hideInMenu: true },
    },
    {
      path: '/user/register',
      name: '用户注册',
      component: () => import('@/pages/user/UserRegisterPage.vue'),
      meta: { hideInMenu: true },
    },
    {
      path: '/noAuth',
      name: '无权限页面',
      component: () => import('@/pages/NoAuth.vue'),
      meta: { access: ACCESS_ENUM.NOT_LOGIN, hideInMenu: true },
    },
    {
      path: '/diagnosis',
      name: '疾病诊断',
      component: () => import('@/pages/diagnosis/DiagnosisPage.vue'),
      meta: { icon: MedicineBoxOutlined },
    },
    {
      path: '/news',
      name: '前沿新闻',
      component: () => import('@/pages/news/NewsPage.vue'),
      meta: { icon: ReadOutlined },
    },
    {
      path: '/news/:id',
      name: '新闻详情',
      component: () => import('@/pages/news/NewsDetailPage.vue'),
      props: true,
      meta: { hideInMenu: true },
    },
    {
      path: '/agent',
      name: 'Agent助手',
      component: () => import('@/pages/agent/AgentChatPage.vue'),
      meta: { icon: RobotOutlined },
    },
    {
      path: '/user/userCenter',
      name: '个人中心',
      component: () => import('@/pages/userCenter/UserCenter.vue'),
      meta: { hideInMenu: true },
      children: [
        {
          path: 'profile',
          name: 'profile',
          component: () => import('@/pages/userCenter/Profile.vue'),
          meta: { hideInMenu: true },
        },
        {
          path: 'accountSettings',
          name: 'accountSettings',
          component: () => import('@/pages/userCenter/AccountSetting.vue'),
          meta: { hideInMenu: true },
        },
        {
          path: 'diagnosisHistory',
          name: 'diagnosisHistory',
          component: () => import('@/pages/userCenter/DiagnosisHistory.vue'),
          meta: { hideInMenu: true },
        },
      ],
    },
    // 管理端路由（独立模块）
    ...adminRoutes,
  ],
})

export default router
```

**Step 3: 重构 App.vue — 支持多 Layout**

Replace `frontend/src/App.vue`:

```vue
<template>
  <router-view />
</template>

<script setup lang="ts">
</script>

<style>
#app {
  margin: 0;
  padding: 0;
}
</style>
```

**Step 4: 让公共页面也包裹 BasicLayout**

创建 `frontend/src/router/modules/publicRoutes.ts` — 不需要单独文件，只需确保公共路由页面使用 BasicLayout。在 `frontend/src/router/index.ts` 中，将原来的公共页面包裹在一个使用 BasicLayout 的父路由下:

实际上更简单的做法是：管理端路由已经有自己的 AdminLayout，公共页面仍由 BasicLayout 渲染。只需把 BasicLayout 改成通过路由渲染而非硬编码在 App.vue 中。

修改 `frontend/src/router/index.ts`，给公共路由加一个父路由:

```ts
import { createRouter, createWebHistory } from 'vue-router'
import {
  HomeOutlined,
  MedicineBoxOutlined,
  RobotOutlined,
  ReadOutlined,
} from '@ant-design/icons-vue'
import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'
import adminRoutes from './modules/adminRoutes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/BasicLayout.vue'),
      children: [
        {
          path: '',
          name: '主页',
          component: () => import('@/pages/HomePage.vue'),
          meta: { icon: HomeOutlined },
        },
        {
          path: 'diagnosis',
          name: '疾病诊断',
          component: () => import('@/pages/diagnosis/DiagnosisPage.vue'),
          meta: { icon: MedicineBoxOutlined },
        },
        {
          path: 'news',
          name: '前沿新闻',
          component: () => import('@/pages/news/NewsPage.vue'),
          meta: { icon: ReadOutlined },
        },
        {
          path: 'news/:id',
          name: '新闻详情',
          component: () => import('@/pages/news/NewsDetailPage.vue'),
          props: true,
          meta: { hideInMenu: true },
        },
        {
          path: 'agent',
          name: 'Agent助手',
          component: () => import('@/pages/agent/AgentChatPage.vue'),
          meta: { icon: RobotOutlined },
        },
        {
          path: 'user/login',
          name: '用户登录',
          component: () => import('@/pages/user/UserLoginPage.vue'),
          meta: { hideInMenu: true },
        },
        {
          path: 'user/register',
          name: '用户注册',
          component: () => import('@/pages/user/UserRegisterPage.vue'),
          meta: { hideInMenu: true },
        },
        {
          path: 'noAuth',
          name: '无权限页面',
          component: () => import('@/pages/NoAuth.vue'),
          meta: { access: ACCESS_ENUM.NOT_LOGIN, hideInMenu: true },
        },
        {
          path: 'user/userCenter',
          name: '个人中心',
          component: () => import('@/pages/userCenter/UserCenter.vue'),
          meta: { hideInMenu: true },
          children: [
            {
              path: 'profile',
              name: 'profile',
              component: () => import('@/pages/userCenter/Profile.vue'),
              meta: { hideInMenu: true },
            },
            {
              path: 'accountSettings',
              name: 'accountSettings',
              component: () => import('@/pages/userCenter/AccountSetting.vue'),
              meta: { hideInMenu: true },
            },
            {
              path: 'diagnosisHistory',
              name: 'diagnosisHistory',
              component: () => import('@/pages/userCenter/DiagnosisHistory.vue'),
              meta: { hideInMenu: true },
            },
          ],
        },
      ],
    },
    ...adminRoutes,
  ],
})

export default router
```

**Step 5: 验证路由工作**

Run:
```bash
cd frontend && npm run dev
```

测试:
- 访问 `/` → 看到公共首页 (BasicLayout)
- 访问 `/admin` → 应重定向到 `/admin/dashboard`（此时 DashboardPage 还没创建，先创建一个空的占位）

**Step 6: Commit**

```bash
git add frontend/src/router/ frontend/src/App.vue
git commit -m "refactor: 拆分路由为公共模块和管理端模块，支持多 Layout"
```

---

### Task 4: 更新全局导航守卫和 GlobalHeader

**Files:**
- Modify: `frontend/src/utils/access/access.ts`
- Modify: `frontend/src/components/GlobalHeader.vue`

**Step 1: 更新导航守卫**

管理端路由前缀已从 `/systemManage/admin` 变为 `/admin`，但 `access.ts` 中的 `toUrl.startsWith('/admin')` 已经正确。无需修改。

但需要更新 `GlobalHeader.vue` 中的菜单：将 "系统管理" 的路由从 `/systemManage` 改为 `/admin`。

**Step 2: 更新 GlobalHeader 菜单项**

`GlobalHeader.vue` 中的菜单是从 `router.getRoutes()` 自动生成的。由于管理端路由的父路由设置了 `hideInMenu: true`，它不会出现在顶部菜单中。

需要在公共路由中添加一个入口。修改 `frontend/src/router/index.ts`，在公共路由的 children 中添加:

```ts
{
  path: 'systemManage',
  name: '系统管理',
  component: () => import('@/pages/HomePage.vue'), // 占位，会被重定向
  meta: { icon: SettingOutlined, access: ACCESS_ENUM.ADMIN },
  beforeEnter: (to, from, next) => {
    next('/admin/dashboard')
  },
},
```

这样管理员在顶部菜单中会看到 "系统管理"，点击后跳转到管理后台。

**Step 3: Commit**

```bash
git add frontend/src/utils/access/access.ts frontend/src/components/GlobalHeader.vue frontend/src/router/index.ts
git commit -m "refactor: 更新导航守卫和菜单，管理端入口改为 /admin"
```

---

### Task 5: 重构用户管理页面

**Files:**
- Modify: `frontend/src/pages/admin/UserManagePage.vue`

**Step 1: 重写 UserManagePage**

Replace `frontend/src/pages/admin/UserManagePage.vue`:

```vue
<template>
  <div>
    <!-- 搜索栏 -->
    <div class="mb-4 flex items-center gap-3">
      <a-input
        v-model:value="searchParams.userAccount"
        placeholder="搜索账号"
        class="!w-48"
        allow-clear
        @press-enter="doSearch"
      />
      <a-input
        v-model:value="searchParams.userName"
        placeholder="搜索用户名"
        class="!w-48"
        allow-clear
        @press-enter="doSearch"
      />
      <a-button type="primary" @click="doSearch">搜索</a-button>
      <a-button @click="doReset">重置</a-button>
    </div>

    <!-- 数据表格 -->
    <a-table
      :columns="columns"
      :data-source="dataList"
      :pagination="pagination"
      :loading="loading"
      @change="doTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'userAvatar'">
          <a-avatar :src="record.userAvatar">
            {{ record.userName?.[0] ?? 'U' }}
          </a-avatar>
        </template>
        <template v-else-if="column.dataIndex === 'userRole'">
          <a-tag :color="record.userRole === 'admin' ? 'green' : 'blue'">
            {{ record.userRole === 'admin' ? '管理员' : '普通用户' }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'createTime'">
          {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-popconfirm
            title="确定删除该用户？"
            ok-text="确定"
            cancel-text="取消"
            @confirm="doDelete(record.id)"
          >
            <a-button type="link" danger size="small">删除</a-button>
          </a-popconfirm>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { deleteUser, listUserVoByPageWithCache } from '@/api/userController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { useLoginUserStore } from '@/stores/user'

const userLogin = useLoginUserStore()
const loading = ref(false)

const columns = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: '账号', dataIndex: 'userAccount' },
  { title: '用户名', dataIndex: 'userName' },
  { title: '头像', dataIndex: 'userAvatar', width: 80 },
  { title: '简介', dataIndex: 'userProfile', ellipsis: true },
  { title: '角色', dataIndex: 'userRole', width: 100 },
  { title: '创建时间', dataIndex: 'createTime', width: 180 },
  { title: '操作', key: 'action', width: 100 },
]

const dataList = ref<API.UserVO[]>([])
const total = ref(0)

const searchParams = reactive<API.UserQueryDTO>({
  current: 1,
  pageSize: 10,
})

const fetchData = async () => {
  loading.value = true
  try {
    const res = await listUserVoByPageWithCache({ ...searchParams })
    if (res.data.data) {
      dataList.value = res.data.data.records ?? []
      total.value = res.data.data.total ?? 0
    } else {
      message.error('获取数据失败' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}

const pagination = computed(() => ({
  current: searchParams.current ?? 1,
  pageSize: searchParams.pageSize ?? 10,
  total: Number(total.value) ?? 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条数据`,
}))

const doTableChange = (page: any) => {
  searchParams.current = page.current
  searchParams.pageSize = page.pageSize
  fetchData()
}

const doSearch = () => {
  searchParams.current = 1
  fetchData()
}

const doReset = () => {
  searchParams.userAccount = undefined
  searchParams.userName = undefined
  searchParams.current = 1
  fetchData()
}

const doDelete = async (id: string) => {
  if (userLogin.loginUser.userRole === 'admin') {
    message.error('无法操作管理员')
    return
  }
  if (!id) return
  const res = await deleteUser({ id })
  if (res.data.code === 0) {
    message.success('删除成功')
    fetchData()
  } else {
    message.error('删除失败')
  }
}

onMounted(() => {
  fetchData()
})
</script>
```

**Step 2: 验证**

Run: `cd frontend && npm run dev`

以管理员登录，访问 `/admin/users`，确认表格和搜索功能正常。

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/UserManagePage.vue
git commit -m "refactor: 重构用户管理页面，使用 Tailwind 布局"
```

---

### Task 6: 重构新闻管理页面

**Files:**
- Modify: `frontend/src/pages/admin/NewsManagePage.vue`

**Step 1: 重写 NewsManagePage**

Replace `frontend/src/pages/admin/NewsManagePage.vue`:

```vue
<template>
  <div>
    <div class="mb-4 flex items-center gap-3">
      <a-input
        v-model:value="searchParams.title"
        placeholder="搜索新闻标题"
        class="!w-48"
        allow-clear
        @press-enter="doSearch"
      />
      <a-button type="primary" @click="doSearch">搜索</a-button>
      <a-button @click="doReset">重置</a-button>
      <div class="flex-1" />
      <a-button type="primary" @click="editNews(null as any)">新增新闻</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="dataList"
      :pagination="pagination"
      :loading="loading"
      @change="doTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'publishTime'">
          {{ dayjs(record.publishTime).format('YYYY-MM-DD HH:mm:ss') }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button type="link" size="small" @click="editNews(record.id)">编辑</a-button>
            <a-popconfirm
              title="确定删除该新闻？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="doDelete(record.id)"
            >
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { deleteNews, listNewsVoByPageWithCache } from '@/api/newsController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'

const router = useRouter()
const loading = ref(false)

const columns = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: '新闻标题', dataIndex: 'title' },
  { title: '新闻摘要', dataIndex: 'summary', ellipsis: true },
  { title: '作者', dataIndex: 'author', width: 120 },
  { title: '发布时间', dataIndex: 'publishTime', width: 180 },
  { title: '操作', key: 'action', width: 150 },
]

const dataList = ref<API.NewsVO[]>([])
const total = ref(0)

const searchParams = reactive<API.NewsQueryDTO>({
  current: 1,
  pageSize: 10,
})

const fetchData = async () => {
  loading.value = true
  try {
    const res = await listNewsVoByPageWithCache({ ...searchParams })
    if (res.data.data) {
      dataList.value = res.data.data.records ?? []
      total.value = res.data.data.total ?? 0
    } else {
      message.error('获取数据失败' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}

const pagination = computed(() => ({
  current: searchParams.current ?? 1,
  pageSize: searchParams.pageSize ?? 10,
  total: Number(total.value) ?? 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条数据`,
}))

const doTableChange = (page: any) => {
  searchParams.current = page.current
  searchParams.pageSize = page.pageSize
  fetchData()
}

const doSearch = () => {
  searchParams.current = 1
  fetchData()
}

const doReset = () => {
  searchParams.title = undefined
  searchParams.current = 1
  fetchData()
}

const doDelete = async (id: string) => {
  if (!id) return
  const res = await deleteNews({ id })
  if (res.data.code === 0) {
    message.success('删除成功')
    fetchData()
  } else {
    message.error('删除失败')
  }
}

const editNews = (id: string) => {
  router.push(`/news/edit/${id}`)
}

onMounted(() => {
  fetchData()
})
</script>
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/NewsManagePage.vue
git commit -m "refactor: 重构新闻管理页面"
```

---

### Task 7: 重构诊断管理页面

**Files:**
- Modify: `frontend/src/pages/admin/DiagnosisManagePage.vue`

**Step 1: 重写 DiagnosisManagePage**

Replace `frontend/src/pages/admin/DiagnosisManagePage.vue` — 使用侧滑抽屉替代 Modal 展示诊断详情:

```vue
<template>
  <div>
    <div class="mb-4 flex items-center gap-3">
      <a-input
        v-model:value="searchParams.result"
        placeholder="搜索疾病名称"
        class="!w-48"
        allow-clear
        @press-enter="doSearch"
      />
      <a-range-picker v-model:value="dateRange" @change="onDateChange" />
      <a-button type="primary" @click="doSearch">搜索</a-button>
      <a-button @click="doReset">重置</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="dataList"
      :pagination="pagination"
      :loading="loading"
      @change="doTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'diagnosisImage'">
          <a-image :src="record.url" :width="60" class="rounded" />
        </template>
        <template v-else-if="column.dataIndex === 'result'">
          <a-tag color="blue">{{ record.result }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'confidence'">
          <a-progress :percent="record.confidence" :size="'small'" :stroke-width="6" />
        </template>
        <template v-else-if="column.dataIndex === 'createTime'">
          {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button type="link" size="small" @click="viewReport(record)">查看详情</a-button>
            <a-popconfirm
              title="确定删除？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="doDelete(record.id)"
            >
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 诊断详情侧滑抽屉 -->
    <a-drawer
      v-model:open="drawerVisible"
      title="诊断详情"
      width="600"
      :destroy-on-close="true"
    >
      <template v-if="currentRecord">
        <div class="mb-4">
          <a-image :src="currentRecord.url" class="rounded-lg max-w-full" />
        </div>
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="诊断用户">{{ currentRecord.username }}</a-descriptions-item>
          <a-descriptions-item label="诊断结果">{{ currentRecord.result }}</a-descriptions-item>
          <a-descriptions-item label="置信度">{{ currentRecord.confidence }}%</a-descriptions-item>
          <a-descriptions-item label="严重程度">{{ currentRecord.severity }}</a-descriptions-item>
          <a-descriptions-item label="诊断时间">
            {{ dayjs(currentRecord.createTime).format('YYYY-MM-DD HH:mm:ss') }}
          </a-descriptions-item>
        </a-descriptions>
      </template>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { deleteDiagnosis, listDiagnosisVoByPageWithCache } from '@/api/diagnosisController'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const loading = ref(false)
const drawerVisible = ref(false)
const currentRecord = ref<API.DiagnosisManageVO | null>(null)
const dateRange = ref<[Dayjs, Dayjs] | null>(null)

const columns = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: '诊断用户', dataIndex: 'username', width: 120 },
  { title: '诊断图像', dataIndex: 'diagnosisImage', width: 100 },
  { title: '诊断结果', dataIndex: 'result', width: 120 },
  { title: '置信度', dataIndex: 'confidence', width: 120 },
  { title: '诊断时间', dataIndex: 'createTime', width: 180 },
  { title: '操作', key: 'action', width: 160 },
]

const dataList = ref<API.DiagnosisManageVO[]>([])
const total = ref(0)

const searchParams = reactive<API.DiagnosisQueryDTO>({
  current: 1,
  pageSize: 10,
})

const fetchData = async () => {
  loading.value = true
  try {
    const res = await listDiagnosisVoByPageWithCache({ ...searchParams })
    if (res.data.data) {
      dataList.value = res.data.data.records ?? []
      total.value = res.data.data.total ?? 0
    } else {
      message.error('获取数据失败' + res.data.msg)
    }
  } finally {
    loading.value = false
  }
}

const pagination = computed(() => ({
  current: searchParams.current ?? 1,
  pageSize: searchParams.pageSize ?? 10,
  total: Number(total.value) ?? 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条数据`,
}))

const doTableChange = (page: any) => {
  searchParams.current = page.current
  searchParams.pageSize = page.pageSize
  fetchData()
}

const doSearch = () => {
  searchParams.current = 1
  fetchData()
}

const doReset = () => {
  searchParams.result = undefined
  searchParams.diagnosisTime = undefined
  dateRange.value = null
  searchParams.current = 1
  fetchData()
}

const onDateChange = (dates: [Dayjs, Dayjs] | null) => {
  if (dates) {
    searchParams.diagnosisTime = dates[0].format('YYYY-MM-DD')
  } else {
    searchParams.diagnosisTime = undefined
  }
}

const doDelete = async (id: string) => {
  if (!id) return
  const res = await deleteDiagnosis({ id })
  if (res.data.code === 0) {
    message.success('删除成功')
    fetchData()
  } else {
    message.error('删除失败')
  }
}

const viewReport = (record: API.DiagnosisManageVO) => {
  currentRecord.value = record
  drawerVisible.value = true
}

onMounted(() => {
  fetchData()
})
</script>
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/DiagnosisManagePage.vue
git commit -m "refactor: 重构诊断管理页面，使用侧滑抽屉展示详情"
```

---

### Task 8: 创建仪表盘首页

**Files:**
- Create: `frontend/src/pages/admin/DashboardPage.vue`

**Step 1: 创建 DashboardPage**

这个页面展示系统关键指标。由于后端暂无统一的统计 API，先用 mock 数据，后续对接真实 API。

Create `frontend/src/pages/admin/DashboardPage.vue`:

```vue
<template>
  <div>
    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <a-card v-for="stat in stats" :key="stat.label" class="text-center">
        <div class="text-3xl font-bold text-blue-600 mb-1">{{ stat.value }}</div>
        <div class="text-sm text-gray-500">{{ stat.label }}</div>
      </a-card>
    </div>

    <!-- 图表区域 -->
    <div class="grid grid-cols-2 gap-4 mb-6">
      <a-card title="诊断趋势 (近7天)">
        <div ref="trendChartRef" class="h-72" />
      </a-card>
      <a-card title="疾病类型分布">
        <div ref="pieChartRef" class="h-72" />
      </a-card>
    </div>

    <!-- 最近诊断记录 -->
    <a-card title="最近诊断记录">
      <a-table
        :columns="recentColumns"
        :data-source="recentDiagnoses"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'createTime'">
            {{ dayjs(record.createTime).format('YYYY-MM-DD HH:mm:ss') }}
          </template>
          <template v-else-if="column.dataIndex === 'result'">
            <a-tag color="blue">{{ record.result }}</a-tag>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as echarts from 'echarts'
import dayjs from 'dayjs'

// Mock data — 后续对接真实 API
const stats = ref([
  { label: '用户总数', value: 128 },
  { label: '诊断总次数', value: 8452 },
  { label: '今日新增诊断', value: 37 },
  { label: '知识库文件数', value: 56 },
])

const recentColumns = [
  { title: '用户', dataIndex: 'username', width: 120 },
  { title: '诊断结果', dataIndex: 'result', width: 120 },
  { title: '置信度', dataIndex: 'confidence', width: 100 },
  { title: '时间', dataIndex: 'createTime' },
]

const recentDiagnoses = ref([
  { username: '张三', result: '近视', confidence: 95, createTime: '2026-04-23T10:30:00' },
  { username: '李四', result: '远视', confidence: 88, createTime: '2026-04-23T09:15:00' },
  { username: '王五', result: '散光', confidence: 92, createTime: '2026-04-23T08:45:00' },
  { username: '赵六', result: '白内障', confidence: 78, createTime: '2026-04-22T17:20:00' },
  { username: '钱七', result: '青光眼', confidence: 85, createTime: '2026-04-22T15:10:00' },
])

// 趋势图
const trendChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null

// 饼图
const pieChartRef = ref<HTMLElement>()
let pieChart: echarts.ECharts | null = null

const initCharts = () => {
  if (trendChartRef.value) {
    trendChart = echarts.init(trendChartRef.value)
    trendChart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: ['4/17', '4/18', '4/19', '4/20', '4/21', '4/22', '4/23'],
      },
      yAxis: { type: 'value', name: '诊断数' },
      series: [
        {
          name: '诊断次数',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.3 },
          data: [42, 38, 55, 47, 62, 51, 37],
        },
      ],
    })
  }

  if (pieChartRef.value) {
    pieChart = echarts.init(pieChartRef.value)
    pieChart.setOption({
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' } },
          data: [
            { value: 1048, name: '近视' },
            { value: 735, name: '远视' },
            { value: 580, name: '散光' },
            { value: 484, name: '白内障' },
            { value: 300, name: '青光眼' },
          ],
        },
      ],
    })
  }
}

const handleResize = () => {
  trendChart?.resize()
  pieChart?.resize()
}

onMounted(() => {
  initCharts()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  pieChart?.dispose()
})
</script>
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/DashboardPage.vue
git commit -m "feat: 新增仪表盘首页（mock 数据）"
```

---

### Task 9: 创建知识库管理页面

**Files:**
- Create: `frontend/src/pages/admin/KnowledgePage.vue`

**Step 1: 创建 KnowledgePage**

由于后端 API 部分就绪，先用 mock 数据 + 上传区域占位。

Create `frontend/src/pages/admin/KnowledgePage.vue`:

```vue
<template>
  <div>
    <!-- 上传区域 -->
    <a-card class="mb-4">
      <a-upload-dragger
        v-model:file-list="fileList"
        :action="uploadUrl"
        :headers="uploadHeaders"
        name="file"
        :multiple="true"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        @change="onUploadChange"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p class="ant-upload-hint">支持 PDF、Word、图片文件</p>
      </a-upload-dragger>
    </a-card>

    <!-- 文件列表 -->
    <a-table
      :columns="columns"
      :data-source="knowledgeList"
      :loading="loading"
      row-key="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'fileType'">
          <a-tag>{{ record.fileType }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'fileSize'">
          {{ formatFileSize(record.fileSize) }}
        </template>
        <template v-else-if="column.dataIndex === 'status'">
          <a-badge
            :status="record.status === 'ready' ? 'success' : record.status === 'processing' ? 'processing' : 'error'"
            :text="record.status === 'ready' ? '已就绪' : record.status === 'processing' ? '处理中' : '失败'"
          />
        </template>
        <template v-else-if="column.dataIndex === 'uploadTime'">
          {{ dayjs(record.uploadTime).format('YYYY-MM-DD HH:mm:ss') }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button type="link" size="small">预览</a-button>
            <a-popconfirm
              title="确定删除？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="doDelete(record.id)"
            >
              <a-button type="link" danger size="small">删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { InboxOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import type { UploadFile } from 'ant-design-vue'
import dayjs from 'dayjs'

const loading = ref(false)
const fileList = ref<UploadFile[]>([])

// TODO: 替换为真实后端 API 地址
const uploadUrl = '/api/knowledge/upload'
const uploadHeaders = {}

const columns = [
  { title: '文件名', dataIndex: 'fileName' },
  { title: '类型', dataIndex: 'fileType', width: 100 },
  { title: '大小', dataIndex: 'fileSize', width: 100 },
  { title: '状态', dataIndex: 'status', width: 120 },
  { title: '上传时间', dataIndex: 'uploadTime', width: 180 },
  { title: '操作', key: 'action', width: 150 },
]

// Mock data — 后续对接真实 API
const knowledgeList = ref([
  {
    id: '1',
    fileName: '眼科诊断指南.pdf',
    fileType: 'PDF',
    fileSize: 2048576,
    status: 'ready',
    uploadTime: '2026-04-23T10:00:00',
  },
  {
    id: '2',
    fileName: '白内障研究报告.docx',
    fileType: 'DOCX',
    fileSize: 1536000,
    status: 'processing',
    uploadTime: '2026-04-23T09:30:00',
  },
  {
    id: '3',
    fileName: '视网膜病变案例.png',
    fileType: 'PNG',
    fileSize: 512000,
    status: 'ready',
    uploadTime: '2026-04-22T15:00:00',
  },
])

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const onUploadChange = (info: any) => {
  if (info.file.status === 'done') {
    message.success(`${info.file.name} 上传成功`)
  } else if (info.file.status === 'error') {
    message.error(`${info.file.name} 上传失败`)
  }
}

const doDelete = (id: string) => {
  knowledgeList.value = knowledgeList.value.filter((item) => item.id !== id)
  message.success('删除成功')
  // TODO: 调用真实删除 API
}

onMounted(() => {
  // TODO: 调用真实列表 API
})
</script>
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/KnowledgePage.vue
git commit -m "feat: 新增知识库管理页面（mock 数据 + 拖拽上传）"
```

---

### Task 10: 重构数据分析页面

**Files:**
- Modify: `frontend/src/pages/admin/DataAnalysisPage.vue`
- Modify: `frontend/src/components/tables/StatsCard.vue` — 迁移到 admin 组件目录

**Step 1: 将 StatsCard 迁移到 admin 目录**

复制 `frontend/src/components/tables/StatsCard.vue` 到 `frontend/src/components/admin/StatsCard.vue`，并改为 Composition API + Tailwind:

```vue
<template>
  <a-card class="text-center">
    <div class="text-3xl font-bold text-blue-600 mb-1">{{ value }}</div>
    <div class="text-sm text-gray-500">{{ label }}</div>
  </a-card>
</template>

<script setup lang="ts">
defineProps<{
  value: string | number
  label: string
}>()
</script>
```

**Step 2: 重写 DataAnalysisPage**

将 `DataAnalysisPage.vue` 从 Options API 改为 Composition API，从 mock 数据提取为可替换的响应式变量，添加时间范围筛选：

```vue
<template>
  <div>
    <!-- 时间范围筛选 -->
    <div class="mb-4 flex items-center gap-3">
      <span class="text-gray-600">时间范围：</span>
      <a-radio-group v-model:value="timeRange" button-style="solid" @change="onTimeRangeChange">
        <a-radio-button value="7">近7天</a-radio-button>
        <a-radio-button value="30">近30天</a-radio-button>
        <a-radio-button value="90">近90天</a-radio-button>
      </a-radio-group>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <StatsCard v-for="stat in stats" :key="stat.label" :value="stat.value" :label="stat.label" />
    </div>

    <!-- 图表 -->
    <div class="grid grid-cols-2 gap-4 mb-6">
      <LineChart title="诊断趋势" :chart-data="trendData" />
      <PieChart title="疾病类型分布" :chart-data="diseaseData" />
    </div>
    <div class="grid grid-cols-1 gap-4">
      <BarChart title="用户活跃度" :chart-data="activityData" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import StatsCard from '@/components/admin/StatsCard.vue'
import LineChart from '@/components/tables/LineChart.vue'
import PieChart from '@/components/tables/PieChart.vue'
import BarChart from '@/components/tables/BarChart.vue'

const timeRange = ref('30')

// TODO: 从后端 API 获取数据，当前使用 mock
const stats = ref([
  { label: '总诊断数', value: '8,452' },
  { label: '确诊数', value: '7,891' },
  { label: '准确率', value: '98.7%' },
  { label: '平均诊断速度', value: '2.3s' },
])

const trendData = ref({
  xAxis: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  series: {
    近视: [120, 132, 101, 134, 90, 230, 210, 182, 191, 234, 290, 330],
    远视: [220, 182, 191, 234, 290, 330, 310, 123, 442, 321, 90, 149],
    散光: [150, 232, 201, 154, 190, 330, 410, 320, 310, 123, 440, 320],
  },
})

const diseaseData = ref({
  legend: ['近视', '远视', '散光', '弱视', '白内障', '青光眼'],
  data: [
    { value: 1048, name: '近视' },
    { value: 735, name: '远视' },
    { value: 580, name: '散光' },
    { value: 484, name: '弱视' },
    { value: 300, name: '白内障' },
    { value: 251, name: '青光眼' },
  ],
})

const activityData = ref({
  xAxis: { type: 'value' as const, boundaryGap: [0, 0.01] },
  yAxis: {
    type: 'category' as const,
    data: ['0-20岁', '21-40岁', '41-60岁', '61-80岁', '80岁以上'],
  },
  legend: ['近视', '远视', '散光', '弱视', '其他眼病'],
  series: [
    { name: '近视', data: [300, 500, 200, 50, 10] },
    { name: '远视', data: [50, 200, 400, 300, 100] },
    { name: '散光', data: [200, 300, 150, 50, 20] },
    { name: '弱视', data: [150, 50, 20, 5, 2] },
    { name: '其他眼病', data: [50, 100, 250, 400, 300] },
  ],
})

const onTimeRangeChange = () => {
  // TODO: 根据 timeRange 请求后端数据
}
</script>
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/DataAnalysisPage.vue frontend/src/components/admin/StatsCard.vue
git commit -m "refactor: 重构数据分析页面，Composition API + 时间筛选"
```

---

### Task 11: 清理旧文件

**Files:**
- Delete: `frontend/src/pages/admin/SystemManagePage.vue`
- Verify: 所有页面正常工作

**Step 1: 删除旧的 SystemManagePage**

```bash
rm frontend/src/pages/admin/SystemManagePage.vue
```

**Step 2: 全面验证**

Run: `cd frontend && npm run dev`

测试所有路由:
1. `/` — 公共首页正常
2. `/diagnosis` — 诊断页正常
3. `/agent` — Agent 页正常
4. `/admin` — 重定向到 `/admin/dashboard`
5. `/admin/dashboard` — 仪表盘显示
6. `/admin/users` — 用户管理表格
7. `/admin/news` — 新闻管理表格
8. `/admin/diagnosis` — 诊断管理表格
9. `/admin/knowledge` — 知识库页面
10. `/admin/data-analysis` — 数据分析页面
11. 顶部菜单 "系统管理" 跳转到 `/admin/dashboard`

Run type check:
```bash
cd frontend && npm run type-check
```

**Step 3: Commit**

```bash
git add -A frontend/src/pages/admin/SystemManagePage.vue
git commit -m "chore: 删除旧的 SystemManagePage"
```

---

### Task 12: 最终验证和 lint

**Step 1: 运行 lint**

```bash
cd frontend && npm run lint
```

**Step 2: 运行类型检查**

```bash
cd frontend && npm run type-check
```

**Step 3: 修复所有 lint 和类型错误**

根据输出修复问题。

**Step 4: 构建验证**

```bash
cd frontend && npm run build
```

Expected: 构建成功无错误。

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: 管理端 UI 重构完成 — lint 和类型检查通过"
```

---

## 文件变更汇总

| 操作 | 文件 |
|------|------|
| **新增** | `frontend/src/layouts/AdminLayout.vue` |
| **新增** | `frontend/src/components/admin/AdminSidebar.vue` |
| **新增** | `frontend/src/components/admin/AdminHeader.vue` |
| **新增** | `frontend/src/components/admin/StatsCard.vue` |
| **新增** | `frontend/src/router/modules/adminRoutes.ts` |
| **新增** | `frontend/src/pages/admin/DashboardPage.vue` |
| **新增** | `frontend/src/pages/admin/KnowledgePage.vue` |
| **修改** | `frontend/vite.config.ts` (Tailwind 插件) |
| **修改** | `frontend/src/main.ts` (CSS 导入顺序) |
| **修改** | `frontend/src/assets/main.css` (Tailwind 指令) |
| **修改** | `frontend/src/App.vue` (移除硬编码 BasicLayout) |
| **修改** | `frontend/src/router/index.ts` (路由重构) |
| **修改** | `frontend/src/pages/admin/UserManagePage.vue` (重构) |
| **修改** | `frontend/src/pages/admin/NewsManagePage.vue` (重构) |
| **修改** | `frontend/src/pages/admin/DiagnosisManagePage.vue` (重构) |
| **修改** | `frontend/src/pages/admin/DataAnalysisPage.vue` (重构) |
| **删除** | `frontend/src/pages/admin/SystemManagePage.vue` |
