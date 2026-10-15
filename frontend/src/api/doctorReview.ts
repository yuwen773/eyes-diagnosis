// @ts-ignore
/* eslint-disable */
import request from '@/request'

/** List Tasks GET /reviews/tasks */
export async function listTasksApiReviewsTasksGet(options?: { [key: string]: any }) {
  return request<API.BaseResponselistReviewSummary>('/reviews/tasks', {
    method: 'GET',
    ...(options || {}),
  })
}

/** Detail GET /reviews/tasks/${param0} */
export async function detailApiReviewsTasksTaskIdGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.detailApiReviewsTasksTaskIdGetParams,
  options?: { [key: string]: any }
) {
  const { taskId: param0, ...queryParams } = params
  return request<API.BaseResponseReviewDetail>(`/reviews/tasks/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Claim POST /reviews/tasks/${param0}/claim */
export async function claimApiReviewsTasksTaskIdClaimPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.claimApiReviewsTasksTaskIdClaimPostParams,
  body: API.ReviewVersions,
  options?: { [key: string]: any }
) {
  const { taskId: param0, ...queryParams } = params
  return request<API.BaseResponseReviewSummary>(`/reviews/tasks/${param0}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}

/** Image GET /reviews/tasks/${param0}/image */
export async function imageApiReviewsTasksTaskIdImageGet(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.imageApiReviewsTasksTaskIdImageGetParams,
  options?: { [key: string]: any }
) {
  const { taskId: param0, ...queryParams } = params
  return request<any>(`/reviews/tasks/${param0}/image`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  })
}

/** Submit POST /reviews/tasks/${param0}/submit */
export async function submitApiReviewsTasksTaskIdSubmitPost(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: API.submitApiReviewsTasksTaskIdSubmitPostParams,
  body: API.ReviewSubmission,
  options?: { [key: string]: any }
) {
  const { taskId: param0, ...queryParams } = params
  return request<API.BaseResponseReviewSummary>(`/reviews/tasks/${param0}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: { ...queryParams },
    data: body,
    ...(options || {}),
  })
}
