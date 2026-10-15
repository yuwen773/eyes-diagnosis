// Existing client signatures retained across Python OpenAPI generation.
import request from "@/request"

export async function doDiagnosis(file: File, options?: { [key: string]: any }) {
  const formData = new FormData()
  formData.append('file', file)
  return request<API.BaseResponseDiagnosisResultVO>('/diagnosis/diagnosis', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  })
}

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
