// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** 此处后端没有提供注释 POST /diagnosis/delete/${param0} */
export async function deleteDiagnosis(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteDiagnosisParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseBoolean>(`/diagnosis/delete/${param0}`, {
    method: 'POST',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 诊断接口 POST /diagnosis/diagnosis */
export async function doDiagnosis(file: File, options?: { [key: string]: any }) {
  const formData = new FormData()
  formData.append('file', file)
  return request<API.BaseResponseDiagnosisResultVO>('/diagnosis/diagnosis', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  })
}

/** 此处后端没有提供注释 GET /diagnosis/get/${param0} */
export async function getDiagnosisResultVo(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getDiagnosisResultVOParams,
  options?: { [key: string]: any }
) {
  const { id: param0, ...queryParams } = params
  return request<API.BaseResponseDiagnosisResultVO>(`/diagnosis/get/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** 此处后端没有提供注释 POST /diagnosis/list/page/my */
export async function listMyDiagnosisVoByPage(
  body: API.DiagnosisQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageDiagnosisManageVO>('/diagnosis/list/page/my', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 此处后端没有提供注释 POST /diagnosis/list/page/vo */
export async function listDiagnosisVoByPage(
  body: API.DiagnosisQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageDiagnosisManageVO>('/diagnosis/list/page/vo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 此处后端没有提供注释 POST /diagnosis/list/page/vo/cache */
export async function listDiagnosisVoByPageWithCache(
  body: API.DiagnosisQueryDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponsePageDiagnosisManageVO>('/diagnosis/list/page/vo/cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 此处后端没有提供注释 POST /diagnosis/update */
export async function updateDiagnosisResult(
  body: API.DiagnosisResultDTO,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseBoolean>('/diagnosis/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** 此处后端没有提供注释 POST /diagnosis/upload */
// export async function uploadPicture(
//   // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
//   params: API.uploadPictureParams,
//   body: {},
//   options?: { [key: string]: any }
// ) {
//   return request<API.BaseResponseDiagnosisManageVO>('/diagnosis/upload', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//     },
//     params: {
//       ...params,
//       diagnosisUploadDTO: undefined,
//       ...params['diagnosisUploadDTO'],
//     },
//     data: body,
//     ...(options || {}),
//   })
// }
/** 诊断图片上传 POST /api/diagnosis/upload */
export async function uploadPicture(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.uploadPictureParams,
  body: {},
  file?: File,
  options?: { [key: string]: any }
) {
  const formData = new FormData()

  if (file) {
    formData.append('file', file)
  }

  Object.keys(body).forEach((ele) => {
    const item = (body as any)[ele]

    if (item !== undefined && item !== null) {
      if (typeof item === 'object' && !(item instanceof File)) {
        if (item instanceof Array) {
          item.forEach((f) => formData.append(ele, f || ''))
        } else {
          formData.append(ele, JSON.stringify(item))
        }
      } else {
        formData.append(ele, item)
      }
    }
  })

  return request<API.BaseResponseDiagnosisManageVO>('/diagnosis/upload', {
    method: 'POST',
    params: {
      ...params,
    },
    data: formData,
    ...(options || {}),
  })
}
