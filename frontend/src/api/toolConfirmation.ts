// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** Profile GET /agent/profile */
export async function profileApiAgentProfileGet(options?: { [key: string]: any }) {
  return request<any>('/agent/profile', {
    method: 'GET',
    ...(options || {}),
  })
}

/** Confirmations GET /agent/tool-confirmations */
export async function confirmationsApiAgentToolConfirmationsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.confirmationsApiAgentToolConfirmationsGetParams,
  options?: { [key: string]: any }
) {
  return request<any>('/agent/tool-confirmations', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  })
}

/** Decision POST /agent/tool-confirmations/${param0}/${param1} */
export async function decisionApiAgentToolConfirmationsConfirmationIdActionPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.decisionApiAgentToolConfirmationsConfirmationIdActionPostParams,
  body: API.ToolDecision,
  options?: { [key: string]: any }
) {
  const { confirmation_id: param0, action: param1, ...queryParams } = params
  return request<any>(`/agent/tool-confirmations/${param0}/${param1}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}
