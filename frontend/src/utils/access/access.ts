import router from '@/router'
import { useLoginUserStore } from '@/stores/user'
import { message } from 'ant-design-vue'
//是否为首次获取登录用户

let firstFetchLoginUser = true

//全局权限校验
router.beforeEach(async (to, from, next) => {
   const loginUserStore = useLoginUserStore()
  let loginUser = loginUserStore.loginUser
  //确保页面刷新，首次加载时，能够等后端返回用户信息在进行校验权限
  if (firstFetchLoginUser) {
    await loginUserStore.fetchLoginUser()
    loginUser = loginUserStore.loginUser
    firstFetchLoginUser = false
  }
  // 要跳转的页面
  const toUrl = to.fullPath
  if(toUrl.startsWith('/admin')){
    //未登录  或者 登录角色不是管理员
    if(!loginUser || loginUser.userRole !== 'admin'){
      message.error('没有权限')
      next(`/user/login?redirect=${to.fullPath}`)
      return
    }
  }
  next()
})
