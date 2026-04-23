import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import { HomeOutlined,SettingOutlined ,MedicineBoxOutlined,RobotOutlined,ReadOutlined     } from '@ant-design/icons-vue'
import UserLoginPage from '@/pages/user/UserLoginPage.vue'
import UserRegisterPage from '@/pages/user/UserRegisterPage.vue'
import UserManagePage from '@/pages/admin/UserManagePage.vue'
import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'
import NoAuth from '@/pages/NoAuth.vue'
import DiagnosisPage from '@/pages/diagnosis/DiagnosisPage.vue'
import NewsPage from '@/pages/news/NewsPage.vue'
import NewsDetailPage from '@/pages/news/NewsDetailPage.vue'
import NewsManagePage from '@/pages/admin/NewsManagePage.vue'
import AgentChatPage from '@/pages/agent/AgentChatPage.vue'
import SystemManagePage from '@/pages/admin/SystemManagePage.vue'
import DiagnosisManagePage from '@/pages/admin/DiagnosisManagePage.vue'
import UserCenter from '@/pages/userCenter/UserCenter.vue'
import Profile from '@/pages/userCenter/Profile.vue'
import DiagnosisHistory from '@/pages/userCenter/DiagnosisHistory.vue'
import AccountSetting from '@/pages/userCenter/AccountSetting.vue'
import DataAnalysisPage from '@/pages/admin/DataAnalysisPage.vue'
import NewsEditPage from '@/pages/news/NewsEditPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: '主页',
      component: HomePage,
      meta:{
        // icon: () => h(HomeOutlined),
        icon: HomeOutlined,
      }
    },
    {
      path: '/user/login',
      name: '用户登录',
      component: UserLoginPage,
      meta:{
        hideInMenu: true,
      }
    },
    {
      path: '/user/register',
      name: '用户注册',
      component: UserRegisterPage,
      meta:{
        hideInMenu: true,
      }
    },
    {
      path: '/noAuth',
      name: '无权限页面',
      component: NoAuth,
      meta:{
        access:ACCESS_ENUM.NOT_LOGIN,
        hideInMenu: true,
      }
    },
    {
      path: '/diagnosis',
      name: '疾病诊断',
      component: DiagnosisPage,
      meta:{
        // icon: () => h(HomeOutlined),
        icon: MedicineBoxOutlined,
      }
    },
    {
      path: '/news',
      name: '前沿新闻',
      component: NewsPage,
      meta:{
        icon:ReadOutlined,
      }
    },
    {
      path: '/news/:id',
      name: '新闻详情',
      component: NewsDetailPage,
      props: true,
      meta:{
        hideInMenu: true,
      }
    },
    {
      path: '/agent',
      name: 'Agent助手',
      component: AgentChatPage,
      meta:{
        icon:RobotOutlined,
      }
    },
    {
      path: '/systemManage',
      name: '系统管理',
      component: SystemManagePage,
      meta:{
        // icon: () => h(HomeOutlined),
        icon: SettingOutlined,
        access:ACCESS_ENUM.ADMIN,
      },
      //系统管理的子路由
      children:[
        {
          path: 'admin/userManage',
          name: '用户管理',
          component: UserManagePage,
          meta:{
            access:ACCESS_ENUM.ADMIN,
            hideInMenu: true,
          }
        },
        {
          path: 'admin/newsManage',
          name: '新闻管理',
          component: NewsManagePage,
          meta:{
            access:ACCESS_ENUM.ADMIN,
            hideInMenu: true,
          }
        },
        {
          path: 'admin/dataAnalysis',
          name: '病情分析',
          component: DataAnalysisPage,
          meta:{
            access:ACCESS_ENUM.ADMIN,
            hideInMenu: true,
          }
        },
        {
          path: '/news/edit/:id',
          name: '编辑新闻',
          component: NewsEditPage,
          props: true,
          meta:{
            access:ACCESS_ENUM.ADMIN,
            hideInMenu: true,
          }
        },
        {
          path: 'admin/diagnosisManage',
          name: '疾病诊断管理',
          component: DiagnosisManagePage,
          meta:{
            access:ACCESS_ENUM.ADMIN,
            hideInMenu: true,
          }
        },

      ]
    },
    {
      path: '/user/userCenter',
      name: '个人中心',
      component: UserCenter,
      meta:{
        hideInMenu: true,
      },
      children: [
        {
          path: 'profile',
          name: 'profile',
          component: Profile,
          meta:{
            hideInMenu: true,
          }
        },
        {
          path: 'accountSettings',
          name: 'accountSettings',
          component: AccountSetting,
          meta:{
            hideInMenu: true,
          }
        },
        {
          path: 'diagnosisHistory',
          name: 'diagnosisHistory',
          component: DiagnosisHistory,
          meta:{
            hideInMenu: true,
          }
        }
      ]
    },
  ],
})

export default router
