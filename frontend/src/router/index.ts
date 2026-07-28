import { createRouter, createWebHistory } from 'vue-router'
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
          meta: {
            icon: 'HomeOutlined',
          },
        },
        {
          path: 'user/login',
          name: '用户登录',
          component: () => import('@/pages/user/UserLoginPage.vue'),
          meta: {
            hideInMenu: true,
          },
        },
        {
          path: 'user/register',
          name: '用户注册',
          component: () => import('@/pages/user/UserRegisterPage.vue'),
          meta: {
            hideInMenu: true,
          },
        },
        {
          path: 'noAuth',
          name: '无权限页面',
          component: () => import('@/pages/NoAuth.vue'),
          meta: {
            access: ACCESS_ENUM.NOT_LOGIN,
            hideInMenu: true,
          },
        },
        {
          path: 'diagnosis',
          name: '疾病诊断',
          component: () => import('@/pages/diagnosis/DiagnosisPage.vue'),
          meta: {
            icon: 'MedicineBoxOutlined',
          },
        },
        {
          path: 'diagnosis/create',
          name: '智能诊断工作流',
          component: () => import('@/pages/diagnosis/workflow/WorkflowCreatePage.vue'),
          meta: {
            icon: 'ExperimentOutlined',
            access: ACCESS_ENUM.USER,
          },
        },
        {
          path: 'diagnosis/:id',
          name: '诊断进度',
          component: () => import('@/pages/diagnosis/workflow/WorkflowDetailPage.vue'),
          props: true,
          meta: {
            access: ACCESS_ENUM.USER,
            hideInMenu: true,
          },
        },
        {
          path: 'diagnosis/:id/result',
          name: '诊断结果',
          component: () => import('@/pages/diagnosis/workflow/WorkflowResultPage.vue'),
          props: true,
          meta: {
            access: ACCESS_ENUM.USER,
            hideInMenu: true,
          },
        },
        {
          path: 'doctor/reviews',
          name: '审核工作台',
          component: () => import('@/pages/doctor/ReviewListPage.vue'),
          meta: {
            icon: 'AuditOutlined',
            access: ACCESS_ENUM.DOCTOR,
          },
        },
        {
          path: 'doctor/reviews/:id',
          name: '审核详情',
          component: () => import('@/pages/doctor/ReviewDetailPage.vue'),
          props: true,
          meta: {
            access: ACCESS_ENUM.DOCTOR,
            hideInMenu: true,
          },
        },
        {
          path: 'news',
          name: '前沿新闻',
          component: () => import('@/pages/news/NewsPage.vue'),
          meta: {
            icon: 'ReadOutlined',
          },
        },
        {
          path: 'news/:id',
          name: '新闻详情',
          component: () => import('@/pages/news/NewsDetailPage.vue'),
          props: true,
          meta: {
            hideInMenu: true,
          },
        },
        {
          path: 'agent',
          name: 'Eye智诊',
          component: () => import('@/pages/agent/AgentChatPage.vue'),
          meta: {
            icon: 'RobotOutlined',
          },
        },
        {
          path: 'systemManage',
          name: '系统管理',
          redirect: '/admin/dashboard',
          meta: {
            icon: 'SettingOutlined',
            access: ACCESS_ENUM.ADMIN,
            hideInMenu: true,
          },
        },
        {
          path: 'user/userCenter',
          name: '个人中心',
          component: () => import('@/pages/userCenter/UserCenter.vue'),
          meta: {
            hideInMenu: true,
          },
          children: [
            {
              path: 'profile',
              name: 'profile',
              component: () => import('@/pages/userCenter/Profile.vue'),
              meta: {
                hideInMenu: true,
              },
            },
            {
              path: 'accountSettings',
              name: 'accountSettings',
              component: () => import('@/pages/userCenter/AccountSetting.vue'),
              meta: {
                hideInMenu: true,
              },
            },
            {
              path: 'diagnosisHistory',
              name: 'diagnosisHistory',
              component: () => import('@/pages/userCenter/DiagnosisHistory.vue'),
              meta: {
                hideInMenu: true,
              },
            },
            {
              path: 'notification',
              name: 'notification',
              component: () => import('@/pages/userCenter/NotificationCenter.vue'),
              meta: {
                hideInMenu: true,
              },
            },
          ],
        },
      ],
    },
    ...adminRoutes,
  ],
})

export default router
