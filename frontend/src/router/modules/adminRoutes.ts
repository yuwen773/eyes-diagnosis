import type { RouteRecordRaw } from 'vue-router'
import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'

const adminRoutes: RouteRecordRaw[] = [
  {
    path: '/controlled-references',
    component: () => import('@/layouts/BasicLayout.vue'),
    children: [{
      path: '',
      name: '受控参考资料',
      component: () => import('@/pages/admin/ControlledReferencesPage.vue'),
      meta: { access: ACCESS_ENUM.EVIDENCE_MANAGER, icon: 'ReadOutlined' },
    }],
  },
  {
    path: '/admin',
    name: 'adminLayout',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/admin/dashboard',
    meta: {
      access: ACCESS_ENUM.ADMIN,
      hideInMenu: true,
    },
    children: [
      {
        path: 'dashboard',
        name: '仪表盘',
        component: () => import('@/pages/admin/DashboardPage.vue'),
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
      {
        path: 'users',
        name: '用户管理',
        component: () => import('@/pages/admin/UserManagePage.vue'),
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
      {
        path: 'news',
        name: '新闻管理',
        component: () => import('@/pages/admin/NewsManagePage.vue'),
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
      {
        path: 'diagnosis',
        name: '诊断管理',
        component: () => import('@/pages/admin/DiagnosisManagePage.vue'),
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
      {
        path: 'knowledge',
        name: '知识库',
        component: () => import('@/pages/admin/KnowledgePage.vue'),
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
      {
        path: 'data-analysis',
        name: '数据分析',
        component: () => import('@/pages/admin/DataAnalysisPage.vue'),
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
      {
        path: '/news/edit/:id',
        name: '编辑新闻',
        component: () => import('@/pages/news/NewsEditPage.vue'),
        props: true,
        meta: {
          access: ACCESS_ENUM.ADMIN,
          hideInMenu: true,
        },
      },
    ],
  },
]

export default adminRoutes
