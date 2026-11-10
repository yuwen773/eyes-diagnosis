// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** 删除新闻 POST /news/delete/${param0} */
export async function deleteNews(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteNewsParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseBoolean>(`/news/delete/${param0}`, {
    method: 'POST',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 创建或修改新闻 POST /news/edit */
export async function updateNews(body: API.NewsUpdateDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponseLong>('/news/edit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取新闻详情 GET /news/get/${param0} */
export async function getNewsVo(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getNewsVOParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseNewsVO>(`/news/get/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 获取分页新闻列表 POST /news/list/page/vo */
export async function listNewsVoByPage(body: API.NewsQueryDTO, options?: { [key: string]: any }) {
  return request<API.BaseResponsePageNewsVO>('/news/list/page/vo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 获取分页新闻列表（缓存版） POST /news/list/page/vo/cache */
export async function listNewsVoByPageWithCache(
  body: API.NewsQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageNewsVO>('/news/list/page/vo/cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 上传新闻图片 POST /news/uploadAttachment */
export async function uploadAttachment(body: {}, options?: { [key: string]: any }) {
  return request<API.BaseResponseString>('/news/uploadAttachment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 上传新闻图片封面 POST /news/uploadCover */
export async function uploadCoverImage(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.uploadCoverImageParams,
  body: {},
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseString>('/news/uploadCover', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
      newsUploadDTO: undefined,
      ...params['newsUploadDTO'],
    },
    data: body,
    ...(options || {}),
  })
}
