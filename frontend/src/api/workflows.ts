// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** Create Workflow POST /diagnosis/workflows */
export async function createWorkflowApiDiagnosisWorkflowsPost(
  body: API.BodyCreateWorkflowApiDiagnosisWorkflowsPost,
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

  return request<any>('/diagnosis/workflows', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  })
}

/** Get Workflow GET /diagnosis/workflows/${param0} */
export async function getWorkflowApiDiagnosisWorkflowsWorkflowIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getWorkflowApiDiagnosisWorkflowsWorkflowIdGetParams,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, ...queryParams } = params
  return request<API.BaseResponseWorkflowStatusView>(`/diagnosis/workflows/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Workflow Events One authoritative snapshot per GET; done ends transport, not the task.

Clients renew this bounded stream, including after terminal workflow states:
consent and supplementary interactions can still change. Each renewal checks
Java identity and ownership; no transaction or identity cache spans renewals. GET /diagnosis/workflows/${param0}/events */
export async function workflowEventsApiDiagnosisWorkflowsWorkflowIdEventsGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.workflowEventsApiDiagnosisWorkflowsWorkflowIdEventsGetParams,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, ...queryParams } = params
  return request<any>(`/diagnosis/workflows/${param0}/events`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Workflow Image GET /diagnosis/workflows/${param0}/image */
export async function workflowImageApiDiagnosisWorkflowsWorkflowIdImageGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.workflowImageApiDiagnosisWorkflowsWorkflowIdImageGetParams,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, ...queryParams } = params
  return request<any>(`/diagnosis/workflows/${param0}/image`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Get Save Confirmation GET /diagnosis/workflows/${param0}/save-confirmation */
export async function getSaveConfirmationApiDiagnosisWorkflowsWorkflowIdSaveConfirmationGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getSaveConfirmationApiDiagnosisWorkflowsWorkflowIdSaveConfirmationGetParams,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, ...queryParams } = params
  return request<API.BaseResponseUnionSaveConfirmationViewNoneType>(
    `/diagnosis/workflows/${param0}/save-confirmation`,
    {
      method: 'GET',
      params: { ...queryParams },
      ...(options || {}),
    }
  )
}

/** Create Save Confirmation POST /diagnosis/workflows/${param0}/save-confirmation */
export async function createSaveConfirmationApiDiagnosisWorkflowsWorkflowIdSaveConfirmationPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.createSaveConfirmationApiDiagnosisWorkflowsWorkflowIdSaveConfirmationPostParams,
  body: API.SaveRequest,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, ...queryParams } = params
  return request<API.BaseResponseSaveConfirmationView>(
    `/diagnosis/workflows/${param0}/save-confirmation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      params: { ...queryParams },
      data: body,
      ...(options || {}),
    }
  )
}

/** Approve Save POST /diagnosis/workflows/${param0}/save-confirmations/${param1}/approve */
export async function approveSaveApiDiagnosisWorkflowsWorkflowIdSaveConfirmationsConfirmationIdApprovePost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.approveSaveApiDiagnosisWorkflowsWorkflowIdSaveConfirmationsConfirmationIdApprovePostParams,
  body: API.SaveDecision,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, confirmationId: param1, ...queryParams } = params
  return request<API.BaseResponseSaveConfirmationView>(
    `/diagnosis/workflows/${param0}/save-confirmations/${param1}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      params: { ...queryParams },
      data: body,
      ...(options || {}),
    }
  )
}

/** Reject Save POST /diagnosis/workflows/${param0}/save-confirmations/${param1}/reject */
export async function rejectSaveApiDiagnosisWorkflowsWorkflowIdSaveConfirmationsConfirmationIdRejectPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.rejectSaveApiDiagnosisWorkflowsWorkflowIdSaveConfirmationsConfirmationIdRejectPostParams,
  body: API.SaveDecision,
  options?: { [key: string]: any }
) {
  const { workflowId: param0, confirmationId: param1, ...queryParams } = params
  return request<API.BaseResponseSaveConfirmationView>(
    `/diagnosis/workflows/${param0}/save-confirmations/${param1}/reject`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      params: { ...queryParams },
      data: body,
      ...(options || {}),
    }
  )
}
