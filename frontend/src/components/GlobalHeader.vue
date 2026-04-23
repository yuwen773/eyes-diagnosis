<script lang="ts" setup>
import { computed, h, ref } from 'vue'
import { HomeOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons-vue'
import { type MenuProps, message } from 'ant-design-vue'
import { useLoginUserStore } from '@/stores/user'
import { useRouter } from "vue-router"
import checkAccess from '@/utils/access/checkAccess'
import { userLogout } from '@/api/userController'

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

const goCenter = () => {
  router.push('/user/userCenter')
}
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
            <a-dropdown>
              <ASpace>
                <a-avatar
                  :src="loginUserStore.loginUser.userAvatar"
                  class="avatar"
                >
                  {{ loginUserStore.loginUser.userName ?? '无名' }}
                </a-avatar>
              </ASpace>
              <template #overlay>
                <a-menu class="dropdown-menu">
                  <a-menu-item @click="goCenter">
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
  background-color: rgb(48, 164, 173);
  padding: 0 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
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
  color: white;
  font-weight: 600;
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
  color: rgba(255, 255, 255, 0.9) !important;
  transition: all 0.3s ease !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item:hover),
:deep(.ant-menu-horizontal > .ant-menu-submenu:hover) {
  color: white !important;
  background-color: rgba(255, 255, 255, 0.1) !important;
}

:deep(.ant-menu-horizontal > .ant-menu-item-selected) {
  color: white !important;
  font-weight: 600 !important;
  background-color: rgba(255, 255, 255, 0.15) !important;
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
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
}

.user-name {
  color: white;
  font-size: 18px;
  margin-left: 10px;
}

.login-button {
  height: 42px;
  padding: 0 24px;
  font-size: 18px;
  background-color: white;
  color: rgb(48, 164, 173);
  border-radius: 21px;
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

<!--<style scoped>
/* 整体容器 */
.header-container {
  background-color: rgb(48, 164, 173);
  padding: 0 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  height: 64px;
  position: relative;
  z-index: 100;
}

/* 标题部分 */
.title-bar {
  display: flex;
  align-items: center;
  height: 100%;
  transition: all 0.3s ease;
}

.title-bar:hover {
  opacity: 0.9;
}

.logo {
  height: 32px;
  margin-right: 12px;
  transition: all 0.3s ease;
}

.title {
  font-size: 20px;
  color: white;
  font-weight: 600;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

/* 主菜单核心样式 */
.header-menu {
  background: transparent !important;
  line-height: 64px;
  border-bottom: none !important;

  :deep(.ant-menu-item) {
    color: rgba(255, 255, 255, 0.9) !important;
    font-size: 18px !important;
    font-weight: 500;
    margin: 0 8px;
    padding: 0 16px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

    /* 激活状态 */
    &-selected {
      color: white !important;
      font-weight: 600;
      background-color: rgba(255, 255, 255, 0.15) !important;
      border-radius: 4px;

      &::after {
        border-color: white !important;
        border-bottom-width: 3px;
        bottom: 12px;
      }
    }

    /* 悬停状态 */
    &:hover:not(.ant-menu-item-selected) {
      color: white !important;
      background-color: rgba(255, 255, 255, 0.1) !important;
      transform: translateY(-2px);
    }
  }
}

/* 用户信息区域 */
.user-login-status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  padding-right: 12px;

  .avatar {
    background-color: rgba(255, 255, 255, 0.2);
    color: white;
    cursor: pointer;
    transition: all 0.3s ease;

    &:hover {
      transform: scale(1.1);
      background-color: rgba(255, 255, 255, 0.3);
    }
  }

  .user-name {
    color: white;
    font-size: 16px;
    font-weight: 500;
    margin-left: 8px;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .login-button {
    height: 36px;
    padding: 0 20px;
    font-size: 16px;
    font-weight: 500;
    background-color: white;
    color: rgb(48, 164, 173);
    border: none;
    border-radius: 18px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  }
}

/* 下拉菜单样式 */
:deep(.dropdown-menu) {
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 8px 0;

  .ant-dropdown-menu-item {
    padding: 10px 16px;
    font-size: 15px;
    transition: all 0.2s ease;

    &:hover {
      background-color: #f5f5f5 !important;
    }
  }
}

/* 响应式适配 */
@media (max-width: 768px) {
  .header-container {
    padding: 0 12px;
  }

  .title {
    font-size: 18px;
  }

  .header-menu :deep(.ant-menu-item) {
    font-size: 16px;
    padding: 0 10px;
    margin: 0 4px;
  }

  .user-name {
    display: none;
  }
}
</style>-->
