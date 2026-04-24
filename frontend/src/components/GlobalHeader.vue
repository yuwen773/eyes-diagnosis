<script lang="ts" setup>
import { computed, h, ref } from 'vue'
import { HomeOutlined } from '@ant-design/icons-vue'
import { type MenuProps, message } from 'ant-design-vue'
import { useLoginUserStore } from '@/stores/user'
import { useRouter } from "vue-router"
import checkAccess from '@/utils/access/checkAccess'
import { userLogout } from '@/api/userController'
import AvatarDropdown from '@/components/user/AvatarDropdown.vue'

const loginUserStore = useLoginUserStore()
const current = ref<string[]>([])
const router = useRouter()

const doMenuClick = ({key}: {key: string}) => {
  router.push({ path: key })
}

router.afterEach((to) => {
  current.value = [to.path]
})

const doLogout = async () => {
  const res = await userLogout()
  if(res.data.code === 0) {
    loginUserStore.setLoginUser({ userName: '未登录' })
    message.success('退出登录成功')
    await router.push('/user/login')
  } else {
    message.error('退出登录失败'+res.data.msg)
  }
}

const menuToRouteItem = (item: any) => {
  return {
    key: item.path,
    label: item.name,
    title: item.name,
    icon: h(item.meta?.icon),
  }
}

const originItems = computed(() => {
  return router.getRoutes()
    .filter((item) => {
      if(item.meta?.hideInMenu) return false
      if(!item.meta?.icon) return false
      return checkAccess(loginUserStore.loginUser, item.meta?.access as string)
    })
    .map(menuToRouteItem)
})

const homeIndex = originItems.value.findIndex(item => item.key === '/')
if (homeIndex !== -1) {
  const homeItem = originItems.value.splice(homeIndex, 1)[0]
  originItems.value.unshift(homeItem)
}

const items = ref<MenuProps['items']>(originItems)

const isAdmin = computed(() => loginUserStore.loginUser.userRole === 'admin')
</script>

<template>
  <div id="globalHeader" class="header-container">
    <a-row :wrap="false" class="header-row">
      <a-col flex="300px" class="header-logo-container">
        <RouterLink to="/">
          <div class="title-bar">
            <img class="logo" src="../assets/logo.png" alt="logo" />
            <div class="title">明眸智诊，视界无忧</div>
          </div>
        </RouterLink>
      </a-col>
      <a-col flex="auto">
        <a-menu
          v-model:selectedKeys="current"
          mode="horizontal"
          :items="items"
          @click="doMenuClick"
          class="header-menu"
        />
      </a-col>
      <a-col flex="120px">
        <div class="user-login-status">
          <div v-if="loginUserStore.loginUser.id">
            <AvatarDropdown @logout="doLogout" />
            <span class="user-name">{{ loginUserStore.loginUser.userName ?? '无名' }}</span>
          </div>
          <div v-else>
            <a-button type="primary" class="login-button" href="/user/login">登录</a-button>
          </div>
        </div>
      </a-col>
    </a-row>
  </div>
</template>
<style scoped>
/* 整体容器 */
.header-container {
  background-color: #30302e;
  padding: 0 24px;
  box-shadow: 0 2px 8px rgba(20, 20, 19, 0.15);
  height: 85px;
  position: relative;
  z-index: 100;
}

/* 标题部分 */
.title-bar {
  display: flex;
  align-items: center;
  height: 100%;
}

.logo {
  height: 40px;
  margin-right: 12px;
}

.title {
  font-size: 22px;
  color: #faf9f5;
  font-weight: 600;
  font-family: var(--claude-font-serif);
}

/* 深度覆盖 Ant Design 菜单样式 */
:deep(.ant-menu-horizontal) {
  line-height: 85px !important;
  border-bottom: none !important;
  background: transparent !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item),
:deep(.ant-menu-horizontal > .ant-menu-submenu) {
  font-size: 20px !important;
  height: 85px !important;
  line-height: 85px !important;
  padding: 0 20px !important;
  margin: 0 10px !important;
  color: rgba(250, 249, 245, 0.9) !important;
  transition: all 0.3s ease !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item:hover),
:deep(.ant-menu-horizontal > .ant-menu-submenu:hover) {
  color: #faf9f5 !important;
  background-color: rgba(250, 249, 245, 0.1) !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item-selected) {
  color: #faf9f5 !important;
  font-weight: 600 !important;
  background-color: rgba(250, 249, 245, 0.15) !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item::after),
:deep(.ant-menu-horizontal > .ant-menu-submenu::after) {
  bottom: 1px !important;
}

/* 用户信息区域 */
.user-login-status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}

.avatar {
  width: 42px;
  height: 42px;
  line-height: 42px;
  background-color: rgba(250, 249, 245, 0.2);
  color: #faf9f5;
}

.user-name {
  color: #faf9f5;
  font-size: 18px;
  margin-left: 10px;
}

.login-button {
  height: 42px;
  padding: 0 24px;
  font-size: 18px;
  background-color: #faf9f5;
  color: #c96442;
  border-radius: 12px;
  border: none;
  transition: all 0.2s ease;
}

.login-button:hover {
  background-color: #f5f4ed;
  color: #d97757;
  transform: translateY(-1px);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .header-container {
    padding: 0 12px;
  }

  :deep(.ant-menu-horizontal > .ant-menu-item),
  :deep(.ant-menu-horizontal > .ant-menu-submenu) {
    font-size: 16px !important;
    padding: 0 12px !important;
  }

  .user-name {
    display: none;
  }
}
</style>
