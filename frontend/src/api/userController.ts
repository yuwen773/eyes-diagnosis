// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** 新增用户 ``UserController#userAdd``.

The controller requires an explicit initial password rather than falling
back to a default (``UserController.java:115-118``), and writes the
BCrypt hash separately from the bean copy. POST /user/add */
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

/** 删除用户 Logical delete.

``removeById`` on a ``@TableLogic`` field issues ``UPDATE t_user SET
isDelete=1`` rather than a DELETE, so the row stays for the Agent tables'
foreign keys while disappearing from every query. POST /user/delete/${param0} */
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

/** 用户申请复诊上传 ``UserServiceImpl#reexamineDiagnosis``.

Ownership is enforced: a user may only flag their own diagnosis, otherwise
``NO_AUTH_ERROR``. POST /user/diagnosis/reexamine */
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

/** 根据id查询用户 Deviation: Java returns the entity *with* ``userPassword``. Unused by
the frontend and leaky, so the desensitized view is returned instead. GET /user/get */
export async function getUserById(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getUserByIdParams,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseUserVO>('/user/get', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  })
}

/** 获取登录用户 ``UserServiceImpl#getLoginUser`` + ``getLoginUserVO``.

Anonymous -> ``NOT_LOGIN_ERROR``, same as Java. The frontend's
``stores/user.ts`` treats "not 0, or no data" as signed out and its router
guard redirects to the login page, so the behaviour is unchanged. GET /user/get/login */
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

/** 获取分页用户列表（缓存版本） Redis-cached variant, mirroring ``listUserVOByPageWithCache``.

The key is an MD5 of the request body, as in Java, and the TTL is
``300 + random(0, 300)`` seconds to spread expirations. POST /user/list/page/vo/cache */
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

/** 用户登录 ``UserServiceImpl#userLogin``.

The validation order and the Chinese messages are copied exactly, because
the frontend surfaces ``msg`` verbatim in a toast:

``PARAMS_IS_NULL`` -> ``ACCOUNT_ERROR`` -> ``PASSWORD_ERROR`` ->
``FAIL_LOGIN``.

``FAIL_LOGIN`` is deliberately used for both "no such account" and "wrong
password", so the response cannot be used to enumerate accounts.

The lookup is restricted to ``is_delete = 0`` because MyBatis Plus appends
that predicate automatically for a ``@TableLogic`` field, so a
logically-deleted account cannot log in under Java either. POST /user/login */
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

/** 用户登出 ``UserServiceImpl#userLogout``.

Not idempotent, on purpose: logging out without a session is an error in
Java (``NOT_LOGIN_ERROR`` + ``NO_LOGIN``) and some frontend flow depends on
being told the difference between "you were signed in" and "you were not".
Making it idempotent would be a compatible-but-different contract, so the
Java behaviour is kept until a ticket says otherwise.

The caller is taken as a dependency rather than by calling
``get_login_user(request)`` inline: the latter leaves its own ``db``
parameter unresolved, which fails the row lookup and reports 500 -- "you
could not log out" -- to every user who *was* signed in. POST /user/logout */
export async function userLogout(options?: { [key: string]: any }) {
  return request<API.BaseResponseBoolean>('/user/logout', {
    method: 'POST',
    ...(options || {}),
  })
}

/** 用户注册 ``UserServiceImpl#userRegister``.

Validation order is copied exactly; each branch throws a different Chinese
message and the frontend surfaces it verbatim. POST /user/register */
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

/** 更新用户信息 ``UserController#updateUser``.

``updateTime`` is set explicitly: in Java it relies on the column's
``ON UPDATE CURRENT_TIMESTAMP``, which SQLAlchemy does not trigger for a
plain ORM UPDATE. POST /user/update */
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

/** 用户中心更新 ``UserServiceImpl#updateOwnProfile`` -- always targets the session user.

Java is queried on every subsequent request, including after profile edits. POST /user/update/userCenter */
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

/** 用户头像上传 ``UserServiceImpl#uploadUserAvatar``.

Multipart field is ``file`` (singular). The COS prefix is
``public/{userId}``, matching ``String.format("public/%s", loginUser.getId())``. POST /user/upload/avatar */
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
