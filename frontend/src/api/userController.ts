// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** 新增用户 POST /user/add */
export async function userAdd(body: API.UserAddDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseLong>('/user/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 删除用户 POST /user/delete/${param0} */
export async function deleteUser(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteUserParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseBoolean>(`/user/delete/${param0}`, {
    method: 'POST',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 用户申请复诊上传 POST /user/diagnosis/reexamine */
export async function reexamineDiagnosis(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.reexamineDiagnosisParams,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseBoolean>('/user/diagnosis/reexamine', {
    method: 'POST',
    params: {
      ...params,
      diagnosisReexamineDTO: undefined,
      ...params['diagnosisReexamineDTO'],
    },
    ...(options || {}),
  })
}

/** 根据id查询用户 GET /user/get */
export async function getUserById(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getUserByIdParams,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseUser>('/user/get', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  })
}

/** 获取登录用户 GET /user/get/login */
export async function getLoginUser(options?: { [key: string]: any }) {
  return request<API.BaseResponseLoginUserVO>('/user/get/login', {
    method: 'GET',
    ...(options || {}),
  })
}

/** 根据id查询脱敏用户 GET /user/get/vo */
export async function getUserVoById(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getUserVOByIdParams,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseUserVO>('/user/get/vo', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  })
}

/** 获取分页用户列表 POST /user/list/page/vo */
export async function listUserVoByPage(body: API.UserQueryDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponsePageUserVO>('/user/list/page/vo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取分页用户列表（缓存版本） POST /user/list/page/vo/cache */
export async function listUserVoByPageWithCache(
  body: API.UserQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageUserVO>('/user/list/page/vo/cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 用户登录 POST /user/login */
export async function userLogin(body: API.UserLoginDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseLoginUserVO>('/user/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 用户登出 POST /user/logout */
export async function userLogout(options?: { [key: string]: any }) {
  return request<API.BaseResponseBoolean>('/user/logout', {
    method: 'POST',
    ...(options || {}),
  })
}

/** 用户注册 POST /user/register */
export async function userRegister(body: API.UserRegisterDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseLong>('/user/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 更新用户信息 POST /user/update */
export async function updateUser(body: API.UserUpdateDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseBoolean>('/user/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 用户中心更新 POST /user/update/userCenter */
export async function editUserCenter(body: API.UserEditDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseBoolean>('/user/update/userCenter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 用户头像上传 POST /user/upload/avatar */
export async function uploadAvatarPicture(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.uploadAvatarPictureParams,
  body: {},
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseUserVO>('/user/upload/avatar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
      userEditDTO: undefined,
      ...params['userEditDTO'],
    },
    data: body,
    ...(options || {}),
  })
}
