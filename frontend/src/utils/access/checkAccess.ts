import ACCESS_ENUM from '@/utils/access/ACCESS_ENUM'


/**
 * 检查权限（判断当前登录用户是否具有某个权限）
 * @param loginUser 当前登录用户
 * @param needAccess 要有的权限
 * @return boolean 有无权限
 */
const checkAccess = (loginUser:any,needAccess = ACCESS_ENUM.NOT_LOGIN)=>{
  //获取当前用户的权限如果没有loginUser 则代表未登录
  const loginUserAccess = loginUser?.userRole??ACCESS_ENUM.NOT_LOGIN
  if (needAccess === ACCESS_ENUM.DOCTOR_REVIEW) {
    return loginUserAccess === 'doctor' || loginUserAccess === ACCESS_ENUM.ADMIN
  }
  if (needAccess === ACCESS_ENUM.EVIDENCE_MANAGER) {
    return loginUserAccess === ACCESS_ENUM.ADMIN || loginUserAccess === 'evidence_reviewer'
  }
  if(needAccess === ACCESS_ENUM.NOT_LOGIN){
    return true
  }
  //需要登录才能访问
  if(needAccess===ACCESS_ENUM.USER){
    //如果用户没登陆
    if(loginUserAccess === ACCESS_ENUM.NOT_LOGIN){
      return false
    }
  }
  //需要管理员权限
  if(needAccess === ACCESS_ENUM.ADMIN){
    //如果不为管理员
    if(loginUserAccess !== ACCESS_ENUM.ADMIN){
      return false
    }
  }
  return true
}


export default checkAccess;
