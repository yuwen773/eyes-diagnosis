import router from '@/router'
import { useLoginUserStore } from '@/stores/user'
import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'
import checkAccess from '@/utils/access/checkAccess'
/**
 * 1.首先判断页面是否需要登录权限，如果不需要，直接放行。
 * 2.如果页面需要登录权限
 * i.如果用户未登录，则跳转到登录页面。
 * ii.如果已登录，判断登录用户的权限是否符合要求，否则跳转到401无权限页面。
 */
router.beforeEach(async (to, from, next) => {
  const loginUserStore = useLoginUserStore()
  let loginUser = loginUserStore.loginUser
  // // 如果之前没登陆过，自动登录
  if (!loginUser || !loginUser.userRole) {
    // 加 await 是为了等用户登录成功之后，再执行后续的代码
    await loginUserStore.fetchLoginUser();
    loginUser = loginUserStore.loginUser;
  }
  console.log('登录用户信息',loginUser)
  const needAccess = (to.meta.access as string) ?? ACCESS_ENUM.NOT_LOGIN
  //要跳转的页面必须要登陆
  if(needAccess !== ACCESS_ENUM.NOT_LOGIN) {
    //未登录，则跳转到登录页面
    if(!loginUser || !loginUser.userRole || loginUser.userRole === ACCESS_ENUM.NOT_LOGIN) {
      next(`/user/login?redirect=${to.fullPath}`)
      return
    }
    //如果以已经登录了，但是权限不足，那么跳转到无权限页面
    if(!checkAccess(loginUser,needAccess)){
      next('/noAuth')
      return
    }
  }
  next()
})
