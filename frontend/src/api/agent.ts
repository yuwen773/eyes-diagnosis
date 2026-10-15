// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** Chat Stream POST /agent/chat/stream */
export async function chatStreamApiAgentChatStreamPost(
  body: API.ChatRequest,
  options?: { [key: string]: any }
) {
  return request<any>('/agent/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** History GET /agent/history/${param0} */
export async function historyApiAgentHistoryThreadIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.historyApiAgentHistoryThreadIdGetParams,
  options?: { [key: string]: any }
) {
  const { thread_id: param0, ...queryParams } = params
  return request<any>(`/agent/history/${param0}`, {
    method: 'GET',
    params: {
      // limit has a default value: 40
      limit: '40',
      ...queryParams,
    },
    ...(options || {}),
  })
}

/** Export Session GET /agent/history/${param0}/export */
export async function exportSessionApiAgentHistorySessionIdExportGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.exportSessionApiAgentHistorySessionIdExportGetParams,
  options?: { [key: string]: any }
) {
  const { session_id: param0, ...queryParams } = params
  return request<any>(`/agent/history/${param0}/export`, {
    method: 'GET',
    params: {
      // format has a default value: markdown
      format: 'markdown',
      ...queryParams,
    },
    ...(options || {}),
  })
}

/** Upload Image POST /agent/image/upload */
export async function uploadImageApiAgentImageUploadPost(
  body: API.BodyUploadImageApiAgentImageUploadPost,
  options?: { [key: string]: any }
) {
  const formData = new FormData()

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

  return request<any>('/agent/image/upload', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  })
}

/** Delete Image POST /agent/image/upload/delete */
export async function deleteImageApiAgentImageUploadDeletePost(
  body: API.DeleteImageRequest,
  options?: { [key: string]: any }
) {
  return request<any>('/agent/image/upload/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** Sessions GET /agent/sessions */
export async function sessionsApiAgentSessionsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.sessionsApiAgentSessionsGetParams,
  options?: { [key: string]: any }
) {
  return request<any>('/agent/sessions', {
    method: 'GET',
    params: {
      // limit has a default value: 20
      limit: '20',
      ...params,
    },
    ...(options || {}),
  })
}

/** Delete Session DELETE /agent/sessions/${param0} */
export async function deleteSessionApiAgentSessionsSessionIdDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.deleteSessionApiAgentSessionsSessionIdDeleteParams,
  options?: { [key: string]: any }
) {
  const { session_id: param0, ...queryParams } = params
  return request<any>(`/agent/sessions/${param0}`, {
    method: 'DELETE',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Generate Title POST /agent/sessions/${param0}/generate-title */
export async function generateTitleApiAgentSessionsSessionIdGenerateTitlePost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.generateTitleApiAgentSessionsSessionIdGenerateTitlePostParams,
  body: API.GenerateTitleRequest,
  options?: { [key: string]: any }
) {
  const { session_id: param0, ...queryParams } = params
  return request<any>(`/agent/sessions/${param0}/generate-title`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}

/** Update Pin PUT /agent/sessions/${param0}/pin */
export async function updatePinApiAgentSessionsSessionIdPinPut(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.updatePinApiAgentSessionsSessionIdPinPutParams,
  body: API.PinRequest,
  options?: { [key: string]: any }
) {
  const { session_id: param0, ...queryParams } = params
  return request<any>(`/agent/sessions/${param0}/pin`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}

/** Update Title PUT /agent/sessions/${param0}/title */
export async function updateTitleApiAgentSessionsSessionIdTitlePut(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.updateTitleApiAgentSessionsSessionIdTitlePutParams,
  body: API.TitleRequest,
  options?: { [key: string]: any }
) {
  const { session_id: param0, ...queryParams } = params
  return request<any>(`/agent/sessions/${param0}/title`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}

/** Delete Batch DELETE /agent/sessions/batch */
export async function deleteBatchApiAgentSessionsBatchDelete(
  body: API.SessionBatch,
  options?: { [key: string]: any }
) {
  return request<any>('/agent/sessions/batch', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  })
}

/** Get Supplement GET /agent/supplements/${param0} */
export async function getSupplementApiAgentSupplementsRequestIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getSupplementApiAgentSupplementsRequestIdGetParams,
  options?: { [key: string]: any }
) {
  const { request_id: param0, ...queryParams } = params
  return request<API.BaseResponseSupplementView>(`/agent/supplements/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Reply Supplement POST /agent/supplements/${param0}/reply */
export async function replySupplementApiAgentSupplementsRequestIdReplyPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.replySupplementApiAgentSupplementsRequestIdReplyPostParams,
  body: API.SupplementReply,
  options?: { [key: string]: any }
) {
  const { request_id: param0, ...queryParams } = params
  return request<API.BaseResponseSupplementView>(`/agent/supplements/${param0}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}
