// 引入pinia 组件
import { defineStore } from 'pinia'
// ref
import { ref } from 'vue'
import { getLoginUser } from '@/api/userController'
export const useLoginUserStore = defineStore('loginUser', () => {
  const loginUser = ref<API.LoginUserVO>({
    userName: '未登录',
    userAvatar: '',
  })
  //获取当前用户
  async function fetchLoginUser() {
    try {
      const res = await getLoginUser()
      if (res.data.code === 0 && res.data.data) {
        loginUser.value = res.data.data
      }
    } catch (error) {
      console.log('获取用户信息失败，可能后端服务未启动：', error)
      // 设置默认未登录状态
      loginUser.value = {
        userName: '未登录',
        userAvatar: '',
      }
    }
  }

  //缓存用户信息
  function setLoginUser(newLoginUser: any) {
    loginUser.value = newLoginUser
  }
  //返回pinia
  return { loginUser, fetchLoginUser, setLoginUser }
})
