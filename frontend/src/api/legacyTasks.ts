// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** List Legacy Tasks GET /diagnosis/legacy-tasks */
export async function listLegacyTasksApiDiagnosisLegacyTasksGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.listLegacyTasksApiDiagnosisLegacyTasksGetParams,
  options?: { [key: string]: any }
) {
  return request<API.BaseResponseLegacyTaskPage>('/diagnosis/legacy-tasks', {
    method: 'GET',
    params: {
      // current has a default value: 1
      current: '1',
      // pageSize has a default value: 20
      pageSize: '20',
      ...params,
    },
    ...(options || {}),
  })
}

/** Get Legacy Task GET /diagnosis/legacy-tasks/${param0}/${param1} */
export async function getLegacyTaskApiDiagnosisLegacyTasksSourceTypeTaskIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.getLegacyTaskApiDiagnosisLegacyTasksSourceTypeTaskIdGetParams,
  options?: { [key: string]: any }
) {
  const { sourceType: param0, taskId: param1, ...queryParams } = params
  return request<API.BaseResponseLegacyTaskView>(`/diagnosis/legacy-tasks/${param0}/${param1}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Rebuild Legacy Task POST /diagnosis/legacy-tasks/${param0}/${param1}/rebuild */
export async function rebuildLegacyTaskApiDiagnosisLegacyTasksSourceTypeTaskIdRebuildPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.rebuildLegacyTaskApiDiagnosisLegacyTasksSourceTypeTaskIdRebuildPostParams,
  body: API.BodyRebuildLegacyTaskApiDiagnosisLegacyTasks_sourceType_TaskId_rebuildPost,
  options?: { [key: string]: any }
) {
  const { sourceType: param0, taskId: param1, ...queryParams } = params
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

  return request<any>(`/diagnosis/legacy-tasks/${param0}/${param1}/rebuild`, {
    method: 'POST',
    params: { ...queryParams },
    data: formData,
    ...(options || {}),
  })
}
